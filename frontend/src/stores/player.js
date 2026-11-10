import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { api } from '../lib/api.js';
import { artistNames, uuid } from '../lib/format.js';
import * as offline from '../lib/offline.js';
import * as dataSaver from '../lib/dataSaver.js';
import { nextIndex, nextRepeatMode, previousIndex, removeFromQueue, reshuffle, shuffleWithFirst } from '../lib/queueRules.js';
import { loadVolume, saveVolume } from '../lib/volume.js';
import { useToast } from './toast.js';
import {
  BITRATES,
  addUsage,
  losslessEnabled,
  preferAac,
  streamFormat,
} from '../lib/streamFormat.js';

const FIRST_SEGMENT_BYTES = 256 * 1024;

/** A tiny silent WAV, built here so no file or network request is needed. */
function silentWav() {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}
const PREFETCH_SECONDS_LEFT = 20;
const ACCESS_CHECK_MS = 60000;

export const usePlayer = defineStore('player', () => {
  const toast = useToast();
  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; // Required for saved and streamed audio alike.
  audio.preload = 'metadata';

  const queue = ref([]);
  const index = ref(-1);
  const sourceName = ref('');
  const sourceKind = ref('Playlist');
  const playing = ref(false);
  const position = ref(0);
  const length = ref(0);
  const ORDER_KEY = 'audify.playOrder';
  const savedOrder = (() => {
    try {
      return JSON.parse(localStorage.getItem(ORDER_KEY)) ?? {};
    } catch {
      return {};
    }
  })();
  const shuffle = ref(savedOrder.shuffle === true);
  const repeat = ref(['off', 'all', 'one'].includes(savedOrder.repeat) ? savedOrder.repeat : 'off'); // off | all | one
  watch([shuffle, repeat], () => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({ shuffle: shuffle.value, repeat: repeat.value }));
    } catch {
      // Not remembered in private mode.
    }
  });
  // The list as it was given, so turning shuffle off restores its order.
  let original = [];
  const expanded = ref(false);
  const activeFormat = ref(null);
  const isOffline = shallowRef(null); // the saved copy, when playing from one
  const loading = ref(false);
  const volume = ref(loadVolume());
  audio.volume = volume.value;
  watch(volume, (value) => {
    audio.volume = value;
    saveVolume(value);
  });

  const current = computed(() => queue.value[index.value] ?? null);
  const upNext = computed(() => queue.value.slice(index.value + 1, index.value + 6));

  let listened = 0;
  let lastTick = null;
  let startedAt = null;
  let wasOffline = false;
  let nextStream = null; // { id, url, format }
  let prefetched = false;
  let triedFallback = false;
  let artworkUrl = null;
  let unlocked = false;
  let lastCheck = 0;

  // ---------- Play history ----------
  function closePlay() {
    let saved = Promise.resolve();
    if (startedAt && lastTrackId && listened >= 1) {
      saved = offline.queuePlay({
        client_play_id: uuid(),
        track_id: lastTrackId,
        played_at: startedAt,
        ms_played: Math.round(listened * 1000),
        was_offline: wasOffline,
      });
      // Waits for the play to be stored, or the sync could miss it.
      saved = saved.then(() => offline.flushPlays()).catch(() => {});
      if (!wasOffline) addUsage('streaming', (listened * BITRATES[activeFormat.value ?? 'opus']) / 8 / 1024);
    }
    listened = 0;
    lastTick = null;
    startedAt = null;
    return saved;
  }
  let lastTrackId = null;

  // ---------- Loading ----------
  async function streamFor(track) {
    if (nextStream?.id === track.id && nextStream.url) {
      const ready = nextStream;
      nextStream = null;
      return ready;
    }
    const wanted = losslessEnabled() && track.has_lossless ? 'flac' : streamFormat();
    try {
      const stream = await api.get(`/tracks/${track.id}/stream?format=${wanted}`);
      return { id: track.id, url: stream.url, format: wanted };
    } catch (error) {
      if (error.status === 404 && wanted === 'flac') {
        const format = streamFormat();
        const stream = await api.get(`/tracks/${track.id}/stream?format=${format}`);
        return { id: track.id, url: stream.url, format };
      }
      throw error;
    }
  }

  async function load(autoplay = true) {
    const track = current.value;
    if (!track) return;
    closePlay();
    loading.value = true;
    triedFallback = false;
    prefetched = false;
    lastTrackId = track.id;
    lastCheck = Date.now();

    const saved = await offline.usableCopy(track.id);
    if (current.value?.id !== track.id) return; // Stopped or skipped while waiting.

    // Save mobile data: move on to the next song saved on this device.
    if (!saved && dataSaver.blocked.value) {
      loading.value = false;
      const nextSaved = await findSavedFrom(index.value + 1);
      if (nextSaved === -1) {
        audio.pause();
        playing.value = false;
        toast.show(dataSaver.BLOCKED_MESSAGE);
        return;
      }
      index.value = nextSaved;
      return load(autoplay);
    }
    isOffline.value = saved;
    wasOffline = Boolean(saved);
    audio.preload = 'auto';

    try {
      if (saved) {
        activeFormat.value = saved.format;
        audio.src = offline.audioUrl(track.id);
      } else {
        const stream = await streamFor(track);
        if (current.value?.id !== track.id) return; // Skipped while waiting.
        activeFormat.value = stream.format;
        audio.src = stream.url;
      }
      updateMediaSession();
      if (autoplay) await audio.play();
    } catch (error) {
      if (error.name !== 'AbortError') {
        playing.value = false;
        if (error.offline) next(false);
        // Archived or deleted since the queue was built.
        else if (error.status === 404) removeTracks([track.id]);
      }
    } finally {
      loading.value = false;
    }
  }

  async function findSavedFrom(start) {
    for (let position = start; position < queue.value.length; position += 1) {
      if (await offline.usableCopy(queue.value[position].id)) return position;
    }
    return -1;
  }

  function playList(tracks, start = 0, { name = '', kind = 'Playlist' } = {}) {
    closePlay();
    // iOS only allows play() during a tap, and load() waits on storage and the
    // network first. Playing silence now unlocks this element for good.
    if (!unlocked) {
      unlocked = true;
      audio.src = silentWav();
      audio.play().catch(() => {});
    }
    original = [...tracks];
    queue.value = shuffle.value ? shuffleWithFirst(tracks, start) : [...tracks];
    index.value = shuffle.value ? 0 : start;
    sourceName.value = name;
    sourceKind.value = kind;
    nextStream = null;
    return load(true);
  }

  const toggle = () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  /** Next button and end of song. Repeat one only loops at the end, not on Next. */
  function next(auto = false) {
    const target = nextIndex(index.value, queue.value.length, repeat.value);
    if (target === -1) {
      if (auto) {
        closePlay();
        playing.value = false;
      }
      return;
    }
    // Repeat all with shuffle: each lap gets a new order.
    if (target === 0 && shuffle.value && queue.value.length > 1) {
      queue.value = reshuffle(queue.value, current.value?.id);
    }
    index.value = target;
    nextStream = null;
    load(true);
  }

  function replayCurrent() {
    closePlay();
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  /** More than 3 seconds in, Previous restarts the song, like most players. */
  function previous() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const target = previousIndex(index.value, queue.value.length, repeat.value);
    if (target === index.value) {
      audio.currentTime = 0;
      return;
    }
    index.value = target;
    nextStream = null;
    load(true);
  }

  const cycleRepeat = () => {
    repeat.value = nextRepeatMode(repeat.value);
  };

  const seek = (seconds) => {
    audio.currentTime = seconds;
    position.value = seconds;
  };

  /** The current song keeps playing either way. */
  function toggleShuffle() {
    shuffle.value = !shuffle.value;
    const playingNow = current.value;
    nextStream = null;
    if (!playingNow) return;
    if (shuffle.value) {
      queue.value = shuffleWithFirst(queue.value, index.value);
      index.value = 0;
    } else {
      // Back to the list's own order, carrying on from the current song.
      queue.value = [...original];
      index.value = Math.max(original.findIndex((track) => track.id === playingNow.id), 0);
    }
  }

  function addToQueue(track) {
    queue.value = [...queue.value.slice(0, index.value + 1), track, ...queue.value.slice(index.value + 1)];
    // Also in the list's own order, so it survives turning shuffle off.
    const at = original.findIndex((item) => item.id === current.value?.id);
    original = [...original.slice(0, at + 1), track, ...original.slice(at + 1)];
  }

  function patchTrack(id, changes) {
    queue.value = queue.value.map((track) => (track.id === id ? { ...track, ...changes } : track));
    original = original.map((track) => (track.id === id ? { ...track, ...changes } : track));
  }

  /** Takes songs off this device's queue, moving on if one was playing. */
  function removeTracks(ids) {
    const wasPlaying = playing.value;
    const gone = new Set(ids);
    original = original.filter((track) => !gone.has(track.id));
    const result = removeFromQueue(queue.value, index.value, ids);
    if (!result.currentRemoved) {
      queue.value = result.queue;
      index.value = result.index;
      return;
    }
    toast.show('That song is no longer available');
    if (result.index === -1) {
      stop();
      return;
    }
    audio.pause();
    queue.value = result.queue;
    index.value = result.index;
    nextStream = null;
    load(wasPlaying);
  }

  /**
   * A song already downloading keeps playing even after it's deleted, and its
   * link stays valid for hours. So each device asks now and then.
   */
  async function checkStillAllowed() {
    const id = current.value?.id;
    if (!id) return;
    lastCheck = Date.now();
    try {
      const { remove } = await api.post('/offline/check', { ids: [id] });
      if (remove.includes(id)) removeTracks([id]);
    } catch {
      // No signal: saved songs keep playing, and the next check tries again.
    }
  }

  /** Ends playback for good: sign-out, or access removed. */
  function stop() {
    const saved = closePlay();
    audio.pause();
    audio.removeAttribute('src');
    audio.load(); // Also ends the download, which pausing alone doesn't.
    queue.value = [];
    original = [];
    index.value = -1;
    playing.value = false;
    position.value = 0;
    length.value = 0;
    expanded.value = false;
    isOffline.value = null;
    nextStream = null;
    lastTrackId = null;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; // Clears the lock screen.
    return saved;
  }

  // ---------- Data saving and background changes ----------
  function prepareNext(left) {
    const nextTrack = queue.value[index.value + 1];
    if (!nextTrack) return;
    // Phones throttle background tabs, so the link is fetched mid-song.
    if (!nextStream && position.value > length.value / 2) {
      nextStream = { id: nextTrack.id, pending: true };
      offline
        .usableCopy(nextTrack.id)
        .then((saved) => (saved || dataSaver.blocked.value ? { id: nextTrack.id } : streamFor(nextTrack)))
        .then((stream) => {
          nextStream = stream;
        })
        .catch(() => {
          nextStream = null;
        });
    }
    // First segment only, and only near the end.
    if (!prefetched && left < PREFETCH_SECONDS_LEFT && nextStream?.url) {
      prefetched = true;
      // Reading the body frees the connection for other requests.
      fetch(nextStream.url, { headers: { Range: `bytes=0-${FIRST_SEGMENT_BYTES - 1}` } })
        .then((response) => response.arrayBuffer())
        .catch(() => {});
    }
  }

  // ---------- Lock screen ----------
  async function lockScreenArtwork(track) {
    const key = track.album?.cover?.key ?? (await offline.getSaved(track.id))?.coverKey;
    const images = [];
    if (artworkUrl) artworkUrl.forEach(URL.revokeObjectURL);
    artworkUrl = [];
    for (const size of [96, 256, 512]) {
      try {
        // Blob URLs can't expire mid-song, and they work with no signal.
        let blob = key ? await offline.artworkBlob(key, size) : null;
        if (!blob && track.album?.cover?.[size]) {
          const response = await fetch(track.album.cover[size], { mode: 'cors' });
          if (response.ok) blob = await response.blob();
        }
        if (blob) {
          const url = URL.createObjectURL(blob);
          artworkUrl.push(url);
          images.push({ src: url, sizes: `${size}x${size}`, type: 'image/jpeg' });
        }
      } catch {
        // No artwork is better than no playback.
      }
    }
    return images.length ? images : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
  }

  async function updateMediaSession() {
    const track = current.value;
    if (!track || !('mediaSession' in navigator)) return;
    const artwork = await lockScreenArtwork(track);
    if (current.value?.id !== track.id) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: artistNames(track),
      album: track.album?.title ?? '',
      artwork,
    });
  }

  const setHandler = (action, handler) => {
    try {
      navigator.mediaSession?.setActionHandler(action, handler);
    } catch {
      // Older browsers reject actions they don't know.
    }
  };
  setHandler('play', () => audio.play());
  setHandler('pause', () => audio.pause());
  setHandler('previoustrack', () => previous());
  setHandler('nexttrack', () => next());
  setHandler('seekto', (details) => details.seekTime != null && seek(details.seekTime));

  // ---------- Audio events ----------
  audio.addEventListener('play', () => {
    if (!current.value || audio.src.startsWith('data:')) return;
    playing.value = true;
    startedAt ??= new Date().toISOString();
  });
  audio.addEventListener('pause', () => {
    playing.value = false;
    lastTick = null;
  });
  audio.addEventListener('timeupdate', () => {
    position.value = audio.currentTime;
    if (Number.isFinite(audio.duration)) length.value = audio.duration;
    if (!audio.paused) {
      const now = performance.now();
      if (lastTick !== null) listened += Math.min((now - lastTick) / 1000, 2);
      lastTick = now;
    }
    if (length.value) prepareNext(length.value - position.value);
    if (Date.now() - lastCheck > ACCESS_CHECK_MS) checkStillAllowed();
    if ('mediaSession' in navigator && length.value) {
      try {
        navigator.mediaSession.setPositionState({
          duration: length.value,
          position: Math.min(position.value, length.value),
          playbackRate: audio.playbackRate,
        });
      } catch {
        // Harmless if unsupported.
      }
    }
  });
  audio.addEventListener('ended', () => (repeat.value === 'one' ? replayCurrent() : next(true)));
  audio.addEventListener('error', async () => {
    const track = current.value;
    if (!track || !audio.getAttribute('src') || audio.src.startsWith('data:')) return;
    // canPlayType said yes but it failed: remember AAC for this device.
    if (!triedFallback && !isOffline.value && activeFormat.value === 'opus') {
      triedFallback = true;
      preferAac();
      nextStream = null;
      const time = audio.currentTime;
      const stream = await api.get(`/tracks/${track.id}/stream?format=aac`).catch(() => null);
      if (stream) {
        activeFormat.value = 'aac';
        audio.src = stream.url;
        audio.currentTime = time;
        audio.play().catch(() => {});
      }
    }
  });

  window.addEventListener('pagehide', closePlay);

  // Switched to mobile data, or the setting turned on, mid-stream: stop it.
  watch(dataSaver.blocked, (isBlocked) => {
    if (isBlocked && current.value && !isOffline.value && playing.value) {
      audio.pause();
      toast.show(dataSaver.BLOCKED_MESSAGE);
    }
  });
  watch(current, (track) => {
    document.title = track ? `${track.title} · Audify` : 'Audify';
  });

  return {
    queue,
    index,
    current,
    upNext,
    sourceName,
    sourceKind,
    playing,
    position,
    length,
    shuffle,
    repeat,
    expanded,
    activeFormat,
    isOffline,
    loading,
    playList,
    toggle,
    next,
    previous,
    seek,
    toggleShuffle,
    addToQueue,
    patchTrack,
    removeTracks,
    stop,
    cycleRepeat,
    volume,
  };
});
