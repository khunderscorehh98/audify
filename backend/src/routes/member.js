import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { HttpError, intParam, notFound, page, requiredString } from '../lib/http.js';
import { withTransaction } from '../db.js';
import { queueR2Delete } from '../lib/cleanup.js';
import { toBooleanQuery } from '../lib/search.js';
import {
  PLAYABLE,
  VISIBLE_ALBUM,
  VISIBLE_ARTIST,
  coverUrls,
  hydrateTracks,
  selectTracks,
} from '../lib/tracks.js';
import { requireMember } from '../auth.js';

const STREAM_KINDS = new Set(['opus', 'aac', 'flac']);

export function memberRouter(deps) {
  const { db, storage, config, dispatcher } = deps;
  const router = Router();
  router.use(requireMember);

  const playableTrackOr404 = async (id) => {
    const [[row]] = await db.query(`SELECT t.id FROM tracks t WHERE t.id = ? AND ${PLAYABLE}`, [id]);
    if (!row) throw notFound('Song not found');
  };

  // ---------- Library ----------
  router.get('/tracks', async (req, res) => {
    const { limit, offset } = page(req.query);
    const rows = await selectTracks(db, PLAYABLE, [], 't.title', limit, offset);
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tracks t WHERE ${PLAYABLE}`);
    res.json({ items: await hydrateTracks(deps, rows, req.user.id), total });
  });

  router.get('/tracks/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const rows = await selectTracks(db, `t.id = ? AND ${PLAYABLE}`, [id]);
    if (!rows.length) throw notFound('Song not found');
    res.json((await hydrateTracks(deps, rows, req.user.id))[0]);
  });

  router.get('/tracks/:id/stream', async (req, res) => {
    const id = intParam(req.params.id);
    const format = String(req.query.format || 'opus');
    if (!STREAM_KINDS.has(format)) throw new HttpError(400, 'Unknown format');
    await playableTrackOr404(id);

    const [files] = await db.query(
      'SELECT kind, r2_key, mime_type, codec, bitrate_kbps, size_bytes FROM track_files WHERE track_id = ?',
      [id],
    );
    // Patch 2 §5: a FLAC original doubles as the lossless stream.
    const file =
      files.find((row) => row.kind === format) ||
      (format === 'flac' ? files.find((row) => row.kind === 'original' && row.codec === 'flac') : undefined);
    if (!file) throw notFound('Format not available');

    res.json({
      url: await storage.presignGet(file.r2_key),
      format,
      mime_type: file.mime_type,
      bitrate_kbps: file.bitrate_kbps,
      size_bytes: file.size_bytes,
      expires_in: config.presignGetSeconds,
    });
  });

  router.get('/artists', async (req, res) => {
    const { limit, offset } = page(req.query);
    const [rows] = await db.query(
      `SELECT a.id, a.name, COUNT(DISTINCT t.id) AS song_count
         FROM artists a
         JOIN track_artists ta ON ta.artist_id = a.id
         JOIN tracks t ON t.id = ta.track_id AND ${PLAYABLE}
        WHERE ${VISIBLE_ARTIST}
        GROUP BY a.id ORDER BY a.name LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    res.json({ items: rows });
  });

  router.get('/artists/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const [[artist]] = await db.query(`SELECT a.id, a.name FROM artists a WHERE a.id = ? AND ${VISIBLE_ARTIST}`, [id]);
    if (!artist) throw notFound('Artist not found');

    // Q2: "Popular in your library" = play counts across all users.
    const [popular] = await db.query(
      `SELECT t.id, t.title, t.album_id, t.disc_number, t.track_number, t.duration_ms, t.published_at
         FROM tracks t
         JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = ?
         LEFT JOIN play_history p ON p.track_id = t.id
        WHERE ${PLAYABLE}
        GROUP BY t.id ORDER BY COUNT(p.id) DESC, t.title`,
      [id],
    );
    const [albums] = await db.query(
      `SELECT al.id, al.title, al.release_date, al.cover_r2_key, COUNT(DISTINCT t.id) AS song_count
         FROM albums al
         JOIN tracks t ON t.album_id = al.id AND ${PLAYABLE}
         JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = ?
        WHERE ${VISIBLE_ALBUM}
        GROUP BY al.id ORDER BY al.release_date DESC`,
      [id],
    );
    res.json({
      ...artist,
      song_count: popular.length,
      tracks: await hydrateTracks(deps, popular, req.user.id),
      albums: await Promise.all(albums.map((album) => serializeAlbum(album))),
    });
  });

  const serializeAlbum = async (album) => ({
    id: album.id,
    title: album.title,
    year: album.release_date ? new Date(album.release_date).getUTCFullYear() : null,
    song_count: album.song_count,
    cover: await coverUrls(storage, album.cover_r2_key),
  });

  router.get('/albums', async (req, res) => {
    const { limit, offset } = page(req.query);
    const [rows] = await db.query(
      `SELECT al.id, al.title, al.release_date, al.cover_r2_key, COUNT(t.id) AS song_count
         FROM albums al JOIN tracks t ON t.album_id = al.id AND ${PLAYABLE}
        WHERE ${VISIBLE_ALBUM}
        GROUP BY al.id ORDER BY al.title LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const [artistRows] = rows.length
      ? await db.query(
          `SELECT aa.album_id, a.id, a.name FROM album_artists aa JOIN artists a ON a.id = aa.artist_id
            WHERE aa.album_id IN (?) ORDER BY aa.position`,
          [rows.map((row) => row.id)],
        )
      : [[]];
    res.json({
      items: await Promise.all(
        rows.map(async (row) => ({
          ...(await serializeAlbum(row)),
          artists: artistRows.filter((a) => a.album_id === row.id).map(({ id, name }) => ({ id, name })),
        })),
      ),
    });
  });

  router.get('/albums/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const [[album]] = await db.query(
      `SELECT al.id, al.title, al.release_date, al.cover_r2_key FROM albums al WHERE al.id = ? AND ${VISIBLE_ALBUM}`,
      [id],
    );
    if (!album) throw notFound('Album not found');
    const rows = await selectTracks(
      db,
      `t.album_id = ? AND ${PLAYABLE}`,
      [id],
      'COALESCE(t.disc_number, 1), t.track_number IS NULL, t.track_number, t.title',
      500,
    );
    const [artists] = await db.query(
      `SELECT a.id, a.name FROM album_artists aa JOIN artists a ON a.id = aa.artist_id
        WHERE aa.album_id = ? ORDER BY aa.position`,
      [id],
    );
    res.json({
      ...(await serializeAlbum({ ...album, song_count: rows.length })),
      artists,
      tracks: await hydrateTracks(deps, rows, req.user.id),
    });
  });

  // ---------- Search ----------
  router.get('/search', async (req, res) => {
    const query = toBooleanQuery(req.query.q);
    if (!query) return res.json({ artists: [], albums: [], tracks: [] });

    const [idRows] = await db.query(
      `SELECT id FROM (
         SELECT t.id FROM tracks t WHERE MATCH(t.title) AGAINST (? IN BOOLEAN MODE)
         UNION
         SELECT ta.track_id FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
          WHERE MATCH(a.name) AGAINST (? IN BOOLEAN MODE)
       ) AS matches`,
      [query, query],
    );
    const ids = idRows.map((row) => row.id);
    const rows = ids.length ? await selectTracks(db, `t.id IN (?) AND ${PLAYABLE}`, [ids], 't.title', 30) : [];

    const [artists] = await db.query(
      `SELECT a.id, a.name, COUNT(DISTINCT t.id) AS song_count
         FROM artists a
         JOIN track_artists ta ON ta.artist_id = a.id
         JOIN tracks t ON t.id = ta.track_id AND ${PLAYABLE}
        WHERE MATCH(a.name) AGAINST (? IN BOOLEAN MODE) AND ${VISIBLE_ARTIST}
        GROUP BY a.id ORDER BY song_count DESC LIMIT 10`,
      [query],
    );
    const [albums] = await db.query(
      `SELECT al.id, al.title, al.release_date, al.cover_r2_key, COUNT(t.id) AS song_count
         FROM albums al JOIN tracks t ON t.album_id = al.id AND ${PLAYABLE}
        WHERE MATCH(al.title) AGAINST (? IN BOOLEAN MODE) AND ${VISIBLE_ALBUM}
        GROUP BY al.id ORDER BY al.title LIMIT 10`,
      [query],
    );
    res.json({
      artists,
      albums: await Promise.all(albums.map(serializeAlbum)),
      tracks: await hydrateTracks(deps, rows, req.user.id),
    });
  });

  // ---------- Playlists ----------
  const ownPlaylistOr404 = async (id, userId) => {
    const [[playlist]] = await db.query('SELECT * FROM playlists WHERE id = ? AND user_id = ?', [id, userId]);
    if (!playlist) throw notFound('Playlist not found');
    return playlist;
  };

  router.get('/playlists', async (req, res) => {
    const [rows] = await db.query(
      `SELECT p.id, p.name, p.updated_at, COUNT(t.id) AS song_count,
              COALESCE(SUM(t.duration_ms), 0) AS duration_ms
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks t ON t.id = pt.track_id AND ${PLAYABLE}
        WHERE p.user_id = ?
        GROUP BY p.id ORDER BY p.created_at`,
      [req.user.id],
    );
    res.json({ items: rows.map((row) => ({ ...row, duration_ms: Number(row.duration_ms) })) });
  });

  router.post('/playlists', async (req, res) => {
    const name = requiredString(req.body?.name, 'Name', 150);
    const [result] = await db.query('INSERT INTO playlists (user_id, name) VALUES (?, ?)', [req.user.id, name]);
    res.status(201).json({ id: result.insertId, name, song_count: 0, duration_ms: 0 });
  });

  router.get('/playlists/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const playlist = await ownPlaylistOr404(id, req.user.id);
    const [rows] = await db.query(
      `SELECT t.id, t.title, t.album_id, t.disc_number, t.track_number, t.duration_ms, t.published_at, pt.position
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = ? AND ${PLAYABLE}
        ORDER BY pt.position`,
      [id],
    );
    res.json({
      id: playlist.id,
      name: playlist.name,
      song_count: rows.length,
      duration_ms: rows.reduce((sum, row) => sum + row.duration_ms, 0),
      tracks: await hydrateTracks(deps, rows, req.user.id),
    });
  });

  router.patch('/playlists/:id', async (req, res) => {
    const id = intParam(req.params.id);
    await ownPlaylistOr404(id, req.user.id);
    const name = requiredString(req.body?.name, 'Name', 150);
    await db.query('UPDATE playlists SET name = ? WHERE id = ?', [name, id]);
    res.json({ id, name });
  });

  router.delete('/playlists/:id', async (req, res) => {
    const id = intParam(req.params.id);
    await ownPlaylistOr404(id, req.user.id);
    await db.query('DELETE FROM playlists WHERE id = ?', [id]);
    res.sendStatus(204);
  });

  router.post('/playlists/:id/tracks', async (req, res) => {
    const id = intParam(req.params.id);
    await ownPlaylistOr404(id, req.user.id);
    const trackId = intParam(req.body?.track_id, 'track_id');
    await playableTrackOr404(trackId);
    const [result] = await db.query(
      `INSERT IGNORE INTO playlist_tracks (playlist_id, track_id, position)
       SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?`,
      [id, trackId, id],
    );
    await db.query('UPDATE playlists SET updated_at = UTC_TIMESTAMP() WHERE id = ?', [id]);
    res.status(result.affectedRows ? 201 : 200).json({ added: Boolean(result.affectedRows) });
  });

  // Body: { track_ids: [...] } in the new order.
  router.patch('/playlists/:id/tracks', async (req, res) => {
    const id = intParam(req.params.id);
    await ownPlaylistOr404(id, req.user.id);
    const ids = req.body?.track_ids;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'track_ids is required');
    let position = 1;
    for (const trackId of ids) {
      await db.query('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?', [
        position,
        id,
        intParam(trackId, 'track_id'),
      ]);
      position += 1;
    }
    res.sendStatus(204);
  });

  router.delete('/playlists/:id/tracks/:trackId', async (req, res) => {
    const id = intParam(req.params.id);
    await ownPlaylistOr404(id, req.user.id);
    await db.query('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [
      id,
      intParam(req.params.trackId, 'trackId'),
    ]);
    res.sendStatus(204);
  });

  // ---------- Likes ----------
  router.get('/likes', async (req, res) => {
    const [rows] = await db.query(
      `SELECT t.id, t.title, t.album_id, t.disc_number, t.track_number, t.duration_ms, t.published_at, l.liked_at
         FROM liked_tracks l JOIN tracks t ON t.id = l.track_id
        WHERE l.user_id = ? AND ${PLAYABLE}
        ORDER BY l.liked_at DESC`,
      [req.user.id],
    );
    const tracks = await hydrateTracks(deps, rows, req.user.id);
    res.json({
      items: tracks.map((track, index) => ({ ...track, liked_at: rows[index].liked_at })),
      duration_ms: rows.reduce((sum, row) => sum + row.duration_ms, 0),
    });
  });

  router.put('/likes/:trackId', async (req, res) => {
    const trackId = intParam(req.params.trackId, 'trackId');
    await playableTrackOr404(trackId);
    await db.query('INSERT IGNORE INTO liked_tracks (user_id, track_id) VALUES (?, ?)', [req.user.id, trackId]);
    res.sendStatus(204);
  });

  router.delete('/likes/:trackId', async (req, res) => {
    await db.query('DELETE FROM liked_tracks WHERE user_id = ? AND track_id = ?', [
      req.user.id,
      intParam(req.params.trackId, 'trackId'),
    ]);
    res.sendStatus(204);
  });

  // ---------- Play history ----------
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Patches 2 §5 and 3 §7. Each item stands alone, so one bad play can't
  // block the rest of an offline batch.
  router.post('/plays', async (req, res) => {
    const plays = req.body?.plays;
    if (!Array.isArray(plays) || plays.length > 500) throw new HttpError(400, 'plays must be an array of up to 500');

    const trackIds = [...new Set(plays.map((play) => play?.track_id).filter((id) => Number.isInteger(id) && id > 0))];
    const [rows] = trackIds.length
      ? await db.query('SELECT id, duration_ms FROM tracks WHERE id IN (?)', [trackIds])
      : [[]];
    const durations = new Map(rows.map((row) => [row.id, row.duration_ms]));
    const latest = Date.now() + config.playClockSkewMin * 60_000;

    const accepted = [];
    const failed = [];
    const dropped = [];
    for (const play of plays) {
      const clientId = play?.client_play_id;
      if (typeof clientId !== 'string' || !UUID.test(clientId)) {
        failed.push({ client_play_id: clientId ?? null, reason: 'Invalid client_play_id' });
        continue;
      }
      if (!Number.isInteger(play.track_id) || play.track_id <= 0) {
        failed.push({ client_play_id: clientId, reason: 'Invalid track_id' });
        continue;
      }
      const playedAt = new Date(play.played_at);
      if (typeof play.played_at !== 'string' || Number.isNaN(playedAt.getTime()) || playedAt.getTime() > latest) {
        failed.push({ client_play_id: clientId, reason: 'Invalid played_at' });
        continue;
      }
      if (!durations.has(play.track_id)) {
        // Hard-deleted while the phone was offline. Tell it to stop retrying.
        dropped.push(clientId);
        continue;
      }
      const ms = Math.min(Math.max(Math.round(Number(play.ms_played) || 0), 0), durations.get(play.track_id));
      await db.query(
        `INSERT INTO play_history (user_id, client_play_id, track_id, played_at, ms_played, was_offline)
         VALUES (?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE id = play_history.id`,
        [req.user.id, clientId, play.track_id, playedAt, ms, play.was_offline ? 1 : 0],
      );
      accepted.push(clientId);
    }
    res.json({ accepted, failed, dropped });
  });

  router.get('/plays/recent', async (req, res) => {
    const { limit, offset } = page(req.query, { defaultLimit: 50 });
    const [plays] = await db.query(
      `SELECT p.id AS play_id, p.played_at, p.was_offline,
              t.id, t.title, t.album_id, t.disc_number, t.track_number, t.duration_ms, t.published_at
         FROM play_history p JOIN tracks t ON t.id = p.track_id
        WHERE p.user_id = ? AND ${PLAYABLE}
        ORDER BY p.played_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset],
    );
    const tracks = await hydrateTracks(deps, plays, req.user.id);
    res.json({
      items: tracks.map((track, index) => ({
        ...track,
        play_id: plays[index].play_id,
        played_at: plays[index].played_at,
        was_offline: Boolean(plays[index].was_offline),
      })),
    });
  });

  // ---------- Uploads ----------
  router.post('/uploads', async (req, res) => {
    const filename = requiredString(req.body?.filename, 'filename', 255);
    const size = Number(req.body?.size_bytes);
    if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, 'Invalid size_bytes');
    if (size > config.maxUploadBytes) throw new HttpError(413, 'That file is too large');
    const contentType =
      typeof req.body?.content_type === 'string' && req.body.content_type.length <= 100
        ? req.body.content_type
        : 'application/octet-stream';

    const uuid = randomUUID();
    const key = `inbox/${uuid}`;
    const [result] = await db.query(
      `INSERT INTO uploads (user_id, upload_uuid, inbox_r2_key, original_filename, size_bytes)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, uuid, key, filename, size],
    );
    res.status(201).json({
      id: result.insertId,
      upload_url: await storage.presignPut(key, contentType),
      content_type: contentType,
    });
  });

  router.post('/uploads/:id/complete', async (req, res) => {
    const id = intParam(req.params.id);
    const [[upload]] = await db.query('SELECT * FROM uploads WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!upload) throw notFound('Upload not found');
    if (upload.status !== 'awaiting_upload') return res.json({ id, status: upload.status });
    if (!(await storage.exists(upload.inbox_r2_key))) throw new HttpError(409, 'The file has not arrived yet');

    await db.query("UPDATE uploads SET status = 'uploaded' WHERE id = ? AND status = 'awaiting_upload'", [id]);
    await dispatcher.uploadReady(id);
    res.json({ id, status: 'uploaded' });
  });

  // Possible until the processor claims it. The lock stops the two racing.
  router.delete('/uploads/:id', async (req, res) => {
    const id = intParam(req.params.id);
    await withTransaction(db, async (conn) => {
      const [[upload]] = await conn.query('SELECT * FROM uploads WHERE id = ? AND user_id = ? FOR UPDATE', [id, req.user.id]);
      if (!upload) throw notFound('Upload not found');
      if (!['awaiting_upload', 'uploaded'].includes(upload.status)) {
        throw new HttpError(409, "It's already being processed, so it can't be cancelled");
      }
      await queueR2Delete(conn, upload.inbox_r2_key, 'cancelled');
      await conn.query('DELETE FROM uploads WHERE id = ?', [id]);
    });
    res.sendStatus(204);
  });

  router.get('/uploads/mine', async (req, res) => {
    // Rejected uploads vanish for the uploader, even during the undo window.
    const [rows] = await db.query(
      `SELECT id, original_filename, size_bytes, status, created_at
         FROM uploads WHERE user_id = ? AND status <> 'rejected'
        ORDER BY created_at DESC, id DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ items: rows });
  });

  return router;
}
