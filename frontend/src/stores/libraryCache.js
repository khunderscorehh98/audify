import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * What the Library page last showed. Returning to the page draws this straight
 * away and refreshes it quietly, so the layout doesn't rebuild from empty.
 */
export const useLibraryCache = defineStore('libraryCache', () => {
  const tab = ref('songs');
  const tracks = ref([]);
  const total = ref(0);
  const artists = ref([]);
  const albums = ref([]);
  const liked = ref([]);
  const recent = ref([]);
  const playlists = ref([]);

  /** One user's library must never show for the next person to sign in. */
  function clear() {
    tab.value = 'songs';
    total.value = 0;
    for (const list of [tracks, artists, albums, liked, recent, playlists]) list.value = [];
  }

  return { tab, tracks, total, artists, albums, liked, recent, playlists, clear };
});
