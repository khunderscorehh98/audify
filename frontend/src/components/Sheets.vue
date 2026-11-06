<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Icon from './Icon.vue';
import Cover from './Cover.vue';
import { api } from '../lib/api.js';
import { artistNames, duration } from '../lib/format.js';
import * as offline from '../lib/offline.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useSheet } from '../stores/sheet.js';
import { useToast } from '../stores/toast.js';

const sheet = useSheet();
const player = usePlayer();
const toast = useToast();
const library = useOfflineLibrary();
const router = useRouter();

const playlists = ref([]);
const newName = ref('');
const track = computed(() => sheet.track);
const saved = computed(() => (track.value ? library.byId[track.value.id] : null));

watch(
  () => sheet.mode,
  async (mode) => {
    newName.value = '';
    if (mode === 'playlist') {
      playlists.value = await api.get('/playlists').then((data) => data.items, () => []);
    }
  },
);

async function add(id, name) {
  try {
    const { added } = await api.post(`/playlists/${id}/tracks`, { track_id: track.value.id });
    toast.show(added ? `Added to ${name}` : `Already in ${name}`);
    sheet.close();
  } catch (error) {
    toast.error(error);
  }
}

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  try {
    const playlist = await api.post('/playlists', { name });
    await add(playlist.id, name);
  } catch (error) {
    toast.error(error);
  }
}

async function toggleLike() {
  const value = track.value;
  const liked = !value.liked;
  try {
    await (liked ? api.put(`/likes/${value.id}`) : api.delete(`/likes/${value.id}`));
    value.liked = liked;
    player.patchTrack(value.id, { liked });
    toast.show(liked ? 'Added to Liked songs' : 'Removed from Liked songs');
    sheet.close();
  } catch (error) {
    toast.error(error);
  }
}

async function toggleSaved() {
  const value = track.value;
  sheet.close();
  try {
    if (saved.value) {
      await offline.removeSaved([value.id]);
    } else {
      toast.show("Offline copies last 5 days, then they're removed automatically.");
      await offline.saveTrack(value);
    }
    await library.refresh();
  } catch (error) {
    toast.error(error);
  }
}

function playNext() {
  player.addToQueue(track.value);
  toast.show('Playing next');
  sheet.close();
}

function goToArtist() {
  const id = track.value.artists?.[0]?.id;
  sheet.close();
  player.expanded = false;
  if (id) router.push(`/artists/${id}`);
}

function goToAlbum() {
  const id = track.value.album?.id;
  sheet.close();
  player.expanded = false;
  if (id) router.push(`/albums/${id}`);
}
</script>

<template>
  <div v-if="sheet.mode" class="scrim" @click.self="sheet.close()">
    <div v-if="sheet.mode === 'track'" class="sheet" role="dialog" aria-label="Song options">
      <div class="row">
        <Cover :px="56" :size="96" :cover="track.album?.cover" :track-id="track.id" :seed="track.album?.id ?? track.id" />
        <div class="grow">
          <div class="heading truncate">{{ track.title }}</div>
          <div class="muted truncate">{{ artistNames(track) }}</div>
        </div>
      </div>
      <button class="sheet-action" @click="toggleLike">
        <Icon :name="track.liked ? 'heart-fill' : 'heart'" /> {{ track.liked ? 'Remove from Liked songs' : 'Like' }}
      </button>
      <button class="sheet-action" @click="sheet.openPlaylist(track)"><Icon name="plus" /> Add to playlist</button>
      <button class="sheet-action" @click="toggleSaved">
        <Icon name="offline" /> {{ saved ? 'Remove download' : 'Save offline' }}
      </button>
      <button v-if="player.current" class="sheet-action" @click="playNext"><Icon name="queue" /> Play next</button>
      <button v-if="track.artists?.length" class="sheet-action" @click="goToArtist"><Icon name="user" /> Go to artist</button>
      <button v-if="track.album" class="sheet-action" @click="goToAlbum"><Icon name="music" /> Go to album</button>
    </div>

    <div v-else-if="sheet.mode === 'playlist'" class="sheet" role="dialog" aria-label="Add to playlist">
      <div class="heading">Add to playlist</div>
      <form class="row" @submit.prevent="create">
        <input v-model="newName" class="input" placeholder="New playlist name" maxlength="150" aria-label="New playlist name" />
        <button class="btn primary" :disabled="!newName.trim()">Create</button>
      </form>
      <button v-for="item in playlists" :key="item.id" class="sheet-action" @click="add(item.id, item.name)">
        <Cover :px="40" :size="96" :seed="item.id" />
        <span class="grow truncate">{{ item.name }}</span>
      </button>
    </div>

    <div v-else class="sheet" role="dialog" aria-label="Up next">
      <div class="heading">Up next</div>
      <p v-if="!player.upNext.length" class="muted">Nothing else is queued.</p>
      <div v-for="item in player.upNext" :key="item.id" class="row">
        <Cover :px="48" :size="96" :cover="item.album?.cover" :track-id="item.id" :seed="item.album?.id ?? item.id" />
        <div class="grow">
          <div class="truncate">{{ item.title }}</div>
          <div class="muted label truncate">{{ artistNames(item) }}</div>
        </div>
        <span class="time">{{ duration(item.duration_ms) }}</span>
      </div>
    </div>
  </div>
</template>
