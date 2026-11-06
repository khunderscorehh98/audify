<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import OfflinePanel from '../components/OfflinePanel.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { longDuration, songs } from '../lib/format.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const player = usePlayer();
const library = useOfflineLibrary();
const toast = useToast();
const album = ref(null);

const total = computed(() => album.value.tracks.reduce((sum, track) => sum + track.duration_ms, 0));

onMounted(async () => {
  try {
    album.value = await api.get(`/albums/${props.id}`);
  } catch (error) {
    toast.error(error);
    router.replace('/library');
  }
});

function play(position = 0, shuffled = false) {
  if (shuffled !== player.shuffle) player.toggleShuffle();
  player.playList(album.value.tracks, position, { name: album.value.title, kind: 'Album' });
}
</script>

<template>
  <button class="icon-btn back" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
  <template v-if="album">
    <header class="hero">
      <Cover :cover="album.cover" :seed="album.id" :bars="[35, 75, 55, 100]" />
      <div class="grow stack" style="gap: 8px">
        <div class="overline">Album</div>
        <h1 class="display">{{ album.title }}</h1>
        <p class="muted">
          <RouterLink v-if="album.artists[0]" :to="`/artists/${album.artists[0].id}`" class="accent" style="font-weight: 600">{{ album.artists[0].name }}</RouterLink>
          <template v-if="album.year"> · {{ album.year }}</template> · {{ songs(album.tracks.length) }} · {{ longDuration(total) }}
        </p>
        <div class="row">
          <button class="icon-btn fill" aria-label="Play" @click="play()"><Icon name="play" /></button>
          <button class="icon-btn ring" aria-label="Shuffle" @click="play(0, true)"><Icon name="shuffle" /></button>
        </div>
      </div>
    </header>
    <OfflinePanel :tracks="album.tracks" />
    <section class="section">
      <TrackRow v-for="(track, position) in album.tracks" :key="track.id" :track="track" :number="track.track_number ?? position + 1" hide-art subtitle="" :saved="library.byId[track.id]" @play="play(position)" />
    </section>
  </template>
</template>
