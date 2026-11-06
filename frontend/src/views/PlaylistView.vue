<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import Icon from '../components/Icon.vue';
import OfflinePanel from '../components/OfflinePanel.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { longDuration, songs } from '../lib/format.js';
import * as offline from '../lib/offline.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const player = usePlayer();
const library = useOfflineLibrary();
const toast = useToast();

const playlist = ref(null);
const cached = ref(false);
const menu = ref(false);
const reordering = ref(false);
const renaming = ref(false);
const removing = ref(false);
const name = ref('');

const tracks = computed(() => playlist.value?.tracks ?? []);
/** With no signal, only saved songs can play. */
const playable = computed(() => (cached.value ? tracks.value.filter((track) => library.byId[track.id]) : tracks.value));

onMounted(async () => {
  try {
    playlist.value = await api.get(`/playlists/${props.id}`);
    await offline.cachePlaylistDetail(playlist.value);
  } catch (error) {
    if (!error.offline) {
      toast.error(error);
      return router.replace('/playlists');
    }
    playlist.value = await offline.cachedPlaylist(Number(props.id));
    cached.value = true;
    if (!playlist.value) router.replace('/offline');
  }
});

function play(track = null, shuffled = false) {
  if (shuffled !== player.shuffle) player.toggleShuffle();
  const list = playable.value;
  const start = track ? list.findIndex((item) => item.id === track.id) : 0;
  if (list.length) player.playList(list, Math.max(start, 0), { name: playlist.value.name, kind: 'Playlist' });
}

async function rename() {
  try {
    await api.patch(`/playlists/${props.id}`, { name: name.value });
    playlist.value.name = name.value.trim();
    renaming.value = false;
  } catch (error) {
    toast.error(error);
  }
}

async function destroy() {
  try {
    await api.delete(`/playlists/${props.id}`);
    router.replace('/playlists');
  } catch (error) {
    toast.error(error);
  }
}

async function removeTrack(track) {
  try {
    await api.delete(`/playlists/${props.id}/tracks/${track.id}`);
    playlist.value.tracks = tracks.value.filter((item) => item.id !== track.id);
    toast.show('Removed from playlist');
  } catch (error) {
    toast.error(error);
  }
}

async function move(index, change) {
  const list = [...tracks.value];
  const [item] = list.splice(index, 1);
  list.splice(index + change, 0, item);
  playlist.value.tracks = list;
  await api.patch(`/playlists/${props.id}/tracks`, { track_ids: list.map((track) => track.id) }).catch(toast.error);
}
</script>

<template>
  <div class="row spread">
    <button class="icon-btn back" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
    <button class="icon-btn" aria-label="Playlist options" @click="menu = true"><Icon name="more" /></button>
  </div>
  <template v-if="playlist">
    <header class="hero">
      <Cover :seed="playlist.id" :bars="[35, 75, 55, 100]" />
      <div class="grow stack" style="gap: 8px">
        <div class="overline hide-small">Playlist</div>
        <h1 class="display">{{ playlist.name }}</h1>
        <p class="muted">{{ songs(tracks.length) }} · {{ longDuration(playlist.duration_ms) }}</p>
        <div class="row">
          <button class="icon-btn fill" aria-label="Play" @click="play()"><Icon name="play" /></button>
          <button class="icon-btn ring" aria-label="Shuffle" @click="play(null, true)"><Icon name="shuffle" /></button>
        </div>
      </div>
    </header>
    <OfflinePanel v-if="!cached" :tracks="tracks" />
    <section class="section">
      <p v-if="!tracks.length" class="muted">Add songs from the three-dot menu on any song.</p>
      <div v-for="(track, index) in tracks" :key="track.id" class="row">
        <TrackRow
          class="grow"
          :track="track"
          show-expiry
          :saved="library.byId[track.id]"
          :disabled="cached && !library.byId[track.id]"
          @play="play(track)"
        />
        <template v-if="reordering">
          <button class="icon-btn" aria-label="Move up" :disabled="index === 0" @click="move(index, -1)"><Icon name="back" style="transform: rotate(90deg)" /></button>
          <button class="icon-btn danger" aria-label="Remove from playlist" @click="removeTrack(track)"><Icon name="close" /></button>
        </template>
      </div>
    </section>
  </template>

  <Teleport to="body">
    <div v-if="menu && !renaming" class="scrim" @click.self="menu = false">
      <div class="sheet">
        <button class="sheet-action" @click="name = playlist.name; renaming = true"><Icon name="edit" /> Rename</button>
        <button class="sheet-action" @click="reordering = !reordering; menu = false"><Icon name="queue" /> {{ reordering ? 'Done editing songs' : 'Edit songs' }}</button>
        <button class="sheet-action danger" @click="menu = false; removing = true"><Icon name="trash" /> Delete playlist</button>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div v-if="renaming" class="scrim" @click.self="renaming = false; menu = false">
      <form class="sheet" @submit.prevent="rename(); menu = false">
        <div class="heading">Rename playlist</div>
        <input v-model="name" class="input" maxlength="150" aria-label="Playlist name" />
        <button class="btn primary block" :disabled="!name.trim()">Save</button>
      </form>
    </div>
  </Teleport>
  <ConfirmDialog
    v-if="removing"
    :title="`Delete “${playlist.name}”?`"
    body="The playlist goes, but its songs stay in the library."
    confirm="Delete playlist"
    @confirm="destroy"
    @cancel="removing = false"
  />
</template>
