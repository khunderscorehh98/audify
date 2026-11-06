import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const AUTO_MATCH_SCORE = 0.9;
const MB_BASE = 'https://musicbrainz.org/ws/2';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces out calls so one service never gets more than `perSecond`. */
export function rateLimiter(perSecond, sleep = pause) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const wait = next - Date.now();
    next = Math.max(next, Date.now()) + gap;
    if (wait > 0) await sleep(wait);
  };
}

export function createLookups({
  acoustIdKey,
  contact,
  fpcalc = process.env.FPCALC_PATH || 'fpcalc',
  fetchImpl = fetch,
  sleep = pause,
  retries = 4,
}) {
  const acoustIdTurn = rateLimiter(3, sleep); // AcoustID free tier: 3 per second
  const musicBrainzTurn = rateLimiter(1, sleep); // MusicBrainz: 1 per second
  const userAgent = `Audify/1.0 ( ${contact || 'unset'} )`;

  /** Retries on 503 and network errors with growing delays. */
  const getJson = async (url, turn, headers = {}) => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await turn();
      try {
        const response = await fetchImpl(url, { headers });
        if (response.status === 404) return null;
        if (response.ok) return await response.json();
        if (response.status !== 503 && response.status !== 429 && response.status < 500) {
          throw Object.assign(new Error(`status ${response.status}`), { fatal: true });
        }
        lastError = new Error(`status ${response.status}`);
      } catch (error) {
        if (error.fatal) throw error;
        lastError = error;
      }
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    throw lastError;
  };

  const fingerprint = async (file) => {
    const { stdout } = await run(fpcalc, ['-json', file], { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  };

  const acoustIdMatch = async ({ duration, fingerprint: print }) => {
    const query = new URLSearchParams({
      client: acoustIdKey,
      format: 'json',
      meta: 'recordingids',
      duration: String(Math.round(duration)),
      fingerprint: print,
    });
    const data = await getJson(`https://api.acoustid.org/v2/lookup?${query}`, acoustIdTurn);
    const best = (data?.results ?? [])
      .filter((result) => result.recordings?.length)
      .sort((a, b) => b.score - a.score)[0];
    return best ? { acoustidId: best.id, score: best.score, recordingId: best.recordings[0].id } : null;
  };

  const headers = { 'User-Agent': userAgent, Accept: 'application/json' };

  const recording = (id) =>
    getJson(`${MB_BASE}/recording/${id}?inc=artist-credits+releases+genres&fmt=json`, musicBrainzTurn, headers);

  const release = (id) =>
    getJson(`${MB_BASE}/release/${id}?inc=recordings+artist-credits&fmt=json`, musicBrainzTurn, headers);

  const coverArt = async (releaseId) => {
    await musicBrainzTurn();
    const response = await fetchImpl(`https://coverartarchive.org/release/${releaseId}/front-500`, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };

  /**
   * Returns what the services know, or null. Patch 3 §5: an outage must not
   * fail the upload, so any error here means "fall back to the file's tags".
   */
  return async function lookup(file) {
    if (!acoustIdKey) return { match: null, outage: false };
    try {
      const match = await acoustIdMatch(await fingerprint(file));
      if (!match) return { match: null, outage: false };

      const details = await recording(match.recordingId);
      if (!details) return { match: null, outage: false };

      const chosen = pickRelease(details.releases ?? []);
      const full = chosen ? await release(chosen.id) : null;
      let image = null;
      if (chosen) {
        // Missing artwork should never cost us the labels.
        image = await coverArt(chosen.id).catch(() => null);
      }
      return { match: { ...match, details, release: full, image }, outage: false };
    } catch {
      return { match: null, outage: true };
    }
  };
}

/** Prefers official studio albums over singles and compilations. */
export function pickRelease(releases) {
  const score = (item) =>
    (item.status === 'Official' ? 2 : 0) +
    (item['release-group']?.['primary-type'] === 'Album' ? 1 : 0) +
    (item['release-group']?.['secondary-types']?.includes('Compilation') ? -1 : 0);
  return [...releases].sort((a, b) => score(b) - score(a) || String(a.date).localeCompare(String(b.date)))[0];
}

const toDate = (value) => {
  if (!value) return null;
  const [year, month = '01', day = '01'] = String(value).split('-');
  return /^\d{4}$/.test(year) ? `${year}-${month}-${day}` : null;
};

const titleFromFilename = (filename) =>
  (filename || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';

function trackPosition(release, recordingId) {
  for (const medium of release?.media ?? []) {
    for (const track of medium.tracks ?? []) {
      if (track.recording?.id === recordingId) {
        return { trackNumber: track.position, discNumber: medium.position };
      }
    }
  }
  return {};
}

/** Merges MusicBrainz data with the file's tags into the /result body. */
export function buildLabels({ tags, filename, durationMs, found }) {
  const match = found?.match;
  if (match) {
    const { details, release } = match;
    const artists = (details['artist-credit'] ?? []).map((credit, index) => ({
      name: credit.artist?.name ?? credit.name,
      sort_name: credit.artist?.['sort-name'] ?? null,
      mb_artist_id: credit.artist?.id ?? null,
      credit: index === 0 ? 'primary' : 'featured',
    }));
    const position = trackPosition(release, match.recordingId);
    return {
      track: {
        title: details.title,
        duration_ms: durationMs,
        disc_number: position.discNumber ?? tags.discNumber,
        track_number: position.trackNumber ?? tags.trackNumber,
        acoustid_id: match.acoustidId,
        acoustid_score: Number(match.score.toFixed(3)),
        mb_recording_id: match.recordingId,
        metadata_status: match.score >= AUTO_MATCH_SCORE ? 'auto_matched' : 'needs_review',
      },
      artists: artists.length ? artists : [{ name: tags.artist || 'Unknown artist' }],
      album: release
        ? { title: release.title, release_date: toDate(release.date), mb_release_id: release.id }
        : tagAlbum(tags),
      genres: (details.genres ?? []).slice(0, 3).map((genre) => genre.name),
    };
  }
  return {
    track: {
      title: tags.title || titleFromFilename(filename),
      duration_ms: durationMs,
      disc_number: tags.discNumber,
      track_number: tags.trackNumber,
      metadata_status: 'needs_review',
    },
    artists: (tags.artists.length ? tags.artists : [tags.artist || 'Unknown artist']).map((name, index) => ({
      name,
      credit: index === 0 ? 'primary' : 'featured',
    })),
    album: tagAlbum(tags),
    genres: tags.genres.slice(0, 3),
  };
}

const tagAlbum = (tags) =>
  tags.album ? { title: tags.album, release_date: tags.year ? `${tags.year}-01-01` : null } : null;
