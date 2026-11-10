<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Cover from '../../components/Cover.vue';
import Icon from '../../components/Icon.vue';
import LabelsForm from '../../components/LabelsForm.vue';
import VolumeControl from '../../components/VolumeControl.vue';
import RangeSlider from '../../components/RangeSlider.vue';
import { api } from '../../lib/api.js';
import { applyMatchCover } from '../../lib/artwork.js';
import { artistNames, bytes, duration, timeAgo } from '../../lib/format.js';
import { streamFormat } from '../../lib/streamFormat.js';
import { loadVolume, saveVolume } from '../../lib/volume.js';
import { useToast } from '../../stores/toast.js';

const SWIPE_DISTANCE = 110;
const UNDO_MS = 8000;

const router = useRouter();
const toast = useToast();
const queue = ref([]);
const selected = ref(0);
const loading = ref(true);
const editing = ref(false);
const form = ref(null);

const card = computed(() => queue.value[selected.value] ?? null);
const nextCard = computed(() => queue.value[selected.value + 1] ?? null);

// ---------- Preview ----------
const preview = new Audio();
preview.crossOrigin = 'anonymous';
const previewing = ref(false);
const position = ref(0);
preview.addEventListener('timeupdate', () => (position.value = preview.currentTime));
preview.addEventListener('pause', () => (previewing.value = false));
preview.addEventListener('play', () => (previewing.value = true));
const previewLength = ref(0);
preview.addEventListener('loadedmetadata', () => (previewLength.value = Number.isFinite(preview.duration) ? preview.duration : 0));

const volume = ref(loadVolume());
preview.volume = volume.value;
watch(volume, (value) => {
  preview.volume = value;
  saveVolume(value);
});

/** Falls back to the song's stored length until the browser knows it. */
const timelineMax = computed(() => previewLength.value || (card.value?.track?.duration_ms ?? 0) / 1000);

async function seekPreview(seconds) {
  if (!preview.getAttribute('src')) {
    await prepare(card.value);
    startPreview(card.value);
  }
  preview.currentTime = seconds;
  position.value = seconds;
}

const previewUrls = new Map();

/** Fetched ahead, so a swipe can call play() while it's still a user gesture. */
async function prepare(item) {
  if (!item?.track || previewUrls.has(item.id)) return;
  const { url } = await api.get(`/admin/tracks/${item.track.id}/preview?format=${streamFormat()}`).catch(() => ({}));
  if (url) previewUrls.set(item.id, url);
}

function startPreview(item) {
  preview.pause();
  position.value = 0;
  previewLength.value = 0;
  const url = previewUrls.get(item?.id);
  prepare(queue.value[selected.value + 1]);
  if (!url) {
    preview.removeAttribute('src');
    return;
  }
  preview.src = url;
  // Autoplay may be refused; the play button still works.
  preview.play().catch(() => {});
}

async function togglePreview() {
  if (!preview.getAttribute('src')) {
    await prepare(card.value);
    return startPreview(card.value);
  }
  if (preview.paused) preview.play().catch(() => {});
  else preview.pause();
}

// ---------- Deciding ----------
function removeCard(item) {
  queue.value = queue.value.filter((entry) => entry.id !== item.id);
  if (selected.value >= queue.value.length) selected.value = Math.max(queue.value.length - 1, 0);
}

async function decide(action, labels, coverRelease = null) {
  const item = card.value;
  if (!item) return;
  const index = selected.value;
  removeCard(item);
  editing.value = false;
  // Inside the swipe or tap, so the browser counts it as a user gesture.
  startPreview(card.value);
  try {
    const saved = await api.post(`/admin/uploads/${item.id}/${action}`, labels);
    // Artwork failing shouldn't undo the approval: Replace artwork can fix it.
    await applyMatchCover(coverRelease, saved).catch(() => {});
    toast.show(`${action === 'approve' ? 'Approved' : 'Rejected'} “${item.track?.title}”`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: async () => {
        try {
          await api.post(`/admin/uploads/${item.id}/undo`);
          queue.value.splice(index, 0, item);
          selected.value = index;
        } catch (error) {
          toast.error(error);
        }
      },
    });
  } catch (error) {
    queue.value.splice(index, 0, item);
    toast.error(error);
  }
}

const approve = () => decide('approve', form.value ? form.value.changes() : {}, form.value?.coverRelease());

/** Phone Edit screen: saves the labels and returns to the card, unapproved. */
async function saveLabels() {
  const item = card.value;
  const changes = form.value.changes();
  const coverRelease = form.value.coverRelease();
  try {
    if (Object.keys(changes).length) {
      const saved = await api.patch(`/admin/tracks/${item.track.id}`, changes);
      await applyMatchCover(coverRelease, saved).catch(() => toast.show("Labels saved, but the artwork couldn't be added"));
    }
    const fresh = await api.get(`/admin/uploads/${item.id}`);
    queue.value = queue.value.map((entry) => (entry.id === item.id ? fresh : entry));
    editing.value = false;
  } catch (error) {
    toast.error(error);
  }
}
const reject = () => decide('reject', {});

// ---------- Swipe ----------
const drag = ref({ x: 0, active: false });
const stamp = computed(() => (drag.value.x > 40 ? 'approve' : drag.value.x < -40 ? 'reject' : null));
const cardStyle = computed(() => ({
  transform: `translateX(${drag.value.x}px) rotate(${drag.value.x / 18}deg)`,
  transition: drag.value.active ? 'none' : 'transform 0.2s',
}));
let startX = 0;

function pointerDown(event) {
  if (event.target.closest('button, input')) return;
  startX = event.clientX;
  drag.value = { x: 0, active: true };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function pointerMove(event) {
  if (drag.value.active) drag.value = { x: event.clientX - startX, active: true };
}

function pointerUp() {
  if (!drag.value.active) return;
  const { x } = drag.value;
  drag.value = { x: 0, active: false };
  if (x > SWIPE_DISTANCE) decide('approve', {});
  else if (x < -SWIPE_DISTANCE) decide('reject', {});
}

// ---------- Layout ----------
const wide = ref(window.matchMedia('(min-width: 1200px)').matches);
const media = window.matchMedia('(min-width: 1200px)');
const onMedia = (event) => (wide.value = event.matches);
media.addEventListener('change', onMedia);

function select(index) {
  selected.value = index;
  startPreview(card.value);
}

onMounted(async () => {
  try {
    queue.value = (await api.get('/admin/uploads')).items;
    await Promise.all(queue.value.slice(0, 2).map(prepare));
  } catch (error) {
    toast.error(error);
  }
  loading.value = false;
  await nextTick();
});

onBeforeUnmount(() => {
  preview.pause();
  // Pausing alone keeps the download's connection open.
  preview.removeAttribute('src');
  preview.load();
  media.removeEventListener('change', onMedia);
});
</script>

<template>
  <header class="page-head">
    <div class="row">
      <button class="icon-btn" style="margin-left: -10px" aria-label="Back" @click="router.push('/admin')"><Icon name="back" /></button>
      <h1 class="title">Approve uploads</h1>
    </div>
    <span class="badge plain">{{ queue.length }} waiting</span>
  </header>

  <p v-if="!loading && !queue.length" class="muted">Nothing to review. Nice.</p>

  <!-- Desktop: queue list and detail panel -->
  <div v-if="wide && card" class="approve-split">
    <div class="approve-list stack" style="gap: 8px">
      <button v-for="(item, index) in queue" :key="item.id" class="card row" :style="index === selected ? 'outline: 1.5px solid var(--border-control)' : ''" style="text-align: left" @click="select(index)">
        <Cover :px="56" :size="96" :cover="item.track?.album?.cover" :seed="item.track?.album?.id ?? item.id" />
        <div class="grow">
          <div class="truncate" style="font-weight: 600">{{ item.track?.title }}</div>
          <div class="muted label truncate">{{ artistNames(item.track) }} · from {{ item.uploaded_by }}</div>
        </div>
        <span v-if="item.track?.acoustid_score != null" class="label" :class="item.track.acoustid_score < 0.9 ? 'warn' : 'muted'">{{ Math.round(item.track.acoustid_score * 100) }}%</span>
      </button>
    </div>
    <div class="approve-detail card stack">
      <div v-if="card.possible_duplicate_of" class="notice"><Icon name="warning" /> Possible duplicate of “{{ card.possible_duplicate_of }}”</div>
      <div v-if="card.will_restore?.length" class="notice"><Icon name="warning" /> Approving brings back: {{ card.will_restore.join(', ') }}</div>
      <LabelsForm ref="form" :key="card.id" :track="card.track" :score="card.track.acoustid_score" />
      <div class="row">
        <button class="icon-btn ring" :aria-label="previewing ? 'Pause preview' : 'Play preview'" @click="togglePreview"><Icon :name="previewing ? 'pause' : 'play'" :size="20" /></button>
        <RangeSlider class="grow" :value="position" :max="timelineMax" label="Preview position" @change="seekPreview" />
        <span class="muted label">{{ duration(position * 1000) }} / {{ duration(timelineMax * 1000) }}</span>
      </div>
      <VolumeControl v-model="volume" style="max-width: 280px" />
      <div class="row">
        <span class="muted label grow truncate">Uploaded by {{ card.uploaded_by }} · {{ timeAgo(card.created_at) }} · {{ card.original_filename }} ({{ bytes(card.size_bytes) }})</span>
      </div>
      <div class="row spread">
        <button class="btn danger-outline" @click="reject">Reject</button>
        <button class="btn primary" @click="approve">Approve</button>
      </div>
    </div>
  </div>

  <!-- Phone and tablet: swipe cards -->
  <template v-else-if="card">
    <div class="deck">
      <div v-if="nextCard" class="swipe behind" aria-hidden="true" />
      <article class="swipe" :style="cardStyle" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
        <span v-if="stamp === 'approve'" class="swipe-stamp accent" style="left: 24px">APPROVE</span>
        <span v-if="stamp === 'reject'" class="swipe-stamp danger" style="right: 24px">REJECT</span>
        <Cover class="swipe-art" :cover="card.track?.album?.cover" :seed="card.track?.album?.id ?? card.id" :bars="[35, 75, 55, 100]" />
        <h2 class="title truncate">{{ card.track?.title }}</h2>
        <p class="muted truncate">{{ artistNames(card.track) }}<template v-if="card.track?.album"> · {{ card.track.album.title }}<template v-if="card.track.album.year"> · {{ card.track.album.year }}</template></template></p>
        <div class="row wrap">
          <span v-for="genre in card.track?.genres" :key="genre" class="badge">{{ genre }}</span>
          <span class="badge">{{ duration(card.track?.duration_ms) }}</span>
        </div>
        <div v-if="card.possible_duplicate_of" class="notice"><Icon name="warning" /> Possible duplicate of “{{ card.possible_duplicate_of }}”</div>
        <div v-if="card.track?.acoustid_score != null && card.track.acoustid_score < 0.9" class="notice">
          <Icon name="warning" /> Match {{ Math.round(card.track.acoustid_score * 100) }}% — check the labels before approving
        </div>
        <div v-else-if="card.track?.metadata_status === 'needs_review'" class="notice"><Icon name="warning" /> No match found — check the labels before approving</div>
        <div v-if="card.will_restore?.length" class="notice"><Icon name="warning" /> Approving brings back: {{ card.will_restore.join(', ') }}</div>
        <div class="row">
          <button class="icon-btn fill" style="background: var(--text)" :aria-label="previewing ? 'Pause preview' : 'Play preview'" @click="togglePreview"><Icon :name="previewing ? 'pause' : 'play'" :size="20" /></button>
          <RangeSlider class="grow" :value="position" :max="timelineMax" label="Preview position" @change="seekPreview" />
        </div>
        <div class="row spread muted label">
          <span>{{ duration(position * 1000) }}</span>
          <span>{{ duration(timelineMax * 1000) }}</span>
        </div>
        <VolumeControl v-model="volume" />
        <p class="muted label">Uploaded by {{ card.uploaded_by }} · {{ timeAgo(card.created_at) }}</p>
      </article>
    </div>
    <p class="muted label" style="text-align: center; margin-bottom: 12px">Swipe right to approve · left to reject</p>
    <div class="decide">
      <div><button class="icon-btn danger" style="border: 2px solid var(--danger)" aria-label="Reject" @click="reject"><Icon name="close" :size="28" /></button>Reject</div>
      <div><button class="icon-btn ring" aria-label="Edit labels" @click="editing = true"><Icon name="edit" /></button>Edit</div>
      <div><button class="icon-btn fill" aria-label="Approve" @click="decide('approve', {})"><Icon name="check" :size="28" /></button>Approve</div>
    </div>
  </template>

  <Teleport to="body">
    <div v-if="editing && card" class="now" role="dialog" aria-label="Edit labels">
      <div class="row spread" style="margin-bottom: 16px">
        <button class="btn" style="padding: 0" @click="editing = false">Cancel</button>
        <span class="heading">Edit labels</span>
        <button class="btn primary pill small" @click="saveLabels">Save</button>
      </div>
      <LabelsForm ref="form" :track="card.track" :score="card.track.acoustid_score" />
    </div>
  </Teleport>
</template>
