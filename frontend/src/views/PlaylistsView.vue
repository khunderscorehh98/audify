<script setup>
import { computed, onMounted, ref } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import { api } from '../lib/api.js';
import { songs } from '../lib/format.js';
import * as offline from '../lib/offline.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { useToast } from '../stores/toast.js';

const toast = useToast();
const library = useOfflineLibrary();
const playlists = ref([]);
const likedCount = ref(null);
const creating = ref(false);
const name = ref('');

const offlineLabel = computed(() => library.items.length);

async function load() {
  try {
    const [lists, likes] = await Promise.all([api.get('/playlists'), api.get('/likes')]);
    playlists.value = lists.items;
    likedCount.value = likes.items.length;
    await offline.cachePlaylists(lists.items);
  } catch (error) {
    if (!error.offline) throw error;
    playlists.value = await offline.cachedPlaylists();
  }
}

async function create() {
  const value = name.value.trim();
  if (!value) return;
  try {
    const playlist = await api.post('/playlists', { name: value });
    playlists.value = [...playlists.value, playlist];
    name.value = '';
    creating.value = false;
  } catch (error) {
    toast.error(error);
  }
}

onMounted(load);
</script>

<template>
  <header class="page-head">
    <h1 class="display">Playlists</h1>
    <button class="btn primary pill" @click="creating = true"><Icon name="plus" :size="20" /> New playlist</button>
  </header>

  <div class="stack" style="gap: 12px; max-width: 720px">
    <RouterLink to="/liked" class="card row">
      <span class="avatar accent" style="width: 64px; height: 64px; border-radius: 12px; background: var(--accent-soft)"><Icon name="heart-fill" :size="28" /></span>
      <div class="grow">
        <div class="heading">Liked songs</div>
        <div class="muted"><template v-if="likedCount !== null">{{ songs(likedCount) }}</template></div>
      </div>
    </RouterLink>
    <RouterLink to="/recent" class="card row">
      <span class="avatar" style="width: 64px; height: 64px; border-radius: 12px"><Icon name="clock" :size="28" /></span>
      <div class="grow">
        <div class="heading">Recently played</div>
        <div class="muted">Your listening history</div>
      </div>
    </RouterLink>
  </div>

  <section class="section" style="max-width: 720px">
    <h2 class="title">Your playlists</h2>
    <p v-if="!playlists.length" class="muted">No playlists yet.</p>
    <RouterLink v-for="playlist in playlists" :key="playlist.id" :to="`/playlists/${playlist.id}`" class="track">
      <Cover :px="64" :size="96" :seed="playlist.id" />
      <div class="grow">
        <div class="name truncate">{{ playlist.name }}</div>
        <div class="sub">{{ songs(playlist.song_count ?? playlist.tracks?.length ?? 0) }}</div>
      </div>
      <Icon name="forward" class="muted" />
    </RouterLink>
  </section>

  <Teleport to="body">
    <div v-if="creating" class="scrim" @click.self="creating = false">
      <form class="sheet" @submit.prevent="create">
        <div class="heading">New playlist</div>
        <input v-model="name" class="input" placeholder="Name" maxlength="150" aria-label="Playlist name" autofocus />
        <button class="btn primary block" :disabled="!name.trim()">Create</button>
        <button type="button" class="btn outline block" @click="creating = false">Cancel</button>
      </form>
    </div>
  </Teleport>
</template>
