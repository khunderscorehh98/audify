// Saved songs live on this device only. The server never knows what's here.
//   Cache Storage: the audio files, with Workbox timestamps for the 5-day rule
//   IndexedDB: metadata, artwork blobs, playlists, expired markers, queued plays
import { openDB } from 'idb';
import { CacheExpiration } from 'workbox-expiration';
import { api } from './api.js';
import { streamFormat, addUsage } from './streamFormat.js';
import { LIFETIME_SECONDS, artworkToDelete } from './offlineRules.js';

const AUDIO_CACHE = 'audify-audio';

/** False on plain http:// over a network, where browsers remove the Cache API. */
export const supported = typeof caches !== 'undefined';
export const UNSUPPORTED_MESSAGE = 'Saving offline needs HTTPS, so it only works on the live site or on localhost.';
const expiration = new CacheExpiration(AUDIO_CACHE, { maxAgeSeconds: LIFETIME_SECONDS });

const dbPromise = openDB('audify', 1, {
  upgrade(db) {
    db.createObjectStore('saved', { keyPath: 'id' });
    db.createObjectStore('artwork'); // key: `${coverKey}${size}`
    db.createObjectStore('expired', { keyPath: 'id' });
    db.createObjectStore('playlists', { keyPath: 'id' });
    db.createObjectStore('plays', { keyPath: 'client_play_id' });
  },
});

// Vue's reactive proxies can't go into IndexedDB, so everything stored is copied.
const plain = (value) => JSON.parse(JSON.stringify(value));

export const audioUrl = (id) => `/offline-audio/${id}`;
const absolute = (id) => new URL(audioUrl(id), location.origin).href;

// ---------- Reading ----------
export const listSaved = async () => (await dbPromise).getAll('saved');
export const getSaved = async (id) => (await dbPromise).get('saved', id);
export const listExpired = async () => (await dbPromise).getAll('expired');

export async function usableCopy(id) {
  const saved = await getSaved(id);
  if (!saved) return null;
  // Checked before every play, because the page may have been open for days.
  return (await expiration.isURLExpired(absolute(id))) ? null : saved;
}

export async function artworkBlob(coverKey, size) {
  return (await dbPromise).get('artwork', `${coverKey}${size}`);
}

// ---------- Saving ----------
async function saveArtwork(db, cover) {
  if (!cover?.key) return;
  for (const size of [96, 256, 512]) {
    const key = `${cover.key}${size}`;
    if (await db.getKey('artwork', key)) continue;
    try {
      const response = await fetch(cover[size], { mode: 'cors' });
      if (response.ok) await db.put('artwork', await response.blob(), key);
    } catch {
      // A song without artwork still plays.
    }
  }
}

/**
 * Downloads the whole file once, then stores it. The Cache API refuses partial
 * responses, and fetching in full avoids paying for the same song twice.
 */
export async function saveTrack(track) {
  if (!supported) throw new Error(UNSUPPORTED_MESSAGE);
  const db = await dbPromise;
  const format = streamFormat(); // Q7: offline is always the streaming format.
  const stream = await api.get(`/tracks/${track.id}/stream?format=${format}`);
  const response = await fetch(stream.url);
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob();

  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(
    absolute(track.id),
    new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': stream.mime_type?.split(';')[0] || 'audio/webm',
        'Content-Length': String(blob.size),
        'Accept-Ranges': 'bytes',
      },
    }),
  );
  await expiration.updateTimestamp(absolute(track.id));
  await saveArtwork(db, track.album?.cover);

  const { album, ...rest } = track;
  const stored = {
    id: track.id,
    // Presigned links expire, so they're not kept with the metadata.
    track: plain({ ...rest, album: album ? { id: album.id, title: album.title, year: album.year } : null }),
    coverKey: album?.cover?.key ?? null,
    format,
    size: blob.size,
    savedAt: Date.now(),
  };
  await db.put('saved', stored);
  await db.delete('expired', track.id);
  addUsage('offline', blob.size / 1024 ** 2);
  return stored;
}

/** Saves a list, reporting progress; one failed song doesn't stop the rest. */
export async function saveTracks(tracks, onProgress = () => {}) {
  const saved = new Set((await listSaved()).map((item) => item.id));
  const todo = tracks.filter((track) => !saved.has(track.id));
  let done = 0;
  let failed = 0;
  for (const track of todo) {
    try {
      await saveTrack(track);
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress(done, todo.length);
  }
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => {});
  return { saved: done - failed, failed };
}

// ---------- Renewing and removing ----------
/** Resets the timer with no download. Playing never calls this. */
export async function renew(ids) {
  const db = await dbPromise;
  for (const id of ids) {
    const saved = await db.get('saved', id);
    if (!saved) continue;
    await expiration.updateTimestamp(absolute(id));
    await db.put('saved', { ...saved, savedAt: Date.now() });
  }
}

async function drop(items, { keepMarker }) {
  if (!items.length || !supported) return;
  const db = await dbPromise;
  const cache = await caches.open(AUDIO_CACHE);
  const removedIds = new Set(items.map((item) => item.id));
  for (const item of items) {
    await cache.delete(absolute(item.id));
    await db.delete('saved', item.id);
    if (keepMarker) {
      await db.put('expired', {
        id: item.id,
        title: item.track.title,
        artist: item.track.artists?.map((artist) => artist.name).join(', ') ?? '',
        expiredAt: Date.now(),
      });
    }
  }
  const remaining = (await db.getAll('saved')).filter((item) => !removedIds.has(item.id));
  for (const key of artworkToDelete(items, remaining)) {
    for (const size of [96, 256, 512]) await db.delete('artwork', `${key}${size}`);
  }
}

export async function removeSaved(ids) {
  const items = (await listSaved()).filter((item) => ids.includes(item.id));
  await drop(items, { keepMarker: false });
}

export const clearExpiredMarker = async (id) => (await dbPromise).delete('expired', id);

/** Runs at every app open: expired songs go, leaving a small marker behind. */
export async function sweepExpired() {
  if (!supported) return 0;
  const expired = [];
  for (const item of await listSaved()) {
    if (await expiration.isURLExpired(absolute(item.id))) expired.push(item);
  }
  await drop(expired, { keepMarker: true });
  await expiration.expireEntries();
  return expired.length;
}

/** Patch 1 B6: the phone asks which saved songs it should no longer have. */
export async function serverCheck() {
  const items = await listSaved();
  if (!items.length) return { removed: [] };
  const { remove, user_status: status } = await api.post('/offline/check', { ids: items.map((item) => item.id) });
  await drop(items.filter((item) => remove.includes(item.id)), { keepMarker: false });
  return { removed: remove, status };
}

/** Blocked users lose everything on this device. */
export async function wipeAll() {
  const db = await dbPromise;
  await drop(await db.getAll('saved'), { keepMarker: false });
  await Promise.all(['artwork', 'expired', 'playlists', 'plays'].map((store) => db.clear(store)));
  if (supported) await Promise.all([caches.delete(AUDIO_CACHE), caches.delete('audify-artwork')]);
}

// ---------- Cached playlists ----------
export async function cachePlaylists(items) {
  const db = await dbPromise;
  for (const item of items) {
    const existing = await db.get('playlists', item.id);
    await db.put('playlists', plain({ ...existing, ...item }));
  }
  const keep = new Set(items.map((item) => item.id));
  for (const key of await db.getAllKeys('playlists')) {
    if (!keep.has(key)) await db.delete('playlists', key);
  }
}

export async function cachePlaylistDetail(playlist) {
  const db = await dbPromise;
  // Only IDs and titles: enough to show the list and spot saved songs.
  await db.put(
    'playlists',
    plain({
      ...playlist,
      tracks: playlist.tracks.map(({ album, ...track }) => ({
        ...track,
        album: album ? { id: album.id, title: album.title, year: album.year } : null,
      })),
    }),
  );
}

export const cachedPlaylists = async () => (await dbPromise).getAll('playlists');
export const cachedPlaylist = async (id) => (await dbPromise).get('playlists', id);

// ---------- Play history queue ----------
export async function queuePlay(play) {
  return (await dbPromise).put('plays', play);
}


export async function flushPlays() {
  const db = await dbPromise;
  const plays = await db.getAll('plays');
  if (!plays.length) return;
  const batch = plays.slice(0, 500).map(({ client_play_id, track_id, played_at, ms_played, was_offline }) => ({
    client_play_id,
    track_id,
    played_at,
    ms_played,
    was_offline,
  }));
  const result = await api.post('/plays', { plays: batch });
  // Accepted and dropped are finished. Failed ones are invalid forever, so
  // they're removed too rather than retried on every open.
  const finished = [...result.accepted, ...result.dropped, ...result.failed.map((item) => item.client_play_id)];
  for (const id of finished) if (id) await db.delete('plays', id);
}
