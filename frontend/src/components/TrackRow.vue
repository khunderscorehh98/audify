<script setup>
import { computed, ref } from 'vue';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import ExpiryBadge from './ExpiryBadge.vue';
import { artistNames, duration } from '../lib/format.js';
import { usePlayer } from '../stores/player.js';
import { useSheet } from '../stores/sheet.js';
import { useToast } from '../stores/toast.js';
import { api } from '../lib/api.js';
import * as dataSaver from '../lib/dataSaver.js';

const props = defineProps({
  track: { type: Object, required: true },
  number: { type: Number, default: null },
  subtitle: { type: String, default: null },
  extra: { type: String, default: null },
  showExpiry: { type: Boolean, default: false },
  hideArt: { type: Boolean, default: false },
  saved: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['play']);

const player = usePlayer();
const sheet = useSheet();
const active = computed(() => player.current?.id === props.track.id);
const sub = computed(() => props.subtitle ?? artistNames(props.track));
const toast = useToast();
/** Dimmed, not hidden: the song is still there, just not playable right now. */
const blockedHere = computed(() => dataSaver.blocked.value && !props.saved);

const liking = ref(false);

/** Updates at once, and puts it back if the server says no. */
async function toggleLike() {
  if (liking.value) return;
  const track = props.track;
  const liked = !track.liked;
  liking.value = true;
  track.liked = liked;
  player.patchTrack(track.id, { liked });
  try {
    await (liked ? api.put(`/likes/${track.id}`) : api.delete(`/likes/${track.id}`));
  } catch (error) {
    track.liked = !liked;
    player.patchTrack(track.id, { liked: !liked });
    toast.error(error);
  } finally {
    liking.value = false;
  }
}

function tryPlay() {
  if (props.disabled) return;
  if (blockedHere.value) {
    toast.show(dataSaver.BLOCKED_MESSAGE);
    return;
  }
  emit('play');
}
</script>

<template>
  <div
    class="track"
    :class="{ active, dim: disabled || blockedHere }"
    role="button"
    tabindex="0"
    @click="tryPlay"
    @keydown.enter="tryPlay"
  >
    <span v-if="number !== null" class="track-num">{{ number }}</span>
    <Cover
      v-if="!hideArt"
      :px="56"
      :size="96"
      :cover="track.album?.cover"
      :track-id="track.id"
      :seed="track.album?.id ?? track.id"
    />
    <div class="grow">
      <div class="name truncate">{{ track.title }}</div>
      <div class="sub">
        <span v-if="saved" class="accent" aria-label="Saved offline"><Icon name="offline" :size="16" /></span>
        <span class="truncate">{{ sub }}<template v-if="number === null && !hideArt && !showExpiry"> · {{ duration(track.duration_ms) }}</template></span>
      </div>
    </div>
    <div class="col-album truncate">{{ track.album?.title }}</div>
    <div v-if="extra" class="col-extra muted">{{ extra }}</div>
    <ExpiryBadge v-if="showExpiry" :track-id="track.id" :saved="saved" />
    <span v-if="number !== null || hideArt" class="time">{{ duration(track.duration_ms) }}</span>
    <button
      class="icon-btn"
      :class="{ accent: track.liked, muted: !track.liked }"
      :aria-label="track.liked ? `Remove ${track.title} from Liked songs` : `Like ${track.title}`"
      :aria-pressed="Boolean(track.liked)"
      @click.stop="toggleLike"
    >
      <Icon :name="track.liked ? 'heart-fill' : 'heart'" :size="20" />
    </button>
    <button class="icon-btn" aria-label="More options" @click.stop="sheet.openTrack(track)">
      <Icon name="dots" />
    </button>
  </div>
</template>
