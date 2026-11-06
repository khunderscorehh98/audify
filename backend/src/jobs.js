// Background work on the droplet. PM2 runs one instance, so plain timers are
// safe. Every job works from database state, so a restart loses nothing.
import { withTransaction } from './db.js';
import { discardUploadFiles, hardDeleteTrack, queueR2Delete } from './lib/cleanup.js';

const MAX_DELAY_MINUTES = 60 * 24;

/** Rejected uploads whose undo window has passed are removed completely. */
export async function purgeRejected({ db, config }) {
  const seconds = config.undoWindowSeconds + config.undoGraceSeconds;
  const [rows] = await db.query(
    `SELECT * FROM uploads WHERE status = 'rejected' AND reviewed_at < UTC_TIMESTAMP() - INTERVAL ? SECOND`,
    [seconds],
  );
  for (const upload of rows) {
    await withTransaction(db, async (conn) => {
      if (upload.track_id) await hardDeleteTrack(conn, upload.track_id, 'rejected');
      await queueR2Delete(conn, upload.inbox_r2_key, 'rejected');
      await conn.query('DELETE FROM uploads WHERE id = ?', [upload.id]);
    });
  }
  return rows.length;
}

/** Uploads started but never finished (patch 3 §7). */
export async function purgeAbandoned({ db, config }) {
  const [rows] = await db.query(
    `SELECT * FROM uploads WHERE status = 'awaiting_upload' AND created_at < UTC_TIMESTAMP() - INTERVAL ? HOUR`,
    [config.uploadAbandonHours],
  );
  for (const upload of rows) {
    await withTransaction(db, async (conn) => {
      await discardUploadFiles(conn, upload, 'abandoned');
      await conn.query('DELETE FROM uploads WHERE id = ?', [upload.id]);
    });
  }
  return rows.length;
}

/** Works through r2_cleanup_queue, backing off on failure. */
export async function drainCleanupQueue({ db, storage }, batch = 50) {
  const [rows] = await db.query(
    // attempts = 0 means never tried, so it's due whatever its timestamp says.
    'SELECT * FROM r2_cleanup_queue WHERE attempts = 0 OR next_attempt_at <= UTC_TIMESTAMP() ORDER BY id LIMIT ?',
    [batch],
  );
  let done = 0;
  for (const row of rows) {
    try {
      let finished = true;
      if (row.is_prefix) finished = await storage.deletePrefix(row.r2_key);
      else await storage.deleteKey(row.r2_key);
      if (finished) {
        await db.query('DELETE FROM r2_cleanup_queue WHERE id = ?', [row.id]);
        done += 1;
      }
    } catch (error) {
      const delay = Math.min(2 ** row.attempts, MAX_DELAY_MINUTES);
      await db.query(
        `UPDATE r2_cleanup_queue
            SET attempts = attempts + 1, last_error = ?, next_attempt_at = UTC_TIMESTAMP() + INTERVAL ? MINUTE
          WHERE id = ?`,
        [String(error.message).slice(0, 500), delay, row.id],
      );
    }
  }
  return done;
}

export function startJobs(deps) {
  const every = (ms, name, job) => {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await job(deps);
      } catch (error) {
        console.error(`job ${name} failed: ${error.message}`);
      } finally {
        running = false;
      }
    }, ms);
    timer.unref();
    return timer;
  };
  return [
    every(5_000, 'purgeRejected', purgeRejected),
    every(60_000, 'drainCleanupQueue', drainCleanupQueue),
    every(60 * 60_000, 'purgeAbandoned', purgeAbandoned),
  ];
}
