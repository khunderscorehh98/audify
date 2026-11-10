// Backup for Autocomplete when MusicBrainz finds nothing. Deezer covers
// Malay and Indonesian music far better. No key needed. Its terms aren't
// written for apps like this, so it's only used for the admin's own lookups.
import { HttpError } from './http.js';

const API_URL = 'https://api.deezer.com';
const TIMEOUT_MS = 10000;
const MAX_MATCHES = 6;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

const unavailable = () => new HttpError(502, "Couldn't reach the music lookup services. Try again, or fill in the labels by hand.");

/** Covers may only come from Deezer's image servers. */
export const isDeezerImage = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dzcdn.net' || url.hostname.endsWith('.dzcdn.net'));
  } catch {
    return false;
  }
};

/** Quotes a value for Deezer's search syntax. */
const quoted = (value) => `"${String(value).replace(/"/g, '')}"`;

export function toDeezerMatch(item, album = {}) {
  return {
    source: 'deezer',
    recording_id: null,
    artist_id: null,
    release_id: null,
    title: item.title_short || item.title,
    artist: item.artist?.name ?? '',
    album: item.album?.title ?? '',
    year: /^\d{4}/.test(album.release_date ?? '') ? Number(album.release_date.slice(0, 4)) : null,
    genres: (album.genres?.data ?? []).map((genre) => genre.name).slice(0, 3),
    thumb: item.album?.cover_medium ?? null,
    cover: isDeezerImage(item.album?.cover_xl) ? { type: 'deezer', url: item.album.cover_xl } : null,
  };
}

export function createDeezer({ fetchImpl = fetch } = {}) {
  const getJson = async (path) => {
    let response;
    try {
      response = await fetchImpl(`${API_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw unavailable();
    }
    if (!response.ok) throw unavailable();
    const data = await response.json();
    // Deezer reports errors, including rate limits, with a normal 200.
    if (data?.error) throw unavailable();
    return data;
  };

  return {
    async search(title, artist) {
      const strict = await getJson(`/search?${new URLSearchParams({ q: `artist:${quoted(artist)} track:${quoted(title)}`, limit: '10' })}`);
      let items = strict.data ?? [];
      if (!items.length) {
        const loose = await getJson(`/search?${new URLSearchParams({ q: `${title} ${artist}`, limit: '10' })}`);
        items = loose.data ?? [];
      }

      const seen = new Set();
      const unique = items.filter((item) => {
        const key = `${item.title_short || item.title}|${item.artist?.name}|${item.album?.title}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_MATCHES);

      // The search leaves out year and genres; each album has them.
      return Promise.all(
        unique.map(async (item) => {
          const album = item.album?.id ? await getJson(`/album/${Number(item.album.id)}`).catch(() => ({})) : {};
          return toDeezerMatch(item, album);
        }),
      );
    },

    async cover(url) {
      if (!isDeezerImage(url)) throw new HttpError(400, 'Invalid cover');
      let response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw unavailable();
      }
      if (response.status === 404) return null;
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('image/')) throw unavailable();
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_COVER_BYTES) throw unavailable();
      return { type, body };
    },
  };
}
