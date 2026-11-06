<script setup>
import { computed } from 'vue';
import { expiryState } from '../lib/offlineRules.js';
import { useOfflineLibrary } from '../stores/offlineLibrary.js';

const props = defineProps({
  trackId: { type: Number, required: true },
  saved: { type: Object, default: null },
});

const library = useOfflineLibrary();

const state = computed(() => {
  if (props.saved) return expiryState(props.saved.savedAt);
  if (library.expiredIds.has(props.trackId)) return { tone: 'expired', short: 'Expired' };
  return { tone: '', short: 'Not saved' };
});
</script>

<template>
  <span class="badge" :class="state.tone">{{ state.short }}</span>
</template>
