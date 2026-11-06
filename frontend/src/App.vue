<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MiniPlayer from './components/MiniPlayer.vue';
import Icon from './components/Icon.vue';
import Navigation from './components/Navigation.vue';
import NowPlaying from './components/NowPlaying.vue';
import Sheets from './components/Sheets.vue';
import { api } from './lib/api.js';
import * as offline from './lib/offline.js';
import { PULL_THRESHOLD } from './lib/pullRules.js';
import { usePullToRefresh } from './lib/usePullToRefresh.js';
import { useOfflineLibrary } from './stores/offlineLibrary.js';
import { usePlayer } from './stores/player.js';
import { useSession } from './stores/session.js';
import { useToast } from './stores/toast.js';
import BlockedView from './views/BlockedView.vue';
import SignInView from './views/SignInView.vue';
import WaitingView from './views/WaitingView.vue';

const session = useSession();
const player = usePlayer();
const toast = useToast();
const library = useOfflineLibrary();
const route = useRoute();
const router = useRouter();
const playlists = ref([]);
const scroller = ref(null);
const pageKey = ref(0);

const inAdmin = computed(() => route.path.startsWith('/admin'));

onMounted(async () => {
  await session.load();
  library.refresh();
});

watch(
  () => [session.state, session.status],
  async ([state, status]) => {
    if (state !== 'ready') return;
    if (status === 'blocked') player.stop();
    if (status === 'approved') {
      await session.syncOffline();
      library.refresh();
      await loadPlaylists();
    }
  },
);

async function loadPlaylists() {
  try {
    const data = await api.get('/playlists');
    playlists.value = data.items;
    offline.cachePlaylists(data.items);
  } catch {
    playlists.value = await offline.cachedPlaylists();
  }
}

// Reloads the current page's data, not the whole app, so music keeps playing.
const pull = usePullToRefresh(scroller, {
  path: () => route.path,
  onRefresh: async () => {
    await Promise.allSettled([session.refresh(), session.syncOffline(), loadPlaylists()]);
    await library.refresh();
    pageKey.value += 1;
  },
});

// <main> does the scrolling and stays mounted between pages, so it keeps its
// position unless reset. flush: 'post' waits for the new page to be in place.
watch(
  () => route.fullPath,
  () => scroller.value?.scrollTo(0, 0),
  { flush: 'post' },
);

// A member typing /admin gets the library; the API would refuse anyway.
router.beforeEach((to) => {
  if (to.meta.admin && session.state === 'ready' && !session.isAdmin) return '/library';
  return true;
});
</script>

<template>
  <div v-if="session.state === 'loading'" class="center-screen" style="justify-content: center">
    <img class="logo" src="/logo.svg" alt="Audify" />
  </div>
  <SignInView v-else-if="session.state === 'signedOut'" />
  <BlockedView v-else-if="session.status === 'blocked'" />
  <WaitingView v-else-if="session.status === 'pending'" />
  <div v-else :class="{ focus: route.path === '/admin/approve' }" style="height: 100%">
    <div class="shell">
      <Navigation :playlists="playlists" :admin="inAdmin" />
      <div
        v-if="pull.distance.value"
        class="pull"
        :class="{ spin: pull.refreshing.value }"
        role="status"
        :aria-label="pull.refreshing.value ? 'Refreshing' : 'Pull to refresh'"
        :style="{ transform: `translateY(${pull.distance.value}px)`, opacity: Math.min(pull.distance.value / PULL_THRESHOLD, 1) }"
      >
        <Icon name="renew" :size="22" :style="pull.refreshing.value ? null : { transform: `rotate(${pull.distance.value * 4}deg)` }" />
      </div>
      <main ref="scroller" class="main" :class="{ 'has-player': player.current }">
        <div v-if="!session.online" class="notice quiet" style="margin-bottom: 16px">
          You're offline. Saved songs still play.
        </div>
        <RouterView :key="`${route.fullPath}#${pageKey}`" />
      </main>
    </div>
    <MiniPlayer />
    <NowPlaying />
    <Sheets />
  </div>
  <div v-if="toast.current" class="toast" role="status">
    <span>{{ toast.current.message }}</span>
    <button v-if="toast.current.action" @click="toast.act()">{{ toast.current.action }}</button>
  </div>
</template>
