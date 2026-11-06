import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { HttpError, intParam, notFound, page, requiredString } from '../lib/http.js';
import { withTransaction } from '../db.js';
import { hardDeleteTrack, queueR2Delete, discardUploadFiles } from '../lib/cleanup.js';
import { applyLabels, hiddenParents, restoreParents } from '../lib/catalog.js';
import { coverUrls, hydrateTracks, trackColumns } from '../lib/tracks.js';
import { requireAdmin } from '../auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIEWS = {
  active: 'x.is_archived = 0 AND x.is_deleted = 0',
  archived: 'x.is_archived = 1',
  deleted: 'x.is_deleted = 1',
};

const TYPES = {
  tracks: { table: 'tracks' },
  artists: { table: 'artists' },
  albums: { table: 'albums' },
  genres: { table: 'genres' },
  users: { table: 'users' },
};

const parseLabels = (body = {}) => {
  const labels = {};
  if (body.title !== undefined) labels.title = requiredString(body.title, 'Title', 255);
  if (body.artist !== undefined) labels.artist = requiredString(body.artist, 'Artist', 255);
  if (body.album !== undefined) labels.album = String(body.album ?? '').trim().slice(0, 255);
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new HttpError(400, 'Invalid year');
    labels.year = year;
  } else if (body.year === null || body.year === '') {
    labels.year = null;
  }
  if (body.genres !== undefined) {
    if (!Array.isArray(body.genres)) throw new HttpError(400, 'genres must be a list');
    labels.genres = body.genres.map((name) => requiredString(name, 'Genre', 100));
  }
  for (const key of ['mb_recording_id', 'mb_release_id', 'mb_artist_id']) {
    if (body[key] === undefined || body[key] === null) continue;
    if (!UUID.test(body[key])) throw new HttpError(400, `Invalid ${key}`);
    labels[key] = body[key];
  }
  return labels;
};

export function adminRouter(deps) {
  const { db, storage, config, dispatcher, musicbrainz } = deps;
  const router = Router();
  router.use(requireAdmin);

  const undoSeconds = config.undoWindowSeconds + config.undoGraceSeconds;

  router.get('/summary', async (_req, res) => {
    const count = async (sql) => (await db.query(sql))[0][0].n;
    res.json({
      uploads_pending: await count("SELECT COUNT(*) n FROM uploads WHERE status = 'pending_approval'"),
      uploads_failed: await count("SELECT COUNT(*) n FROM uploads WHERE status = 'failed'"),
      users_pending: await count("SELECT COUNT(*) n FROM users WHERE status = 'pending' AND is_deleted = 0 AND is_archived = 0"),
      users_approved: await count("SELECT COUNT(*) n FROM users WHERE status = 'approved' AND is_deleted = 0 AND is_archived = 0"),
      tracks: {
        active: await count('SELECT COUNT(*) n FROM tracks WHERE is_archived = 0 AND is_deleted = 0 AND published_at IS NOT NULL'),
        archived: await count('SELECT COUNT(*) n FROM tracks WHERE is_archived = 1'),
        deleted: await count('SELECT COUNT(*) n FROM tracks WHERE is_deleted = 1'),
      },
      artists: await count('SELECT COUNT(*) n FROM artists WHERE is_archived = 0 AND is_deleted = 0'),
      albums: await count('SELECT COUNT(*) n FROM albums WHERE is_archived = 0 AND is_deleted = 0'),
      genres: await count('SELECT COUNT(*) n FROM genres WHERE is_archived = 0 AND is_deleted = 0'),
    });
  });

  // ---------- Autocomplete ----------
  router.post('/lookup', async (req, res) => {
    const title = requiredString(req.body?.title, 'Title', 255);
    const artist = requiredString(req.body?.artist, 'Artist', 255);
    res.json({ matches: await musicbrainz.search(title, artist) });
  });

  router.post('/lookup/genres', async (req, res) => {
    const { recording_id: recordingId, release_id: releaseId, artist_id: artistId } = req.body ?? {};
    for (const id of [recordingId, releaseId, artistId]) {
      if (id != null && !UUID.test(id)) throw new HttpError(400, 'Invalid ID');
    }
    res.json({ genres: await musicbrainz.genres({ recordingId, releaseId, artistId }) });
  });

  // Images only, so the droplet's "no audio" rule still holds.
  router.get('/lookup/cover/:releaseId', async (req, res) => {
    if (!UUID.test(req.params.releaseId)) throw new HttpError(400, 'Invalid release');
    const cover = await musicbrainz.cover(req.params.releaseId);
    if (!cover) throw notFound('This release has no cover');
    res.type(cover.type).send(cover.body);
  });

  /** Tells the app whether a picked cover should be applied. */
  const albumState = async (trackId) => {
    const [[row]] = await db.query(
      `SELECT t.album_id, al.cover_r2_key FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.id = ?`,
      [trackId],
    );
    return { album_id: row?.album_id ?? null, album_has_cover: Boolean(row?.cover_r2_key) };
  };

  // ---------- Approval ----------
  const uploadOr404 = async (conn, id) => {
    const [[upload]] = await conn.query('SELECT * FROM uploads WHERE id = ?', [id]);
    if (!upload) throw notFound('Upload not found');
    return upload;
  };

  const describeUpload = async (upload) => {
    const [[uploader]] = await db.query('SELECT display_name FROM users WHERE id = ?', [upload.user_id]);
    const item = {
      id: upload.id,
      status: upload.status,
      original_filename: upload.original_filename,
      size_bytes: upload.size_bytes,
      error_message: upload.error_message,
      created_at: upload.created_at,
      uploaded_by: uploader?.display_name ?? 'Unknown',
      duplicate_of_track_id: upload.duplicate_of_track_id,
      track: null,
    };
    if (upload.duplicate_of_track_id) {
      const [[original]] = await db.query('SELECT title, is_archived, is_deleted FROM tracks WHERE id = ?', [
        upload.duplicate_of_track_id,
      ]);
      item.duplicate_of = original
        ? { title: original.title, can_restore: Boolean(original.is_archived || original.is_deleted) }
        : null;
    }
    if (!upload.track_id) return item;

    const [rows] = await db.query(`SELECT ${trackColumns} FROM tracks t WHERE t.id = ?`, [upload.track_id]);
    if (!rows.length) return item;
    const [track] = await hydrateTracks(deps, rows);
    const [genres] = await db.query(
      'SELECT g.name FROM genres g JOIN track_genres tg ON tg.genre_id = g.id WHERE tg.track_id = ?',
      [upload.track_id],
    );
    item.track = {
      ...track,
      genres: genres.map((row) => row.name),
      acoustid_score: rows[0].acoustid_score,
      metadata_status: rows[0].metadata_status,
    };
    // Q1: flag, don't block. The admin decides.
    if (rows[0].mb_recording_id) {
      const [matches] = await db.query(
        `SELECT title FROM tracks
          WHERE mb_recording_id = ? AND id <> ? AND published_at IS NOT NULL
            AND is_archived = 0 AND is_deleted = 0 LIMIT 1`,
        [rows[0].mb_recording_id, upload.track_id],
      );
      item.possible_duplicate_of = matches[0]?.title ?? null;
    }
    item.will_restore = await hiddenParents(db, upload.track_id);
    return item;
  };

  router.get('/uploads', async (req, res) => {
    const status = String(req.query.status || 'pending_approval');
    const allowed = ['pending_approval', 'failed', 'duplicate'];
    if (!allowed.includes(status)) throw new HttpError(400, 'Unknown status');
    const [rows] = await db.query('SELECT * FROM uploads WHERE status = ? ORDER BY created_at, id', [status]);
    res.json({ items: await Promise.all(rows.map(describeUpload)) });
  });

  router.get('/uploads/:id', async (req, res) => {
    res.json(await describeUpload(await uploadOr404(db, intParam(req.params.id))));
  });

  router.post('/uploads/:id/approve', async (req, res) => {
    const id = intParam(req.params.id);
    const labels = parseLabels(req.body);
    const trackId = await withTransaction(db, async (conn) => {
      const upload = await uploadOr404(conn, id);
      if (upload.status !== 'pending_approval') throw new HttpError(409, 'This upload is not waiting for approval');
      if (Object.keys(labels).length) await applyLabels(conn, upload.track_id, labels);
      await conn.query(
        `UPDATE tracks SET published_at = UTC_TIMESTAMP(), metadata_status = ? WHERE id = ?`,
        [Object.keys(labels).length ? 'manual' : 'verified', upload.track_id],
      );
      await restoreParents(conn, upload.track_id);
      await conn.query(
        `UPDATE uploads SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?`,
        [req.user.id, id],
      );
      return upload.track_id;
    });
    res.json({ status: 'approved', undo_seconds: config.undoWindowSeconds, ...(await albumState(trackId)) });
  });

  router.post('/uploads/:id/reject', async (req, res) => {
    const id = intParam(req.params.id);
    const [result] = await db.query(
      `UPDATE uploads SET status = 'rejected', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = 'pending_approval'`,
      [req.user.id, id],
    );
    if (!result.affectedRows) throw new HttpError(409, 'This upload is not waiting for approval');
    res.json({ status: 'rejected', undo_seconds: config.undoWindowSeconds });
  });

  router.post('/uploads/:id/undo', async (req, res) => {
    const id = intParam(req.params.id);
    await withTransaction(db, async (conn) => {
      const [[upload]] = await conn.query(
        `SELECT *, reviewed_at >= UTC_TIMESTAMP() - INTERVAL ? SECOND AS in_window
           FROM uploads WHERE id = ? FOR UPDATE`,
        [undoSeconds, id],
      );
      if (!upload) throw notFound('Upload not found');
      if (!['approved', 'rejected'].includes(upload.status) || !upload.in_window) {
        throw new HttpError(409, 'Too late to undo');
      }
      await conn.query('UPDATE tracks SET published_at = NULL WHERE id = ?', [upload.track_id]);
      await conn.query(
        `UPDATE uploads SET status = 'pending_approval', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`,
        [id],
      );
    });
    res.json({ status: 'pending_approval' });
  });

  router.post('/uploads/:id/retry', async (req, res) => {
    const id = intParam(req.params.id);
    const [result] = await db.query(
      `UPDATE uploads SET status = 'uploaded', attempts = 0, claimed_at = NULL, error_message = NULL
        WHERE id = ? AND status = 'failed'`,
      [id],
    );
    if (!result.affectedRows) throw new HttpError(409, 'Only failed uploads can be retried');
    await dispatcher.uploadReady(id);
    res.json({ status: 'uploaded' });
  });

  router.post('/uploads/:id/dismiss', async (req, res) => {
    const id = intParam(req.params.id);
    await withTransaction(db, async (conn) => {
      const upload = await uploadOr404(conn, id);
      // Guarded because this deletes whole prefixes.
      if (!['failed', 'duplicate'].includes(upload.status)) {
        throw new HttpError(409, 'Only failed or duplicate uploads can be dismissed');
      }
      await discardUploadFiles(conn, upload, 'dismissed');
      await conn.query('DELETE FROM uploads WHERE id = ?', [id]);
    });
    res.sendStatus(204);
  });

  router.post('/uploads/:id/restore-existing', async (req, res) => {
    const id = intParam(req.params.id);
    await withTransaction(db, async (conn) => {
      const upload = await uploadOr404(conn, id);
      if (upload.status !== 'duplicate' || !upload.duplicate_of_track_id) {
        throw new HttpError(409, 'This upload is not a duplicate');
      }
      await conn.query(
        `UPDATE tracks SET is_archived = 0, archived_at = NULL, archived_by = NULL,
                           is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?`,
        [upload.duplicate_of_track_id],
      );
      await restoreParents(conn, upload.duplicate_of_track_id);
      await discardUploadFiles(conn, upload, 'restored-existing');
      await conn.query('DELETE FROM uploads WHERE id = ?', [id]);
    });
    res.sendStatus(204);
  });

  router.get('/tracks/:id/preview', async (req, res) => {
    const id = intParam(req.params.id);
    const format = req.query.format === 'aac' ? 'aac' : 'opus';
    const [[file]] = await db.query('SELECT r2_key, mime_type FROM track_files WHERE track_id = ? AND kind = ?', [id, format]);
    if (!file) throw notFound('Preview not available');
    res.json({ url: await storage.presignGet(file.r2_key), mime_type: file.mime_type });
  });

  // ---------- Listing ----------
  const viewClause = (req) => {
    const view = String(req.query.view || 'active');
    if (!VIEWS[view]) throw new HttpError(400, 'Unknown view');
    return { view, sql: VIEWS[view] };
  };

  const countViews = async (table, extraActive = '') => {
    const [[row]] = await db.query(
      `SELECT SUM(x.is_archived = 0 AND x.is_deleted = 0 ${extraActive}) AS active,
              SUM(x.is_archived = 1) AS archived, SUM(x.is_deleted = 1) AS deleted
         FROM ${table} x`,
    );
    return { active: Number(row.active ?? 0), archived: Number(row.archived ?? 0), deleted: Number(row.deleted ?? 0) };
  };

  router.get('/tracks', async (req, res) => {
    const { view, sql } = viewClause(req);
    const { limit, offset } = page(req.query);
    const q = String(req.query.q || '').trim();
    const conditions = [sql.replaceAll('x.', 't.')];
    const params = [];
    if (view === 'active') conditions.push('t.published_at IS NOT NULL');
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        `(t.title LIKE ? OR t.id = ? OR EXISTS (
            SELECT 1 FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
             WHERE ta.track_id = t.id AND a.name LIKE ?))`,
      );
      params.push(like, Number(q.replace(/^#/, '')) || 0, like);
    }
    const [rows] = await db.query(
      `SELECT ${trackColumns}, u.display_name AS uploader, t.deleted_at, deleter.display_name AS deleted_by_name
         FROM tracks t
         LEFT JOIN users u ON u.id = t.uploaded_by
         LEFT JOIN users deleter ON deleter.id = t.deleted_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const items = await hydrateTracks(deps, rows);
    res.json({
      items: items.map((item, index) => ({
        ...item,
        uploader: rows[index].uploader,
        metadata_status: rows[index].metadata_status,
        deleted_at: rows[index].deleted_at,
        deleted_by_name: rows[index].deleted_by_name,
      })),
      counts: await countViews('tracks', 'AND x.published_at IS NOT NULL'),
    });
  });

  router.get('/tracks/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const [rows] = await db.query(
      `SELECT ${trackColumns}, u.display_name AS uploader
         FROM tracks t LEFT JOIN users u ON u.id = t.uploaded_by WHERE t.id = ?`,
      [id],
    );
    if (!rows.length) throw notFound('Song not found');
    const [track] = await hydrateTracks(deps, rows);
    const [files] = await db.query(
      `SELECT kind, codec, bitrate_kbps, size_bytes FROM track_files WHERE track_id = ?
        ORDER BY FIELD(kind, 'original', 'opus', 'aac', 'flac')`,
      [id],
    );
    const [genres] = await db.query(
      'SELECT g.name FROM genres g JOIN track_genres tg ON tg.genre_id = g.id WHERE tg.track_id = ?',
      [id],
    );
    res.json({
      ...track,
      uploader: rows[0].uploader,
      metadata_status: rows[0].metadata_status,
      files,
      genres: genres.map((row) => row.name),
    });
  });

  router.get('/artists', async (req, res) => {
    const { sql } = viewClause(req);
    const { limit, offset } = page(req.query);
    const [rows] = await db.query(
      `SELECT x.id, x.name, x.mb_artist_id, x.deleted_at,
              (SELECT COUNT(*) FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
                WHERE ta.artist_id = x.id AND t.is_archived = 0 AND t.is_deleted = 0 AND t.published_at IS NOT NULL) AS active_songs,
              (SELECT COUNT(*) FROM album_artists aa WHERE aa.artist_id = x.id) AS album_count
         FROM artists x WHERE ${sql} ORDER BY active_songs DESC, x.name LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    res.json({ items: rows, counts: await countViews('artists') });
  });

  router.get('/albums', async (req, res) => {
    const { sql } = viewClause(req);
    const { limit, offset } = page(req.query);
    const [rows] = await db.query(
      `SELECT x.id, x.title, x.release_date, x.cover_r2_key, x.mb_release_id, x.deleted_at,
              (SELECT COUNT(*) FROM tracks t
                WHERE t.album_id = x.id AND t.is_archived = 0 AND t.is_deleted = 0 AND t.published_at IS NOT NULL) AS active_songs
         FROM albums x WHERE ${sql} ORDER BY x.title LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    res.json({
      items: await Promise.all(
        rows.map(async ({ cover_r2_key: key, ...row }) => ({ ...row, cover: await coverUrls(storage, key) })),
      ),
      counts: await countViews('albums'),
    });
  });

  router.get('/genres', async (req, res) => {
    const { sql } = viewClause(req);
    const [rows] = await db.query(
      `SELECT x.id, x.name, (SELECT COUNT(*) FROM track_genres tg WHERE tg.genre_id = x.id) AS song_count
         FROM genres x WHERE ${sql} ORDER BY song_count DESC, x.name`,
    );
    res.json({ items: rows, counts: await countViews('genres') });
  });

  router.get('/users', async (req, res) => {
    const { sql } = viewClause(req);
    const [rows] = await db.query(
      `SELECT x.id, x.display_name, x.email, x.role, x.status, x.created_at, x.deleted_at,
              (SELECT COUNT(*) FROM uploads u WHERE u.user_id = x.id) AS upload_count
         FROM users x WHERE ${sql} ORDER BY x.status = 'pending' DESC, x.role, x.display_name`,
    );
    res.json({ items: rows, counts: await countViews('users') });
  });

  router.get('/:type/:id', async (req, res, next) => {
    const type = TYPES[req.params.type];
    if (!type || req.params.type === 'uploads') return next();
    const [[row]] = await db.query(`SELECT * FROM ${type.table} WHERE id = ?`, [intParam(req.params.id)]);
    if (!row) throw notFound();
    const { firebase_uid: _uid, ...safe } = row;
    res.json(safe);
  });

  // ---------- Create / update ----------
  router.post('/artists', async (req, res) => {
    const name = requiredString(req.body?.name, 'Name', 255);
    const [result] = await db.query('INSERT INTO artists (name, sort_name) VALUES (?, ?)', [name, req.body?.sort_name ?? null]);
    res.status(201).json({ id: result.insertId, name });
  });

  router.post('/albums', async (req, res) => {
    const title = requiredString(req.body?.title, 'Title', 255);
    const artistId = intParam(req.body?.artist_id, 'artist_id');
    const id = await withTransaction(db, async (conn) => {
      const [result] = await conn.query('INSERT INTO albums (title, release_date) VALUES (?, ?)', [title, req.body?.release_date ?? null]);
      await conn.query('INSERT INTO album_artists (album_id, artist_id) VALUES (?, ?)', [result.insertId, artistId]);
      return result.insertId;
    });
    res.status(201).json({ id, title });
  });

  router.post('/genres', async (req, res) => {
    const name = requiredString(req.body?.name, 'Name', 100);
    try {
      const [result] = await db.query('INSERT INTO genres (name) VALUES (?)', [name]);
      res.status(201).json({ id: result.insertId, name });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That genre already exists');
      throw error;
    }
  });

  router.post('/tracks', () => {
    throw new HttpError(405, 'Songs are added through the upload page');
  });
  router.post('/users', () => {
    throw new HttpError(405, 'Users are created when they first sign in');
  });

  router.patch('/tracks/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const labels = parseLabels(req.body);
    await withTransaction(db, async (conn) => {
      const [[track]] = await conn.query('SELECT id FROM tracks WHERE id = ?', [id]);
      if (!track) throw notFound('Song not found');
      await applyLabels(conn, id, labels);
      await conn.query("UPDATE tracks SET metadata_status = 'manual' WHERE id = ?", [id]);
    });
    res.json(await albumState(id));
  });

  router.patch('/artists/:id', async (req, res) => {
    const name = requiredString(req.body?.name, 'Name', 255);
    await db.query('UPDATE artists SET name = ? WHERE id = ?', [name, intParam(req.params.id)]);
    res.sendStatus(204);
  });

  router.patch('/albums/:id', async (req, res) => {
    const title = requiredString(req.body?.title, 'Title', 255);
    await db.query('UPDATE albums SET title = ? WHERE id = ?', [title, intParam(req.params.id)]);
    res.sendStatus(204);
  });

  router.patch('/genres/:id', async (req, res) => {
    const name = requiredString(req.body?.name, 'Name', 100);
    try {
      await db.query('UPDATE genres SET name = ? WHERE id = ?', [name, intParam(req.params.id)]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That genre already exists');
      throw error;
    }
    res.sendStatus(204);
  });

  const notSelf = (req, id) => {
    if (id === req.user.id) throw new HttpError(403, "You can't do this to your own account");
  };

  router.patch('/users/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const fields = [];
    const params = [];
    if (req.body?.display_name !== undefined) {
      fields.push('display_name = ?');
      params.push(requiredString(req.body.display_name, 'Name', 100));
    }
    if (req.body?.status !== undefined) {
      notSelf(req, id);
      if (!['approved', 'blocked'].includes(req.body.status)) throw new HttpError(400, 'Unknown status');
      fields.push('status = ?');
      params.push(req.body.status);
      if (req.body.status === 'approved') {
        fields.push('approved_by = ?', 'approved_at = UTC_TIMESTAMP()');
        params.push(req.user.id);
      }
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update');
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    res.sendStatus(204);
  });

  // ---------- Archive / soft delete / restore / hard delete ----------
  const typeParam = (req) => {
    const type = TYPES[req.params.type];
    if (!type) throw notFound();
    return type;
  };

  /** "Can't archive X yet" guard (build §9). */
  const assertNoActiveSongs = async (typeName, id, verb) => {
    if (typeName !== 'artists' && typeName !== 'albums') return;
    const active = 't.is_archived = 0 AND t.is_deleted = 0 AND t.published_at IS NOT NULL';
    const [[row]] =
      typeName === 'artists'
        ? await db.query(
            `SELECT a.name AS label, (SELECT COUNT(*) FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
               WHERE ta.artist_id = a.id AND ${active}) AS songs FROM artists a WHERE a.id = ?`,
            [id],
          )
        : await db.query(
            `SELECT al.title AS label, (SELECT COUNT(*) FROM tracks t WHERE t.album_id = al.id AND ${active}) AS songs
               FROM albums al WHERE al.id = ?`,
            [id],
          );
    if (!row) throw notFound();
    if (row.songs > 0) {
      const noun = row.songs === 1 ? 'song is' : 'songs are';
      throw new HttpError(409, `Can't ${verb} ${row.label} yet — ${row.songs} ${noun} still active`, { songs: row.songs });
    }
  };

  const changeState = (table, id, sql, params = []) => db.query(`UPDATE ${table} SET ${sql} WHERE id = ?`, [...params, id]);

  router.post('/:type/:id/archive', async (req, res) => {
    const { table } = typeParam(req);
    const id = intParam(req.params.id);
    if (table === 'users') notSelf(req, id);
    await assertNoActiveSongs(table, id, 'archive');
    await changeState(
      table,
      id,
      `is_archived = 1, archived_at = UTC_TIMESTAMP(), archived_by = ?,
       is_deleted = 0, deleted_at = NULL, deleted_by = NULL`,
      [req.user.id],
    );
    res.sendStatus(204);
  });

  router.post('/:type/:id/unarchive', async (req, res) => {
    const { table } = typeParam(req);
    await changeState(table, intParam(req.params.id), 'is_archived = 0, archived_at = NULL, archived_by = NULL');
    res.sendStatus(204);
  });

  router.post('/:type/:id/restore', async (req, res) => {
    const { table } = typeParam(req);
    await changeState(table, intParam(req.params.id), 'is_deleted = 0, deleted_at = NULL, deleted_by = NULL');
    res.sendStatus(204);
  });

  router.delete('/:type/:id', async (req, res) => {
    const { table } = typeParam(req);
    const id = intParam(req.params.id);
    if (table === 'users') notSelf(req, id);
    await assertNoActiveSongs(table, id, 'delete');
    await changeState(
      table,
      id,
      `is_deleted = 1, deleted_at = UTC_TIMESTAMP(), deleted_by = ?,
       is_archived = 0, archived_at = NULL, archived_by = NULL`,
      [req.user.id],
    );
    res.sendStatus(204);
  });

  router.delete('/:type/:id/permanent', async (req, res) => {
    const { table } = typeParam(req);
    const id = intParam(req.params.id);
    if (table === 'users') notSelf(req, id);

    const [[row]] = await db.query(`SELECT is_deleted FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw notFound();
    if (!row.is_deleted) throw new HttpError(409, 'Move it to Deleted first');

    await withTransaction(db, async (conn) => {
      if (table === 'tracks') {
        await conn.query('DELETE FROM uploads WHERE track_id = ?', [id]);
        await hardDeleteTrack(conn, id, 'hard-delete');
      } else if (table === 'albums' || table === 'artists') {
        // Patch 3 §2: refuse while any track row still references it.
        const [[used]] =
          table === 'albums'
            ? await conn.query('SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?', [id])
            : await conn.query('SELECT COUNT(*) AS n FROM track_artists WHERE artist_id = ?', [id]);
        if (used.n > 0) {
          const noun = used.n === 1 ? 'song still uses' : 'songs still use';
          throw new HttpError(409, `${used.n} ${noun} this. Permanently delete those first.`);
        }
        if (table === 'albums') {
          const [[album]] = await conn.query('SELECT cover_r2_key FROM albums WHERE id = ?', [id]);
          await queueR2Delete(conn, album.cover_r2_key, 'hard-delete', true);
        }
        await conn.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
      } else if (table === 'users') {
        // Cascades remove their uploads; files of unfinished ones go too.
        const [open] = await conn.query(
          "SELECT * FROM uploads WHERE user_id = ? AND status NOT IN ('approved', 'pending_approval')",
          [id],
        );
        for (const upload of open) await discardUploadFiles(conn, upload, 'user-deleted');
        await conn.query('DELETE FROM users WHERE id = ?', [id]);
      } else {
        await conn.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
      }
    });
    res.sendStatus(204);
  });

  // ---------- Replace artwork (patch 3 §6) ----------
  router.post('/albums/:id/artwork', async (req, res) => {
    const id = intParam(req.params.id);
    const [[album]] = await db.query('SELECT id FROM albums WHERE id = ?', [id]);
    if (!album) throw notFound('Album not found');
    const prefix = `artwork/${randomUUID()}/`;
    const urls = {};
    for (const size of [96, 256, 512]) {
      urls[size] = await storage.presignPut(`${prefix}${size}.jpg`, 'image/jpeg');
    }
    res.json({ prefix, urls });
  });

  router.post('/albums/:id/artwork/complete', async (req, res) => {
    const id = intParam(req.params.id);
    const prefix = String(req.body?.prefix || '');
    if (!/^artwork\/[0-9a-f-]{36}\/$/.test(prefix)) throw new HttpError(400, 'Invalid prefix');
    for (const size of [96, 256, 512]) {
      if (!(await storage.exists(`${prefix}${size}.jpg`))) throw new HttpError(409, 'Artwork has not finished uploading');
    }
    await withTransaction(db, async (conn) => {
      const [[album]] = await conn.query('SELECT cover_r2_key FROM albums WHERE id = ? FOR UPDATE', [id]);
      if (!album) throw notFound('Album not found');
      await conn.query('UPDATE albums SET cover_r2_key = ? WHERE id = ?', [prefix, id]);
      await queueR2Delete(conn, album.cover_r2_key, 'artwork-replaced', true);
    });
    res.sendStatus(204);
  });

  return router;
}
