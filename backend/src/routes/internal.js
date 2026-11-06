import { Router } from 'express';
import { HttpError, intParam, notFound, requiredString } from '../lib/http.js';
import { withTransaction } from '../db.js';
import { queueR2Delete } from '../lib/cleanup.js';
import { findOrCreateAlbum, setTrackArtists, setTrackGenres, findOrCreateArtist } from '../lib/catalog.js';
import { requireServiceToken } from '../auth.js';

const ALLOWED_TRACK_FILE = /^(original\.[a-z0-9]{1,8}|opus\.webm|aac\.m4a|lossless\.flac)$/;
const ARTWORK_FILES = ['96.jpg', '256.jpg', '512.jpg'];
const SHA256 = /^[0-9a-f]{64}$/;

/** Processor routes. Service token only; user tokens never work here. */
export function internalRouter({ db, storage, config }) {
  const router = Router();
  router.use(requireServiceToken(config));

  const inProgress = async (id) => {
    const [[upload]] = await db.query('SELECT * FROM uploads WHERE id = ?', [id]);
    if (!upload) throw notFound('Upload not found');
    if (upload.status !== 'processing') throw new HttpError(409, 'Upload is not being processed', { status: upload.status });
    return upload;
  };

  router.get('/uploads/pending', async (_req, res) => {
    const [rows] = await db.query(
      `SELECT id FROM uploads
        WHERE status = 'uploaded'
           OR (status = 'processing' AND claimed_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE)
        ORDER BY id`,
      [config.processorClaimTimeoutMin],
    );
    res.json({ ids: rows.map((row) => row.id) });
  });

  router.post('/uploads/:id/claim', async (req, res) => {
    const id = intParam(req.params.id);
    const [result] = await db.query(
      `UPDATE uploads
          SET status = 'processing', claimed_at = UTC_TIMESTAMP(), attempts = attempts + 1
        WHERE id = ?
          AND attempts < ?
          AND (status = 'uploaded'
               OR (status = 'processing' AND claimed_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE))`,
      [id, config.processorMaxAttempts, config.processorClaimTimeoutMin],
    );
    if (result.affectedRows === 1) return res.json({ id, claimed: true });

    const [[upload]] = await db.query(
      `SELECT status, attempts,
              claimed_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE AS timed_out
         FROM uploads WHERE id = ?`,
      [config.processorClaimTimeoutMin, id],
    );
    if (!upload) throw notFound('Upload not found');

    const exhausted =
      upload.attempts >= config.processorMaxAttempts &&
      (upload.status === 'uploaded' || (upload.status === 'processing' && upload.timed_out));
    if (exhausted) {
      await db.query(
        "UPDATE uploads SET status = 'failed', error_message = 'Processing kept failing' WHERE id = ?",
        [id],
      );
      return res.status(409).json({ reason: 'exhausted' });
    }
    return res.status(409).json({ reason: upload.status === 'processing' ? 'held' : 'not_claimable' });
  });

  router.get('/uploads/:id/source', async (req, res) => {
    const upload = await inProgress(intParam(req.params.id));
    res.json({
      url: await storage.presignGet(upload.inbox_r2_key),
      upload_uuid: upload.upload_uuid,
      original_filename: upload.original_filename,
    });
  });

  // The server decides whether a hash is a duplicate (patch 2 §2).
  router.post('/uploads/:id/hash', async (req, res) => {
    const id = intParam(req.params.id);
    const upload = await inProgress(id);
    const sha256 = req.body?.sha256;
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new HttpError(400, 'Invalid sha256');

    const [[existing]] = await db.query('SELECT track_id FROM track_files WHERE original_sha256 = ?', [sha256]);
    if (!existing) return res.json({ duplicate: false });

    await withTransaction(db, async (conn) => {
      await conn.query("UPDATE uploads SET status = 'duplicate', duplicate_of_track_id = ?, processed_at = UTC_TIMESTAMP() WHERE id = ?", [
        existing.track_id,
        id,
      ]);
      await queueR2Delete(conn, upload.inbox_r2_key, 'duplicate-upload');
    });
    res.json({ duplicate: true });
  });

  router.get('/albums/lookup', async (req, res) => {
    const mbId = String(req.query.mb_release_id || '');
    const [[album]] = await db.query('SELECT cover_r2_key FROM albums WHERE mb_release_id = ?', [mbId]);
    res.json({ exists: Boolean(album), has_cover: Boolean(album?.cover_r2_key) });
  });

  // Body: { files: [{ name, content_type }], artwork: boolean }
  router.post('/uploads/:id/presign', async (req, res) => {
    const upload = await inProgress(intParam(req.params.id));
    const urls = {};
    for (const file of req.body?.files ?? []) {
      if (!ALLOWED_TRACK_FILE.test(file?.name ?? '')) throw new HttpError(400, 'Unexpected file name');
      const key = `tracks/${upload.upload_uuid}/${file.name}`;
      urls[file.name] = { key, url: await storage.presignPut(key, requiredString(file.content_type, 'content_type', 100)) };
    }
    if (req.body?.artwork) {
      for (const name of ARTWORK_FILES) {
        const key = `artwork/${upload.upload_uuid}/${name}`;
        urls[`artwork/${name}`] = { key, url: await storage.presignPut(key, 'image/jpeg') };
      }
    }
    res.json({ urls, artwork_prefix: `artwork/${upload.upload_uuid}/` });
  });

  router.post('/uploads/:id/result', async (req, res) => {
    const id = intParam(req.params.id);
    const upload = await inProgress(id);
    const body = req.body ?? {};
    const track = body.track ?? {};
    const artists = body.artists ?? [];
    const files = body.files ?? [];

    const title = requiredString(track.title, 'track.title', 255);
    if (!Number.isInteger(track.duration_ms) || track.duration_ms <= 0) throw new HttpError(400, 'Invalid duration_ms');
    if (!artists.length) throw new HttpError(400, 'At least one artist is required');
    if (!files.some((file) => file.kind === 'original')) throw new HttpError(400, 'The original file is required');
    for (const file of files) {
      // A file must live under this upload's own prefix.
      if (!String(file.r2_key).startsWith(`tracks/${upload.upload_uuid}/`)) throw new HttpError(400, 'Unexpected r2_key');
    }
    const status = ['auto_matched', 'needs_review'].includes(track.metadata_status) ? track.metadata_status : 'needs_review';

    try {
      const trackId = await withTransaction(db, async (conn) => {
        const primary = await findOrCreateArtist(conn, artists[0]);

        let albumId = null;
        if (body.album?.title) {
          const { album } = await findOrCreateAlbum(conn, body.album, primary);
          albumId = album.id;
          const prefix = body.album.cover_prefix;
          if (prefix && !prefix.startsWith(`artwork/${upload.upload_uuid}/`)) throw new HttpError(400, 'Unexpected cover_prefix');
          if (prefix && !album.cover_r2_key) {
            await conn.query('UPDATE albums SET cover_r2_key = ? WHERE id = ?', [prefix, album.id]);
          } else if (prefix) {
            // Two uploads raced on a new album: the first cover stays.
            await queueR2Delete(conn, prefix, 'artwork-race', true);
          }
        }

        const [inserted] = await conn.query(
          `INSERT INTO tracks (title, album_id, disc_number, track_number, duration_ms, acoustid_id,
                               acoustid_score, mb_recording_id, metadata_status, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title.slice(0, 255),
            albumId,
            track.disc_number ?? null,
            track.track_number ?? null,
            track.duration_ms,
            track.acoustid_id ?? null,
            track.acoustid_score ?? null,
            track.mb_recording_id ?? null,
            status,
            upload.user_id,
          ],
        );
        const newId = inserted.insertId;
        await setTrackArtists(conn, newId, artists);
        await setTrackGenres(conn, newId, body.genres ?? []);

        for (const file of files) {
          await conn.query(
            `INSERT INTO track_files (track_id, kind, r2_key, mime_type, codec, bitrate_kbps,
                                      sample_rate_hz, bit_depth, channels, size_bytes, sha256)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newId,
              file.kind,
              file.r2_key,
              file.mime_type,
              file.codec,
              file.bitrate_kbps ?? null,
              file.sample_rate_hz ?? null,
              file.bit_depth ?? null,
              file.channels ?? null,
              file.size_bytes,
              file.sha256,
            ],
          );
        }

        await conn.query(
          `UPDATE uploads SET status = 'pending_approval', track_id = ?, processed_at = UTC_TIMESTAMP(),
                              error_message = NULL WHERE id = ?`,
          [newId, id],
        );
        await queueR2Delete(conn, upload.inbox_r2_key, 'processed');
        return newId;
      });
      res.status(201).json({ track_id: trackId });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Already processed');
      throw error;
    }
  });

  // Body: { error, retryable } (patch 3 §5)
  router.post('/uploads/:id/fail', async (req, res) => {
    const id = intParam(req.params.id);
    const upload = await inProgress(id);
    const message = String(req.body?.error || 'Processing failed').slice(0, 500);
    const retry = req.body?.retryable === true && upload.attempts < config.processorMaxAttempts;
    await db.query(
      retry
        ? "UPDATE uploads SET status = 'uploaded', claimed_at = NULL, error_message = ? WHERE id = ?"
        : "UPDATE uploads SET status = 'failed', error_message = ? WHERE id = ?",
      [message, id],
    );
    res.json({ status: retry ? 'uploaded' : 'failed' });
  });

  return router;
}
