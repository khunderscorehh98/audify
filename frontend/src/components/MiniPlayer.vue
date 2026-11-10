<script setup>
import { computed } from 'vue';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import VolumeControl from './VolumeControl.vue';
import { artistNames, duration } from '../lib/format.js';
import { expiryState } from '../lib/offlineRules.js';
import { usePlayer } from '../stores/player.js';

const player = usePlayer();
const percent = computed(() => (player.length ? (player.position / player.length) * 100 : 0));
const offlineLabel = computed(() =>
  player.isOffline ? `Offline · ${expiryState(player.isOffline.savedAt).days} days left` : null,
);
</script>

<template>
  <div v-if="player.current" class="mini" @click="player.expanded = true">
    <Cover :px="56" :size="96" :cover="player.current.album?.cover" :track-id="player.current.id" :seed="player.current.album?.id ?? player.current.id" />
    <div class="grow mini-info">
      <div class="truncate" style="font-weight: 600">{{ player.current.title }}</div>
      <div class="muted truncate">{{ artistNames(player.current) }}</div>
    </div>
    <div class="player-center" @click.stop>
      <div class="row">
        <button class="icon-btn" aria-label="Previous" @click="player.previous()"><Icon name="prev" /></button>
        <button class="icon-btn fill" :aria-label="player.playing ? 'Pause' : 'Play'" @click="player.toggle()">
          <Icon :name="player.playing ? 'pause' : 'play'" />
        </button>
        <button class="icon-btn" aria-label="Next" @click="player.next()"><Icon name="next" /></button>
      </div>
      <div class="times label muted">
        <span>{{ duration(player.position * 1000) }}</span>
        <input class="seek" type="range" min="0" :max="player.length || 0" step="1" :value="player.position" aria-label="Seek" @input="player.seek(Number($event.target.value))" />
        <span>{{ duration(player.length * 1000) }}</span>
      </div>
    </div>
    <div class="player-center" style="flex: 1; align-items: flex-end; gap: 4px" @click.stop>
      <span v-if="offlineLabel" class="badge ok">{{ offlineLabel }}</span>
      <VolumeControl v-model="player.volume" style="width: 100%; max-width: 200px" />
    </div>
    <button class="icon-btn fill mini-toggle big" :aria-label="player.playing ? 'Pause' : 'Play'" @click.stop="player.toggle()">
      <Icon :name="player.playing ? 'pause' : 'play'" />
    </button>
    <div class="progress"><i :style="{ width: `${percent}%` }" /></div>
  </div>
</template>
