// Shared track queries. Every member-facing query uses PLAYABLE so that
// unpublished, archived and deleted songs can never leak out.

export const PLAYABLE = 't.published_at IS NOT NULL AND t.is_archived = 0 AND t.is_deleted = 0';
export const VISIBLE_ARTIST = 'a.is_archived = 0 AND a.is_deleted = 0';
export const VISIBLE_ALBUM = 'al.is_archived = 0 AND al.is_deleted = 0';

const TRACK_COLUMNS = `t.id, t.title, t.album_id, t.disc_number, t.track_number, t.duration_ms,
  t.published_at, t.metadata_status, t.acoustid_score, t.mb_recording_id, t.uploaded_by`;

export async function coverUrls(storage, prefix) {
  if (!prefix) return null;
  const [s96, s256, s512] = await Promise.all(
    [96, 256, 512].map((size) => storage.presignGet(`${prefix}${size}.jpg`)),
  );
  return { key: prefix, 96: s96, 256: s256, 512: s512 };
}

/**
 * Adds artists, album, cover URLs, available formats and the liked flag to
 * raw track rows, keeping their order. One query per relation, so a page of
 * 50 songs costs a handful of queries rather than hundreds.
 */
export async function hydrateTracks({ db, storage }, rows, userId) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const albumIds = [...new Set(rows.map((row) => row.album_id).filter(Boolean))];

  const [artistRows] = await db.query(
    `SELECT ta.track_id, ta.credit, a.id, a.name
       FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
      WHERE ta.track_id IN (?)
      ORDER BY ta.position`,
    [ids],
  );
  const [albumRows] = albumIds.length
    ? await db.query('SELECT id, title, release_date, cover_r2_key FROM albums WHERE id IN (?)', [albumIds])
    : [[]];
  const [fileRows] = await db.query(
    'SELECT track_id, kind, codec, bitrate_kbps FROM track_files WHERE track_id IN (?)',
    [ids],
  );
  const [likedRows] = userId
    ? await db.query('SELECT track_id FROM liked_tracks WHERE user_id = ? AND track_id IN (?)', [userId, ids])
    : [[]];

  const liked = new Set(likedRows.map((row) => row.track_id));
  const albums = new Map();
  await Promise.all(
    albumRows.map(async (album) => {
      albums.set(album.id, {
        id: album.id,
        title: album.title,
        year: album.release_date ? new Date(album.release_date).getUTCFullYear() : null,
        cover: await coverUrls(storage, album.cover_r2_key),
      });
    }),
  );

  return rows.map((row) => {
    const files = fileRows.filter((file) => file.track_id === row.id);
    return {
      id: row.id,
      title: row.title,
      duration_ms: row.duration_ms,
      disc_number: row.disc_number,
      track_number: row.track_number,
      published_at: row.published_at,
      artists: artistRows
        .filter((artist) => artist.track_id === row.id)
        .map(({ id, name, credit }) => ({ id, name, credit })),
      album: albums.get(row.album_id) ?? null,
      formats: files.map((file) => file.kind),
      has_lossless: files.some(
        (file) => file.kind === 'flac' || (file.kind === 'original' && file.codec === 'flac'),
      ),
      liked: liked.has(row.id),
    };
  });
}

/** Fetches rows for a WHERE clause with safe column selection. */
export async function selectTracks(db, whereSql, params, orderSql = 't.id DESC', limit = 50, offset = 0) {
  const [rows] = await db.query(
    `SELECT ${TRACK_COLUMNS} FROM tracks t WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows;
}

export const trackColumns = TRACK_COLUMNS;
