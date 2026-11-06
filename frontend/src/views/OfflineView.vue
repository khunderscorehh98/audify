<script setup>
import { computed, onMounted } from 'vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import { api } from '../lib/api.js';
import { artistNames, bytes, shortDate, songs } from '../lib/format.js';
import { expiresAt, expiryState } from '../lib/offlineRules.js';
import * as offline from '../lib/offline.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { usePlayer } from '../stores/player.js';
import { useSession } from '../stores/session.js';
import { useToast } from '../stores/toast.js';

const library = useOfflineLibrary();
const player = usePlayer();
const session = useSession();
const toast = useToast();

const saved = computed(() =>
  [...library.items]
    .sort((a, b) => expiresAt(a.savedAt) - expiresAt(b.savedAt))
    .map((item) => ({ ...item, expiry: expiryState(item.savedAt) })),
);
const expiring = computed(() => saved.value.filter((item) => item.expiry.tone === 'soon'));

async function renew(items) {
  await offline.renew(items.map((item) => item.id));
  await library.refresh();
  toast.show(`Renewed ${songs(items.length)}`);
}

async function remove(item) {
  await offline.removeSaved([item.id]);
  await library.refresh();
}

function play(position) {
  player.playList(saved.value.map((item) => item.track), position, { name: 'Offline', kind: 'Library' });
}

async function redownload(marker) {
  if (!session.online) return toast.show('Connect to download this again. Wi-Fi is best.');
  try {
    await offline.saveTrack(await api.get(`/tracks/${marker.id}`));
    await library.refresh();
  } catch (error) {
    toast.error(error);
  }
}

async function dismiss(marker) {
  await offline.clearExpiredMarker(marker.id);
  await library.refresh();
}

onMounted(() => session.syncOffline().then(library.refresh));
</script>

<template>
  <header class="page-head"><h1 class="display">Offline</h1></header>
  <div v-if="!offline.supported" class="notice quiet" style="margin-bottom: 16px">{{ offline.UNSUPPORTED_MESSAGE }}</div>
  <div class="card stack" style="max-width: 720px">
    <div class="row spread">
      <span class="heading">{{ songs(library.items.length) }} on this device</span>
      <span class="muted">{{ bytes(library.totalBytes) }}</span>
    </div>
    <p class="muted">Each song is removed 5 days after it was saved. Renewing resets the timer without downloading again.</p>
    <div v-if="saved.length" class="row">
      <button class="btn primary grow" :disabled="!expiring.length" @click="renew(expiring)">Renew expiring ({{ expiring.length }})</button>
      <button class="btn outline grow" @click="renew(saved)">Renew all</button>
    </div>
  </div>

  <section class="section" style="max-width: 960px">
    <p v-if="!saved.length && !library.expired.length" class="muted">
      Turn on "Available offline" on any playlist or album to listen with no signal.
    </p>
    <div v-for="(item, position) in saved" :key="item.id" class="track" role="button" tabindex="0" @click="play(position)" @keydown.enter="play(position)">
      <Cover :px="56" :size="96" :track-id="item.id" :seed="item.track.album?.id ?? item.id" />
      <div class="grow">
        <div class="name truncate">{{ item.track.title }}</div>
        <div class="sub label" :class="{ warn: item.expiry.tone === 'soon' }" style="font-weight: 500">
          <span class="truncate">{{ item.expiry.long }}</span>
        </div>
      </div>
      <div class="col-extra muted truncate">{{ artistNames(item.track) }}</div>
      <div class="col-extra muted">Saved {{ shortDate(item.savedAt) }}</div>
      <button class="icon-btn" aria-label="Renew" @click.stop="renew([item])"><Icon name="renew" /></button>
      <button class="icon-btn muted" aria-label="Remove" @click.stop="remove(item)"><Icon name="trash" /></button>
    </div>
    <div v-for="marker in library.expired" :key="marker.id" class="track" role="button" tabindex="0" @click="redownload(marker)" @keydown.enter="redownload(marker)">
      <Cover :px="56" :size="96" :seed="marker.id" style="opacity: 0.5" />
      <div class="grow">
        <div class="name truncate">{{ marker.title }}</div>
        <div class="sub label danger" style="font-weight: 500"><span class="truncate">Expired — tap to download again</span></div>
      </div>
      <button class="icon-btn muted" aria-label="Remove" @click.stop="dismiss(marker)"><Icon name="trash" /></button>
    </div>
  </section>
</template>
