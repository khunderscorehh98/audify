import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, setForbiddenHandler } from '../lib/api.js';
import * as auth from '../lib/auth.js';
import * as offline from '../lib/offline.js';
import { useLibraryCache } from './libraryCache.js';
import { useOfflineLibrary } from './offlineLibrary.js';
import { usePlayer } from './player.js';

const CACHE_KEY = 'audify.me';

export const useSession = defineStore('session', () => {
  const state = ref('loading'); // loading | signedOut | ready
  const user = ref(null);
  const online = ref(navigator.onLine);

  const isAdmin = computed(() => user.value?.role === 'admin');
  const status = computed(() => user.value?.status ?? null);

  const remember = (me) => {
    user.value = me;
    const { pending: _pending, ...stored } = me;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...stored, cachedAt: Date.now() }));
  };

  const cached = () => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch {
      return null;
    }
  };

  async function applyBlock() {
    await offline.wipeAll();
    user.value = { ...(user.value ?? {}), status: 'blocked' };
    const stored = cached();
    if (stored) localStorage.setItem(CACHE_KEY, JSON.stringify({ ...stored, status: 'blocked' }));
  }

  setForbiddenHandler((userStatus) => {
    if (userStatus === 'blocked') applyBlock();
    else if (user.value) user.value = { ...user.value, status: userStatus };
  });

  /** Keeps saved songs honest. Runs on open and on every reconnect. */
  async function syncOffline() {
    await offline.sweepExpired();
    if (!navigator.onLine) return;
    try {
      const { removed, status: serverStatus } = await offline.serverCheck();
      if (removed.length) usePlayer().removeTracks(removed);
      if (serverStatus === 'blocked') await applyBlock();
      await offline.flushPlays();
    } catch {
      // Will try again on the next open or reconnect.
    }
  }

  async function load() {
    state.value = 'loading';
    const firebaseUser = await auth.currentUser();
    if (!firebaseUser) {
      user.value = null;
      state.value = 'signedOut';
      return;
    }
    try {
      remember(await api.get('/me'));
    } catch (error) {
      if (!error.offline) throw error;
      // No signal in the car: trust the last answer from the server.
      const last = cached();
      if (!last) {
        state.value = 'signedOut';
        return;
      }
      user.value = last;
    }
    state.value = 'ready';
    syncOffline();
  }

  async function refresh() {
    remember(await api.get('/me'));
  }

  async function signOut() {
    // Before signing out: syncing the last plays still needs this user's token.
    await usePlayer().stop();
    await offline.flushPlays().catch(() => {});
    // Saved songs, artwork and leftover plays must not pass to the next person.
    await offline.wipeAll();
    await useOfflineLibrary().refresh();
    await auth.signOut();
    localStorage.removeItem(CACHE_KEY);
    useLibraryCache().clear();
    user.value = null;
    state.value = 'signedOut';
  }

  window.addEventListener('online', () => {
    online.value = true;
    if (state.value === 'ready') syncOffline();
  });
  window.addEventListener('offline', () => {
    online.value = false;
  });

  return { state, user, online, isAdmin, status, load, refresh, signOut, syncOffline };
});
