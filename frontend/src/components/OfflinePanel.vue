<script setup>
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import { songs } from '../lib/format.js';
import { expiryState } from '../lib/offlineRules.js';
import * as offline from '../lib/offline.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';
import { useToast } from '../stores/toast.js';

const props = defineProps({
  tracks: { type: Array, required: true },
  label: { type: String, default: 'songs' },
});

const library = useOfflineLibrary();
const toast = useToast();
const progress = ref(null);

const saved = computed(() => props.tracks.filter((track) => library.byId[track.id]));
const expiring = computed(() =>
  saved.value.filter((track) => expiryState(library.byId[track.id].savedAt).tone === 'soon'),
);
const on = computed(() => props.tracks.length > 0 && saved.value.length > 0);

async function turnOn() {
  toast.show("Offline copies last 5 days, then they're removed automatically.");
  progress.value = { done: 0, total: props.tracks.length };
  const result = await offline.saveTracks(props.tracks, (done, total) => {
    progress.value = { done, total };
  });
  progress.value = null;
  await library.refresh();
  if (result.failed) toast.show(`${songs(result.failed)} couldn't be saved. Try again on Wi-Fi.`);
}

async function turnOff() {
  await offline.removeSaved(saved.value.map((track) => track.id));
  await library.refresh();
}

const toggle = () => (on.value ? turnOff() : turnOn());

async function renew(tracks) {
  await offline.renew(tracks.map((track) => track.id));
  await library.refresh();
  toast.show(`Renewed ${songs(tracks.length)} for 5 more days`);
}
</script>

<template>
  <div v-if="!offline.supported" class="notice quiet">{{ offline.UNSUPPORTED_MESSAGE }}</div>
  <div v-else class="card stack">
    <div class="row spread">
      <div class="grow">
        <div class="heading">Available offline</div>
        <div class="muted label">
          <template v-if="progress">Saving {{ progress.done }} of {{ progress.total }}…</template>
          <template v-else>{{ saved.length }} of {{ tracks.length }} {{ label }} on this device · each lasts 5 days</template>
        </div>
      </div>
      <button
        class="switch"
        role="switch"
        :aria-checked="on"
        aria-label="Available offline"
        :disabled="Boolean(progress)"
        @click="toggle"
      ><i /></button>
    </div>
    <template v-if="on">
      <div v-if="expiring.length" class="notice quiet">
        <Icon name="clock" />
        <span>{{ songs(expiring.length) }} {{ expiring.length === 1 ? 'expires' : 'expire' }} tomorrow</span>
      </div>
      <div class="row">
        <button v-if="expiring.length" class="btn primary grow" @click="renew(expiring)">Renew expiring</button>
        <button class="btn outline grow" @click="renew(saved)">Renew all</button>
      </div>
    </template>
  </div>
</template>
