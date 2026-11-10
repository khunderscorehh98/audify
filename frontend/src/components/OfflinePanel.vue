<script setup>
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import { songs } from '../lib/format.js';
import { expiryState } from '../lib/offlineRules.js';
import * as offline from '../lib/offline.js';
import * as dataSaver from '../lib/dataSaver.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({
  tracks: { type: Array, required: true },
  label: { type: String, default: 'songs' },
});

const library = useOfflineLibrary();
const toast = useToast();
const progress = ref(null);
let stopping = false;

const saved = computed(() => props.tracks.filter((track) => library.byId[track.id]));
const missing = computed(() => props.tracks.filter((track) => !library.byId[track.id]));
const allSaved = computed(() => props.tracks.length > 0 && missing.value.length === 0);
const expiring = computed(() =>
  saved.value.filter((track) => expiryState(library.byId[track.id].savedAt).tone === 'soon'),
);
const percent = computed(() => (progress.value?.total ? (progress.value.done / progress.value.total) * 100 : 0));

async function downloadAll() {
  if (dataSaver.blocked.value) {
    toast.show('Save mobile data is on. Download on Wi-Fi.');
    return;
  }
  toast.show("Downloads last 5 days, then they're removed automatically. Renewing uses no data.");
  stopping = false;
  progress.value = { done: 0, total: missing.value.length };
  const result = await offline.saveTracks(
    missing.value,
    (done, total) => {
      progress.value = { done, total };
    },
    () => stopping,
  );
  progress.value = null;
  await library.refresh();
  if (stopping) toast.show(`Stopped. ${songs(result.saved)} downloaded.`);
  else if (result.failed) toast.show(`${songs(result.failed)} couldn't be downloaded. Try again on Wi-Fi.`);
}

/** Finishes the song in progress, then stops. */
function stop() {
  stopping = true;
}

async function removeAll() {
  await offline.removeSaved(saved.value.map((track) => track.id));
  await library.refresh();
  toast.show('Downloads removed from this device');
}

async function renew(tracks) {
  await offline.renew(tracks.map((track) => track.id));
  await library.refresh();
  toast.show(`Renewed ${songs(tracks.length)} for 5 more days`);
}
</script>

<template>
  <div v-if="!offline.supported" class="notice quiet">{{ offline.UNSUPPORTED_MESSAGE }}</div>
  <div v-else-if="tracks.length" class="card stack">
    <div class="row spread wrap">
      <div class="grow">
        <div class="heading">{{ allSaved ? 'Downloaded' : 'Download for offline' }}</div>
        <div class="muted label">{{ saved.length }} of {{ tracks.length }} {{ label }} on this device · each lasts 5 days</div>
      </div>
      <template v-if="progress">
        <button class="btn outline small" @click="stop">Stop</button>
      </template>
      <button v-else-if="!allSaved" class="btn primary pill" @click="downloadAll">
        <Icon name="offline" :size="20" />
        {{ saved.length ? `Download remaining (${missing.length})` : 'Download all' }}
      </button>
      <span v-else class="badge ok"><Icon name="check" :size="16" /> All downloaded</span>
    </div>

    <div v-if="progress">
      <div class="muted label" style="margin-bottom: 6px">Downloading {{ progress.done }} of {{ progress.total }}…</div>
      <div class="bar"><i :style="{ width: `${percent}%` }" /></div>
    </div>

    <template v-if="saved.length && !progress">
      <div v-if="expiring.length" class="notice quiet">
        <Icon name="clock" />
        <span>{{ songs(expiring.length) }} {{ expiring.length === 1 ? 'expires' : 'expire' }} tomorrow</span>
      </div>
      <div class="row">
        <button v-if="expiring.length" class="btn primary grow" @click="renew(expiring)">Renew expiring</button>
        <button class="btn outline grow" @click="renew(saved)">Renew all</button>
      </div>
      <button class="danger label" style="min-height: 44px; align-self: flex-start" @click="removeAll">Remove downloads</button>
    </template>
  </div>
</template>
