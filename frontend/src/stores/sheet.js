import { defineStore } from 'pinia';
import { ref } from 'vue';

/** One bottom sheet at a time, from anywhere: song options or add to playlist. */
export const useSheet = defineStore('sheet', () => {
  const track = ref(null);
  const mode = ref(null); // 'track' | 'playlist' | 'queue'

  const openTrack = (value) => {
    track.value = value;
    mode.value = 'track';
  };
  const openPlaylist = (value) => {
    track.value = value;
    mode.value = 'playlist';
  };
  const openQueue = () => {
    mode.value = 'queue';
  };
  const close = () => {
    mode.value = null;
    track.value = null;
  };

  return { track, mode, openTrack, openPlaylist, openQueue, close };
});
