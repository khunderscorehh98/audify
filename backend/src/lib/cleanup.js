// Removing things for good. Database rows go in a transaction; R2 objects go
// through r2_cleanup_queue, so a failed delete is retried rather than lost.

export async function queueR2Delete(conn, key, reason, isPrefix = false) {
  if (!key) return;
  await conn.query(
    `INSERT INTO r2_cleanup_queue (r2_key, is_prefix, reason, next_attempt_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE next_attempt_at = UTC_TIMESTAMP()`,
    [key, isPrefix ? 1 : 0, reason.slice(0, 50)],
  );
}

const exists = async (conn, sql, params) => {
  const [[row]] = await conn.query(`SELECT EXISTS (${sql}) AS found`, params);
  return Boolean(row.found);
};

/**
 * Deletes a track and whatever only it was using.
 * Patch 3 §2: an album (with its cover) or artist survives if ANY other track
 * row references it, whatever that track's state (pending, archived, deleted).
 */
export async function hardDeleteTrack(conn, trackId, reason) {
  const [[track]] = await conn.query('SELECT id, album_id FROM tracks WHERE id = ? FOR UPDATE', [trackId]);
  if (!track) return false;

  const [files] = await conn.query('SELECT r2_key FROM track_files WHERE track_id = ?', [trackId]);
  const [artists] = await conn.query('SELECT artist_id FROM track_artists WHERE track_id = ?', [trackId]);

  for (const file of files) await queueR2Delete(conn, file.r2_key, reason);

  // Keep the album if another track uses it.
  let album = null;
  if (track.album_id) {
    const shared = await exists(conn, 'SELECT 1 FROM tracks WHERE album_id = ? AND id <> ?', [track.album_id, trackId]);
    if (!shared) {
      [[album]] = await conn.query('SELECT id, cover_r2_key FROM albums WHERE id = ?', [track.album_id]);
    }
  }

  await conn.query('DELETE FROM tracks WHERE id = ?', [trackId]); // cascades files, likes, plays, playlists

  if (album) {
    if (album.cover_r2_key) await queueR2Delete(conn, album.cover_r2_key, reason, true);
    await conn.query('DELETE FROM albums WHERE id = ?', [album.id]); // cascades album_artists
  }

  for (const { artist_id: artistId } of artists) {
    const stillCredited =
      (await exists(conn, 'SELECT 1 FROM track_artists WHERE artist_id = ?', [artistId])) ||
      (await exists(conn, 'SELECT 1 FROM album_artists WHERE artist_id = ?', [artistId]));
    if (!stillCredited) await conn.query('DELETE FROM artists WHERE id = ?', [artistId]);
  }
  return true;
}

/** Removes an upload row and every object it may have produced. */
export async function discardUploadFiles(conn, upload, reason) {
  await queueR2Delete(conn, upload.inbox_r2_key, reason);
  await queueR2Delete(conn, `tracks/${upload.upload_uuid}/`, reason, true);
  await queueR2Delete(conn, `artwork/${upload.upload_uuid}/`, reason, true);
}
