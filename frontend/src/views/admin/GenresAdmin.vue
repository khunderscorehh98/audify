<script setup>
import { onMounted, ref, watch } from 'vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ItemActions from '../../components/ItemActions.vue';
import ViewTabs from '../../components/ViewTabs.vue';
import { api } from '../../lib/api.js';
import { songs } from '../../lib/format.js';
import { useToast } from '../../stores/toast.js';

const toast = useToast();
const view = ref('active');
const items = ref([]);
const counts = ref({});
const name = ref('');
const editing = ref(null);
const draft = ref('');
const confirming = ref(null);

async function load() {
  const data = await api.get(`/admin/genres?view=${view.value}`);
  items.value = data.items;
  counts.value = data.counts;
}

async function run(action) {
  try {
    await action();
    await load();
  } catch (error) {
    toast.error(error);
  }
}

async function add() {
  const value = name.value.trim();
  if (!value) return;
  await run(() => api.post('/admin/genres', { name: value }));
  name.value = '';
}

async function save() {
  const id = editing.value.id;
  editing.value = null;
  await run(() => api.patch(`/admin/genres/${id}`, { name: draft.value }));
}

watch(view, load);
onMounted(load);
</script>

<template>
  <header class="page-head"><h1 class="display">Genres</h1></header>
  <form class="card" style="margin-bottom: 16px" @submit.prevent="add">
    <label class="field">
      <span>New genre</span>
      <div class="row">
        <input v-model="name" class="input" placeholder="e.g. Malay pop" maxlength="100" />
        <button class="btn primary" :disabled="!name.trim()">Add genre</button>
      </div>
    </label>
  </form>
  <ViewTabs v-model="view" :counts="counts" />
  <section class="section genres">
    <p v-if="!items.length" class="muted">Nothing here.</p>
    <div v-for="genre in items" :key="genre.id" class="card row spread" style="padding: 8px 8px 8px 16px">
      <div class="grow">
        <div class="truncate" style="font-weight: 600">{{ genre.name }}</div>
        <div class="muted label">{{ songs(genre.song_count) }}</div>
      </div>
      <ItemActions
        :view="view"
        @edit="editing = genre; draft = genre.name"
        @archive="run(() => api.post(`/admin/genres/${genre.id}/archive`))"
        @delete="run(() => api.delete(`/admin/genres/${genre.id}`))"
        @restore="run(() => api.post(`/admin/genres/${genre.id}/${view === 'archived' ? 'unarchive' : 'restore'}`))"
        @permanent="confirming = genre"
      />
    </div>
  </section>

  <Teleport to="body">
    <div v-if="editing" class="scrim" @click.self="editing = null">
      <form class="sheet" @submit.prevent="save">
        <div class="heading">Edit genre</div>
        <input v-model="draft" class="input" maxlength="100" aria-label="Genre name" />
        <button class="btn primary block" :disabled="!draft.trim()">Save</button>
      </form>
    </div>
  </Teleport>
  <ConfirmDialog
    v-if="confirming"
    :title="`Delete “${confirming.name}” permanently?`"
    body="Songs keep playing but lose this genre. This can't be undone."
    @cancel="confirming = null"
    @confirm="run(() => api.delete(`/admin/genres/${confirming.id}/permanent`)); confirming = null"
  />
</template>

<style scoped>
.genres { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 768px) { .genres { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1200px) { .genres { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
