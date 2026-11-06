<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import OfflinePanel from '../components/OfflinePanel.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { longDuration, shortDate, songs } from '../lib/format.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';

const router = useRouter();
const player = usePlayer();
const library = useOfflineLibrary();
const tracks = ref([]);
const total = ref(0);
const failed = ref(false);

onMounted(async () => {
  try {
    const data = await api.get('/likes');
    tracks.value = data.items;
    total.value = data.duration_ms;
  } catch {
    failed.value = true;
  }
});

const play = (position = 0) => player.playList(tracks.value, position, { name: 'Liked songs', kind: 'Playlist' });
</script>

<template>
  <button class="icon-btn back" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
  <header class="hero">
    <span class="cover accent" style="align-items: center; justify-content: center; background: var(--accent-soft)"><Icon name="heart-fill" :size="64" /></span>
    <div class="grow stack" style="gap: 8px">
      <h1 class="display">Liked songs</h1>
      <p class="muted">{{ songs(tracks.length) }} · {{ longDuration(total) }}</p>
      <button class="icon-btn fill" aria-label="Play" @click="play()"><Icon name="play" /></button>
    </div>
  </header>
  <p v-if="failed" class="muted">Liked songs need a connection.</p>
  <OfflinePanel v-if="tracks.length" :tracks="tracks" />
  <section class="section">
    <TrackRow v-for="(track, position) in tracks" :key="track.id" :track="track" :extra="shortDate(track.liked_at)" :saved="library.byId[track.id]" @play="play(position)" />
  </section>
</template>
