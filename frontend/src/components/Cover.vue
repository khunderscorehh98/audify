<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { palette } from '../lib/format.js';
import { artworkBlob, getSaved } from '../lib/offline.js';

const props = defineProps({
  cover: { type: Object, default: null },
  trackId: { type: Number, default: null }, // finds saved art when there's no URL
  seed: { type: [String, Number], default: '' },
  size: { type: Number, default: 256 }, // 96, 256 or 512
  px: { type: Number, default: 0 },
  bars: { type: Array, default: () => [45, 100, 65] },
});

const colours = computed(() => palette(props.seed));
const failed = ref(false);
const blobUrl = ref(null);
let triedSaved = false;

const release = () => {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
  blobUrl.value = null;
};

/** With no signal the presigned URL fails, so fall back to the saved blob. */
async function loadSaved() {
  if (triedSaved) return;
  triedSaved = true;
  const key = props.cover?.key ?? (props.trackId ? (await getSaved(props.trackId))?.coverKey : null);
  if (!key) return;
  const blob = await artworkBlob(key, props.size);
  if (blob) {
    release();
    blobUrl.value = URL.createObjectURL(blob);
  }
}

watch(
  () => [props.cover?.key, props.trackId],
  () => {
    failed.value = false;
    triedSaved = false;
    release();
    if (!props.cover?.[props.size]) loadSaved();
  },
  { immediate: true },
);

const src = computed(() => blobUrl.value ?? (failed.value ? null : props.cover?.[props.size]));

function onError() {
  // Saved copy already failed too: stop here, or this would loop forever.
  if (blobUrl.value) {
    release();
    failed.value = true;
    return;
  }
  failed.value = true;
  loadSaved();
}

onBeforeUnmount(release);
</script>

<template>
  <div
    class="cover"
    :style="{ background: colours.bg, color: colours.fg, ...(px ? { width: `${px}px`, height: `${px}px` } : {}) }"
  >
    <span v-if="!src" class="bars">
      <i v-for="(height, position) in bars" :key="position" :style="{ height: `${height}%` }" />
    </span>
    <img v-else :src="src" alt="" crossorigin="anonymous" loading="lazy" @error="onError" />
  </div>
</template>
