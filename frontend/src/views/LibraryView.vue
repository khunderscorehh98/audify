<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import InstallHint from '../components/InstallHint.vue';
import TrackRow from '../components/TrackRow.vue';
import { api } from '../lib/api.js';
import { songs } from '../lib/format.js';
import { useLibraryCache } from '../stores/libraryCache.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useSession } from '../stores/session.js';

const PAGE = 50;
const session = useSession();
const player = usePlayer();
const library = useOfflineLibrary();
const router = useRouter();

const { tab, tracks, total, artists, albums, liked, recent, playlists } = storeToRefs(useLibraryCache());
const offlineMode = ref(false);
const loading = ref(!tracks.value.length);
const failed = ref(false);

const recentShelf = computed(() => {
  const seen = new Set();
  const shelf = [];
  for (const playlist of playlists.value.slice(0, 1)) {
    shelf.push({ key: `p${playlist.id}`, title: playlist.name, sub: `Playlist · ${songs(playlist.song_count)}`, to: `/playlists/${playlist.id}`, seed: playlist.id });
  }
  for (const play of recent.value) {
    if (!play.album || seen.has(play.album.id)) continue;
    seen.add(play.album.id);
    shelf.push({ key: `a${play.album.id}`, title: play.album.title, sub: play.artists[0]?.name, to: `/albums/${play.album.id}`, cover: play.album.cover, seed: play.album.id });
  }
  return shelf.slice(0, 6);
});

async function load() {
  loading.value = !tracks.value.length;
  failed.value = false;
  offlineMode.value = false;
  // The shelf is a bonus: if it fails, the song list still shows.
  const [list, plays, lists] = await Promise.allSettled([
    api.get(`/tracks?limit=${PAGE}`),
    api.get('/plays/recent?limit=30'),
    api.get('/playlists'),
  ]);
  if (plays.status === 'fulfilled') recent.value = plays.value.items;
  if (lists.status === 'fulfilled') playlists.value = lists.value.items;

  if (list.status === 'fulfilled') {
    tracks.value = list.value.items;
    total.value = list.value.total;
  } else if (list.reason.offline) {
    // In the car, or the server isn't answering: use what's saved here.
    offlineMode.value = true;
    failed.value = navigator.onLine;
    await library.refresh();
    tracks.value = library.items.map((item) => item.track);
    total.value = tracks.value.length;
  } else {
    failed.value = true;
  }
  loading.value = false;
}

async function loadMore() {
  const more = await api.get(`/tracks?limit=${PAGE}&offset=${tracks.value.length}`);
  tracks.value = [...tracks.value, ...more.items];
}

async function setTab(next) {
  tab.value = next;
  if (next === 'artists' && !artists.value.length) artists.value = (await api.get('/artists?limit=200')).items;
  if (next === 'albums' && !albums.value.length) albums.value = (await api.get('/albums?limit=200')).items;
  if (next === 'liked' && !liked.value.length) liked.value = (await api.get('/likes')).items;
}

const play = (list, position) => player.playList(list, position, { name: 'Library', kind: 'Library' });

onMounted(load);
</script>

<template>
  <InstallHint />
  <header class="page-head">
    <div class="row">
      <img class="hide-wide" src="/logo.svg" alt="" width="44" height="44" style="border-radius: 12px" />
      <h1 class="display">Library</h1>
    </div>
    <RouterLink to="/settings" class="avatar" style="width: 56px; height: 56px" aria-label="Settings">
      {{ session.user?.display_name?.charAt(0)?.toUpperCase() }}
    </RouterLink>
  </header>

  <button class="search" style="margin-bottom: 12px" @click="router.push('/search')">
    <Icon name="search" /> Songs, artists, albums
  </button>

  <div class="chips" role="tablist">
    <button v-for="item in ['songs', 'artists', 'albums', 'liked']" :key="item" class="chip" :class="{ on: tab === item }" role="tab" :aria-selected="tab === item" @click="setTab(item)">
      {{ item.charAt(0).toUpperCase() + item.slice(1) }}
    </button>
  </div>

  <template v-if="tab === 'songs'">
    <section v-if="recentShelf.length" class="section">
      <h2 class="title">Recently played</h2>
      <div class="shelf">
        <RouterLink v-for="item in recentShelf" :key="item.key" :to="item.to" class="tile-card">
          <Cover class="tile" :cover="item.cover" :seed="item.seed" />
          <div>
            <div class="truncate" style="font-weight: 600">{{ item.title }}</div>
            <div class="muted label truncate">{{ item.sub }}</div>
          </div>
        </RouterLink>
      </div>
    </section>
    <section class="section">
      <div class="row spread">
        <h2 class="title">{{ offlineMode ? 'Saved on this device' : 'All songs' }}</h2>
        <span class="muted">{{ songs(total) }}</span>
      </div>
      <div v-if="failed" class="notice" style="margin-top: 12px">
        <span class="grow">Couldn't reach the server.</span>
        <button class="btn small outline" @click="load">Try again</button>
      </div>
      <p v-if="loading" class="muted" style="margin-top: 12px">Loading…</p>
      <p v-else-if="!tracks.length && !failed" class="muted" style="margin-top: 12px">
        {{ offlineMode ? 'Nothing is saved on this device yet.' : 'No songs yet. Upload the first one.' }}
      </p>
      <TrackRow v-for="(track, position) in tracks" :key="track.id" :track="track" :saved="library.byId[track.id]" @play="play(tracks, position)" />
      <button v-if="tracks.length < total" class="btn outline block" style="margin-top: 12px" @click="loadMore">Show more</button>
    </section>
  </template>

  <section v-else-if="tab === 'artists'" class="section">
    <RouterLink v-for="artist in artists" :key="artist.id" :to="`/artists/${artist.id}`" class="track">
      <span class="avatar" style="width: 56px; height: 56px">{{ artist.name.charAt(0).toUpperCase() }}</span>
      <div class="grow">
        <div class="name truncate">{{ artist.name }}</div>
        <div class="sub">{{ songs(artist.song_count) }}</div>
      </div>
    </RouterLink>
  </section>

  <section v-else-if="tab === 'albums'" class="section grid">
    <RouterLink v-for="album in albums" :key="album.id" :to="`/albums/${album.id}`" class="tile-card">
      <Cover class="tile" :cover="album.cover" :seed="album.id" />
      <div>
        <div class="truncate" style="font-weight: 600">{{ album.title }}</div>
        <div class="muted label truncate">{{ album.artists?.[0]?.name }}</div>
      </div>
    </RouterLink>
  </section>

  <section v-else class="section">
    <p v-if="!liked.length" class="muted">Songs you like appear here.</p>
    <TrackRow v-for="(track, position) in liked" :key="track.id" :track="track" :saved="library.byId[track.id]" @play="player.playList(liked, position, { name: 'Liked songs', kind: 'Playlist' })" />
  </section>
</template>

<style scoped>
@media (min-width: 768px) {
  .hide-wide { display: none; }
  .page-head .avatar { display: none; }
}
</style>
