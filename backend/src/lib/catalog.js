// Finding or creating artists, albums and genres, used by both the
// processor's /result route and the admin's label edits.

const insertId = ([result]) => result.insertId;

export async function findOrCreateArtist(conn, { name, sort_name: sortName = null, mb_artist_id: mbId = null }) {
  if (mbId) {
    const [[byMbid]] = await conn.query('SELECT id FROM artists WHERE mb_artist_id = ?', [mbId]);
    if (byMbid) return byMbid.id;
  }
  // utf8mb4_0900_ai_ci makes this match ignore case and accents.
  const [[byName]] = await conn.query('SELECT id, mb_artist_id FROM artists WHERE name = ? LIMIT 1', [name]);
  if (byName) {
    if (mbId && !byName.mb_artist_id) {
      await conn.query('UPDATE artists SET mb_artist_id = ? WHERE id = ?', [mbId, byName.id]);
    }
    return byName.id;
  }
  return insertId(
    await conn.query('INSERT INTO artists (name, sort_name, mb_artist_id) VALUES (?, ?, ?)', [name, sortName, mbId]),
  );
}

/** Returns the album plus whether it was created by this call. */
export async function findOrCreateAlbum(conn, album, primaryArtistId) {
  const { title, release_date: releaseDate = null, mb_release_id: mbId = null } = album;
  if (mbId) {
    const [[found]] = await conn.query('SELECT * FROM albums WHERE mb_release_id = ?', [mbId]);
    if (found) return { album: found, created: false };
  }
  // Same title and artist, not yet linked to a different release.
  const [[sameName]] = await conn.query(
    `SELECT al.* FROM albums al
       JOIN album_artists aa ON aa.album_id = al.id
      WHERE al.title = ? AND aa.artist_id = ? AND (? IS NULL OR al.mb_release_id IS NULL)
      LIMIT 1`,
    [title, primaryArtistId, mbId],
  );
  if (sameName) {
    if (mbId) await conn.query('UPDATE albums SET mb_release_id = ? WHERE id = ?', [mbId, sameName.id]);
    return { album: sameName, created: false };
  }
  const id = insertId(
    await conn.query('INSERT INTO albums (title, release_date, mb_release_id) VALUES (?, ?, ?)', [title, releaseDate, mbId]),
  );
  await conn.query('INSERT INTO album_artists (album_id, artist_id) VALUES (?, ?)', [id, primaryArtistId]);
  const [[created]] = await conn.query('SELECT * FROM albums WHERE id = ?', [id]);
  return { album: created, created: true };
}

export async function setTrackArtists(conn, trackId, artists) {
  await conn.query('DELETE FROM track_artists WHERE track_id = ?', [trackId]);
  let position = 1;
  for (const artist of artists) {
    const artistId = await findOrCreateArtist(conn, artist);
    await conn.query(
      `INSERT INTO track_artists (track_id, artist_id, credit, position) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE position = VALUES(position)`,
      [trackId, artistId, artist.credit === 'featured' ? 'featured' : 'primary', position],
    );
    position += 1;
  }
}

export async function setTrackGenres(conn, trackId, names) {
  await conn.query('DELETE FROM track_genres WHERE track_id = ?', [trackId]);
  for (const name of new Set(names.map((value) => value.trim()).filter(Boolean))) {
    const [[genre]] = await conn.query('SELECT id FROM genres WHERE name = ?', [name]);
    const genreId = genre ? genre.id : insertId(await conn.query('INSERT INTO genres (name) VALUES (?)', [name]));
    await conn.query('INSERT IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?)', [trackId, genreId]);
  }
}

/**
 * Applies the Edit labels form: title, artist, album, year, genres.
 * Any field left undefined stays as it is.
 */
export async function applyLabels(conn, trackId, labels) {
  const { title, artist, album, year, genres, mb_recording_id: recordingId, mb_release_id: releaseId, mb_artist_id: artistId } = labels;
  if (title !== undefined) {
    await conn.query('UPDATE tracks SET title = ? WHERE id = ?', [title, trackId]);
  }
  if (artist !== undefined) {
    await setTrackArtists(conn, trackId, [{ name: artist, mb_artist_id: artistId ?? null }]);
  }
  if (album !== undefined) {
    if (!album) {
      await conn.query('UPDATE tracks SET album_id = NULL WHERE id = ?', [trackId]);
    } else {
      const [[primary]] = await conn.query(
        'SELECT artist_id FROM track_artists WHERE track_id = ? ORDER BY position LIMIT 1',
        [trackId],
      );
      const { album: row } = await findOrCreateAlbum(conn, { title: album, mb_release_id: releaseId ?? null }, primary.artist_id);
      await conn.query('UPDATE tracks SET album_id = ? WHERE id = ?', [row.id, trackId]);
    }
  }
  if (year !== undefined) {
    const [[track]] = await conn.query('SELECT album_id FROM tracks WHERE id = ?', [trackId]);
    if (track.album_id) {
      const date = year ? `${year}-01-01` : null;
      await conn.query('UPDATE albums SET release_date = ? WHERE id = ?', [date, track.album_id]);
    }
  }
  if (genres !== undefined) await setTrackGenres(conn, trackId, genres);
  if (recordingId) await conn.query('UPDATE tracks SET mb_recording_id = ? WHERE id = ?', [recordingId, trackId]);
}

/**
 * Approval decision: a track approved onto an archived or deleted album or
 * artist would be live but hidden, so bring those back. Recorded in
 * what_can_be_improve.md because the owner has not confirmed it yet.
 */
export async function restoreParents(conn, trackId) {
  const restore = `is_archived = 0, archived_at = NULL, archived_by = NULL,
                   is_deleted = 0, deleted_at = NULL, deleted_by = NULL`;
  await conn.query(
    `UPDATE albums SET ${restore}
      WHERE id = (SELECT album_id FROM tracks WHERE id = ?) AND (is_archived = 1 OR is_deleted = 1)`,
    [trackId],
  );
  await conn.query(
    `UPDATE artists SET ${restore}
      WHERE id IN (SELECT artist_id FROM track_artists WHERE track_id = ?) AND (is_archived = 1 OR is_deleted = 1)`,
    [trackId],
  );
}

/** Albums/artists on this track that are currently hidden, for the card note. */
export async function hiddenParents(db, trackId) {
  const [albums] = await db.query(
    `SELECT al.title FROM albums al JOIN tracks t ON t.album_id = al.id
      WHERE t.id = ? AND (al.is_archived = 1 OR al.is_deleted = 1)`,
    [trackId],
  );
  const [artists] = await db.query(
    `SELECT a.name FROM artists a JOIN track_artists ta ON ta.artist_id = a.id
      WHERE ta.track_id = ? AND (a.is_archived = 1 OR a.is_deleted = 1)`,
    [trackId],
  );
  return [...albums.map((row) => row.title), ...artists.map((row) => row.name)];
}
