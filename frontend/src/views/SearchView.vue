<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { palette, songs } from '../lib/format.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';

const router = useRouter();
const player = usePlayer();
const library = useOfflineLibrary();
const input = ref(null);
const query = ref('');
const results = ref(null);
const failed = ref(false);
let timer = null;
let latest = 0;

const top = computed(() => results.value?.artists?.[0] ?? null);

watch(query, (value) => {
  clearTimeout(timer);
  if (!value.trim()) {
    results.value = null;
    return;
  }
  // Waits for a pause in typing; no prefetching of results (build §5).
  timer = setTimeout(async () => {
    const id = (latest += 1);
    try {
      const data = await api.get(`/search?q=${encodeURIComponent(value)}`);
      if (id === latest) {
        results.value = data;
        failed.value = false;
      }
    } catch {
      failed.value = true;
    }
  }, 250);
});

onMounted(() => input.value?.focus());
</script>

<template>
  <div class="row" style="margin-bottom: 16px; max-width: 640px">
    <div class="search grow">
      <Icon name="search" />
      <input ref="input" v-model="query" placeholder="Songs, artists, albums" aria-label="Search" />
      <button v-if="query" class="icon-btn" aria-label="Clear" style="margin-right: -10px" @click="query = ''"><Icon name="close" :size="20" /></button>
    </div>
    <button class="accent cancel" style="font-weight: 600; min-height: 44px" @click="router.back()">Cancel</button>
  </div>

  <p v-if="failed" class="muted">Search needs a connection.</p>
  <p v-else-if="results && !results.tracks.length && !results.artists.length && !results.albums.length" class="muted">Nothing found for “{{ query }}”.</p>

  <template v-if="results">
    <section v-if="top">
      <h2 class="heading" style="margin-bottom: 12px">Top result</h2>
      <RouterLink :to="`/artists/${top.id}`" class="card row" style="max-width: 480px">
        <span class="avatar title" :style="{ width: '88px', height: '88px', background: palette(top.id).bg, color: palette(top.id).fg }">{{ top.name.charAt(0).toUpperCase() }}</span>
        <div class="grow">
          <div class="title truncate">{{ top.name }}</div>
          <div class="muted">Artist · {{ songs(top.song_count) }}</div>
        </div>
      </RouterLink>
    </section>
    <section v-if="results.tracks.length" class="section">
      <h2 class="heading">Songs</h2>
      <TrackRow v-for="(track, position) in results.tracks" :key="track.id" :track="track" :saved="library.byId[track.id]" @play="player.playList(results.tracks, position, { name: 'Search', kind: 'Library' })" />
    </section>
    <section v-if="results.albums.length" class="section">
      <h2 class="heading">Albums</h2>
      <div class="grid">
        <RouterLink v-for="album in results.albums" :key="album.id" :to="`/albums/${album.id}`" class="tile-card">
          <Cover class="tile" :cover="album.cover" :seed="album.id" />
          <div class="truncate" style="font-weight: 600">{{ album.title }}</div>
        </RouterLink>
      </div>
    </section>
  </template>
</template>
