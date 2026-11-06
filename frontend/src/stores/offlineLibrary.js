import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as offline from '../lib/offline.js';

/** A reactive view of what's saved on this device. */
export const useOfflineLibrary = defineStore('offlineLibrary', () => {
  const items = ref([]);
  const expired = ref([]);

  const byId = computed(() => Object.fromEntries(items.value.map((item) => [item.id, item])));
  const expiredIds = computed(() => new Set(expired.value.map((item) => item.id)));
  const totalBytes = computed(() => items.value.reduce((sum, item) => sum + item.size, 0));

  async function refresh() {
    items.value = await offline.listSaved();
    expired.value = await offline.listExpired();
  }

  return { items, expired, byId, expiredIds, totalBytes, refresh };
});
