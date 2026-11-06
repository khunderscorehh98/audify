<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { palette, songs } from '../lib/format.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const player = usePlayer();
const library = useOfflineLibrary();
const toast = useToast();
const artist = ref(null);
const colours = computed(() => palette(props.id));

onMounted(async () => {
  try {
    artist.value = await api.get(`/artists/${props.id}`);
  } catch (error) {
    toast.error(error);
    router.replace('/library');
  }
});

function play(position = 0, shuffled = false) {
  if (shuffled !== player.shuffle) player.toggleShuffle();
  player.playList(artist.value.tracks, position, { name: artist.value.name, kind: 'Artist' });
}
</script>

<template>
  <button class="icon-btn back" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
  <template v-if="artist">
    <header class="hero center">
      <span class="avatar display" :style="{ width: '180px', height: '180px', background: colours.bg, color: colours.fg, fontSize: '72px' }">{{ artist.name.charAt(0).toUpperCase() }}</span>
      <h1 class="display">{{ artist.name }}</h1>
      <p class="muted">{{ songs(artist.song_count) }} · {{ artist.albums.length }} {{ artist.albums.length === 1 ? 'album' : 'albums' }}</p>
      <div class="row">
        <button class="btn primary pill" @click="play()"><Icon name="play" :size="20" /> Play</button>
        <button class="btn outline pill" @click="play(0, true)"><Icon name="shuffle" :size="20" /> Shuffle</button>
      </div>
    </header>
    <section class="section">
      <h2 class="title">Popular in your library</h2>
      <TrackRow v-for="(track, position) in artist.tracks.slice(0, 5)" :key="track.id" :track="track" :number="position + 1" :subtitle="track.album?.title ?? ''" hide-art :saved="library.byId[track.id]" @play="play(position)" />
    </section>
    <section v-if="artist.albums.length" class="section">
      <h2 class="title">Albums</h2>
      <div class="grid">
        <RouterLink v-for="album in artist.albums" :key="album.id" :to="`/albums/${album.id}`" class="tile-card">
          <Cover class="tile" :cover="album.cover" :seed="album.id" />
          <div>
            <div class="truncate" style="font-weight: 600">{{ album.title }}</div>
            <div class="muted label">{{ album.year }}<template v-if="album.year"> · </template>{{ songs(album.song_count) }}</div>
          </div>
        </RouterLink>
      </div>
    </section>
  </template>
</template>
