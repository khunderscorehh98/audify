<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import { api } from '../lib/api.js';
import { artistNames, clockTime, dayLabel } from '../lib/format.js';
import { usePlayer } from '../stores/player.js';

const router = useRouter();
const player = usePlayer();
const plays = ref([]);
const failed = ref(false);

const groups = computed(() => {
  const days = new Map();
  for (const play of plays.value) {
    const day = dayLabel(play.played_at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(play);
  }
  return [...days];
});

onMounted(async () => {
  try {
    plays.value = (await api.get('/plays/recent')).items;
  } catch {
    failed.value = true;
  }
});

const play = (item) => {
  const position = plays.value.findIndex((entry) => entry.play_id === item.play_id);
  player.playList(plays.value, position, { name: 'Recently played', kind: 'Library' });
};
</script>

<template>
  <header class="page-head" style="justify-content: flex-start">
    <button class="icon-btn back" style="margin: 0 0 0 -10px" aria-label="Back" @click="router.back()"><Icon name="back" /></button>
    <h1 class="title">Recently played</h1>
  </header>
  <p v-if="failed" class="muted">History needs a connection. Offline plays are kept and sync later.</p>
  <p v-else-if="!plays.length" class="muted">Nothing played yet.</p>
  <section v-for="[day, items] in groups" :key="day" class="section">
    <h2 class="overline">{{ day }}</h2>
    <div v-for="item in items" :key="item.play_id" class="track" role="button" tabindex="0" @click="play(item)" @keydown.enter="play(item)">
      <Cover :px="56" :size="96" :cover="item.album?.cover" :track-id="item.id" :seed="item.album?.id ?? item.id" />
      <div class="grow">
        <div class="name truncate">{{ item.title }}</div>
        <div class="sub">
          <span class="truncate">{{ artistNames(item) }}</span>
          <span v-if="item.was_offline" class="badge plain">Played offline</span>
        </div>
      </div>
      <span class="time">{{ clockTime(item.played_at) }}</span>
    </div>
  </section>
</template>
