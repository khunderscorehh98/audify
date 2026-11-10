// Looks songs up on MusicBrainz for the Autocomplete button in Edit labels.
// Rules: at most 1 request per second, and a User-Agent with contact details.
import { HttpError } from './http.js';

const API_URL = 'https://musicbrainz.org/ws/2';
const SEARCH_URL = `${API_URL}/recording`;
const COVER_URL = 'https://coverartarchive.org/release';
const TIMEOUT_MS = 10000;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MIN_SCORE = 60;
const MAX_MATCHES = 6;
const MAX_GENRES = 3;

const unavailable = () => new HttpError(502, "Couldn't reach MusicBrainz. Try again, or fill in the labels by hand.");

/** Quotes a value for MusicBrainz's search syntax. */
export const searchTerm = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

/**
 * Removes what files and uploads often add but MusicBrainz doesn't use:
 * "(Official Video)", "[HD]", "feat. Someone". Keeps the original if that
 * would leave nothing.
 */
export function cleanTerm(value) {
  const cleaned = String(value)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ' ')
    .replace(/\s+-\s+$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(value).trim();
}

/** Loose terms: any of the words, ranked by how many match. */
const looseTerms = (value) =>
  String(value)
    .normalize('NFKC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');

/** The most-voted names, tidied: "indie pop" becomes "Indie pop". */
export function topGenres(items = []) {
  return [...items]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, MAX_GENRES)
    .map((item) => item.name.charAt(0).toUpperCase() + item.name.slice(1));
}

/** Prefers official studio albums over singles and compilations. */
export function bestRelease(releases = []) {
  const score = (release) =>
    (release.status === 'Official' ? 2 : 0) +
    (release['release-group']?.['primary-type'] === 'Album' ? 1 : 0) +
    (release['release-group']?.['secondary-types']?.includes('Compilation') ? -1 : 0);
  return [...releases].sort((a, b) => score(b) - score(a) || String(a.date ?? '9').localeCompare(String(b.date ?? '9')))[0];
}

/** Turns a search response into the short list shown to the admin. */
export function toMatches(data) {
  const seen = new Set();
  const matches = [];
  for (const recording of data?.recordings ?? []) {
    if ((recording.score ?? 0) < MIN_SCORE) continue;
    const credit = recording['artist-credit']?.[0];
    const release = bestRelease(recording.releases);
    const match = {
      recording_id: recording.id,
      title: recording.title,
      artist: credit?.artist?.name ?? credit?.name ?? '',
      artist_id: credit?.artist?.id ?? null,
      album: release?.title ?? '',
      release_id: release?.id ?? null,
      year: /^\d{4}/.test(release?.date ?? '') ? Number(release.date.slice(0, 4)) : null,
      genres: topGenres(recording.tags),
      source: 'musicbrainz',
      thumb: release?.id ? `${COVER_URL}/${release.id}/front-250` : null,
      cover: release?.id ? { type: 'caa', id: release.id } : null,
    };
    const key = `${match.title}|${match.artist}|${match.album}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(match);
    if (matches.length === MAX_MATCHES) break;
  }
  return matches;
}

export function createMusicBrainz({ contact, fetchImpl = fetch }) {
  const headers = { 'User-Agent': `Audify/1.0 ( ${contact || 'unset'} )`, Accept: 'application/json' };
  let next = 0;

  const turn = async () => {
    const wait = next - Date.now();
    next = Math.max(next, Date.now()) + 1000;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };

  const get = async (url) => {
    await turn();
    try {
      return await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw unavailable();
    }
  };

  return {
    /** Exact first; if that finds nothing, a looser search on the cleaned words. */
    async search(title, artist) {
      const run = async (lucene) => {
        const response = await get(`${SEARCH_URL}?${new URLSearchParams({ query: lucene, fmt: 'json', limit: '15' })}`);
        if (!response.ok) throw unavailable();
        return toMatches(await response.json());
      };
      const cleanTitle = cleanTerm(title);
      const cleanArtist = cleanTerm(artist);
      const exact = await run(`recording:${searchTerm(cleanTitle)} AND artist:${searchTerm(cleanArtist)}`);
      if (exact.length) return exact;
      const titleWords = looseTerms(cleanTitle);
      const artistWords = looseTerms(cleanArtist);
      if (!titleWords || !artistWords) return [];
      return run(`recording:(${titleWords}) AND artist:(${artistWords})`);
    },

    /** Curated genres: the song's if it has any, then its album's, then its artist's. */
    async genres({ recordingId, releaseId, artistId }) {
      const sources = [
        recordingId && `recording/${recordingId}`,
        releaseId && `release/${releaseId}`,
        artistId && `artist/${artistId}`,
      ].filter(Boolean);
      for (const source of sources) {
        const response = await get(`${API_URL}/${source}?inc=genres&fmt=json`);
        if (!response.ok) continue;
        const genres = topGenres((await response.json()).genres);
        if (genres.length) return genres;
      }
      return [];
    },

    /** Returns { type, body }, or null when the release has no front cover. */
    async cover(releaseId) {
      const response = await get(`${COVER_URL}/${releaseId}/front-500`);
      if (response.status === 404) return null;
      if (!response.ok) throw unavailable();
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw unavailable();
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_COVER_BYTES) throw unavailable();
      return { type, body };
    },
  };
}
