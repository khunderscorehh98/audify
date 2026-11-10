<script setup>
import { computed } from 'vue';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import RangeSlider from './RangeSlider.vue';
import VolumeControl from './VolumeControl.vue';
import { api } from '../lib/api.js';
import { artistNames, duration } from '../lib/format.js';
import { expiryState } from '../lib/offlineRules.js';
import { formatLabel } from '../lib/streamFormat.js';
import { usePlayer } from '../stores/player.js';
import { useSheet } from '../stores/sheet.js';
import { useToast } from '../stores/toast.js';

const player = usePlayer();
const sheet = useSheet();
const toast = useToast();
const track = computed(() => player.current);
const days = computed(() => (player.isOffline ? expiryState(player.isOffline.savedAt).days : null));

async function toggleLike() {
  const liked = !track.value.liked;
  try {
    await (liked ? api.put(`/likes/${track.value.id}`) : api.delete(`/likes/${track.value.id}`));
    player.patchTrack(track.value.id, { liked });
  } catch (error) {
    toast.error(error);
  }
}
</script>

<template>
  <div v-if="player.expanded && track" class="now" role="dialog" aria-label="Now playing">
    <div class="now-head">
      <button class="icon-btn soft" aria-label="Close player" @click="player.expanded = false"><Icon name="down" /></button>
      <div class="grow">
        <div v-if="player.sourceName" class="overline" style="font-weight: 400">Playing from {{ player.sourceKind }}</div>
        <div class="truncate" style="font-weight: 600">{{ player.sourceName }}</div>
      </div>
      <button class="icon-btn soft" aria-label="More options" @click="sheet.openTrack(track)"><Icon name="more" /></button>
    </div>
    <div class="now-body">
      <Cover
        class="now-art"
        :size="512"
        :cover="track.album?.cover"
        :track-id="track.id"
        :seed="track.album?.id ?? track.id"
        :bars="[40, 75, 55, 100, 30]"
      />
      <div class="now-side stack">
        <div class="row spread">
          <div class="grow">
            <h1 class="display truncate">{{ track.title }}</h1>
            <div class="muted heading truncate" style="font-weight: 400">{{ artistNames(track) }}<template v-if="track.album"> · {{ track.album.title }}</template></div>
          </div>
          <button class="icon-btn" :class="{ accent: track.liked }" :aria-label="track.liked ? 'Unlike' : 'Like'" @click="toggleLike">
            <Icon :name="track.liked ? 'heart-fill' : 'heart'" :size="32" />
          </button>
        </div>
        <div class="row wrap">
          <span v-if="player.isOffline" class="badge ok"><Icon name="offline" :size="16" />Offline · {{ days }} {{ days === 1 ? 'day' : 'days' }} left</span>
          <span v-if="player.activeFormat" class="badge">{{ formatLabel(player.activeFormat) }}</span>
        </div>
        <div>
          <RangeSlider :value="player.position" :max="player.length" label="Seek" @change="player.seek" />
          <div class="row spread muted label">
            <span>{{ duration(player.position * 1000) }}</span>
            <span>{{ duration((player.length || track.duration_ms / 1000) * 1000) }}</span>
          </div>
        </div>
        <div class="controls">
          <button class="icon-btn mode-btn" :class="{ 'toggle-on': player.shuffle }" aria-label="Shuffle" :aria-pressed="player.shuffle" @click="player.toggleShuffle()"><Icon name="shuffle" /></button>
          <button class="icon-btn" aria-label="Previous" @click="player.previous()"><Icon name="prev" :size="32" /></button>
          <button class="play" :aria-label="player.playing ? 'Pause' : 'Play'" @click="player.toggle()"><Icon :name="player.playing ? 'pause' : 'play'" :size="36" /></button>
          <button class="icon-btn" aria-label="Next" @click="player.next()"><Icon name="next" :size="32" /></button>
          <button class="icon-btn mode-btn" :class="{ 'toggle-on': player.repeat !== 'off' }" :aria-label="`Repeat: ${player.repeat === 'one' ? 'this song' : player.repeat}`" @click="player.cycleRepeat()"><Icon :name="player.repeat === 'one' ? 'repeat-one' : 'repeat'" /></button>
        </div>
        <VolumeControl v-model="player.volume" />
        <div class="row spread">
          <button class="btn outline" @click="sheet.openQueue()"><Icon name="queue" /> Up next</button>
          <button class="btn outline" @click="sheet.openPlaylist(track)"><Icon name="plus" /> Add to playlist</button>
        </div>
      </div>
    </div>
  </div>
</template>
