<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import Icon from '../../components/Icon.vue';
import ItemActions from '../../components/ItemActions.vue';
import ViewTabs from '../../components/ViewTabs.vue';
import { api } from '../../lib/api.js';
import { palette } from '../../lib/format.js';

const router = useRouter();
const kind = ref('artists');
const view = ref('active');
const items = ref([]);
const counts = ref({});
const totals = ref({});
const warning = ref(null);
const confirming = ref(null);
const editing = ref(null);
const draft = ref('');

const noun = computed(() => (kind.value === 'artists' ? 'artist' : 'album'));
const nameOf = (item) => item.name ?? item.title;

async function load() {
  const data = await api.get(`/admin/${kind.value}?view=${view.value}&limit=200`);
  items.value = data.items;
  counts.value = data.counts;
  totals.value[kind.value] = data.counts.active;
}

/** Shows the "Can't archive yet" banner from the server's 409. */
async function run(action) {
  warning.value = null;
  try {
    await action();
    await load();
  } catch (error) {
    warning.value = error.message;
  }
}

function startEdit(item) {
  editing.value = item;
  draft.value = nameOf(item);
}

async function saveEdit() {
  const body = kind.value === 'artists' ? { name: draft.value } : { title: draft.value };
  const id = editing.value.id;
  editing.value = null;
  await run(() => api.patch(`/admin/${kind.value}/${id}`, body));
}

async function create() {
  const name = window.prompt('Artist name');
  if (name?.trim()) await run(() => api.post('/admin/artists', { name }));
}

watch([kind, view], () => {
  warning.value = null;
  load();
});
onMounted(async () => {
  await load();
  totals.value.albums = (await api.get('/admin/albums?limit=1')).counts.active;
});
</script>

<template>
  <header class="page-head">
    <h1 class="display">Artists &amp; albums</h1>
    <button v-if="kind === 'artists'" class="btn primary" @click="create">+ New artist</button>
  </header>
  <div class="chips" style="margin-bottom: 8px">
    <button class="chip" :class="{ on: kind === 'artists' }" @click="kind = 'artists'">Artists · {{ totals.artists ?? '' }}</button>
    <button class="chip" :class="{ on: kind === 'albums' }" @click="kind = 'albums'">Albums · {{ totals.albums ?? '' }}</button>
  </div>
  <ViewTabs v-model="view" :counts="counts" />

  <div v-if="warning" class="notice section"><Icon name="warning" /> <span class="grow">{{ warning }}</span>
    <button v-if="warning.includes('active')" class="accent label" style="font-weight: 600" @click="router.push('/admin/tracks')">View songs</button>
  </div>

  <section class="section">
    <p v-if="!items.length" class="muted">Nothing here.</p>
    <table v-else class="table">
      <thead>
        <tr>
          <th>{{ noun }}</th>
          <th class="hide-phone">Active songs</th>
          <th v-if="kind === 'artists'" class="hide-phone">Albums</th>
          <th class="hide-phone">MusicBrainz</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>
            <div class="row">
              <span class="avatar" style="width: 44px; height: 44px" :style="{ background: palette(item.id).bg, color: palette(item.id).fg }">{{ nameOf(item).charAt(0).toUpperCase() }}</span>
              <span class="truncate" style="font-weight: 600">{{ nameOf(item) }}</span>
            </div>
          </td>
          <td class="hide-phone">{{ item.active_songs }}</td>
          <td v-if="kind === 'artists'" class="hide-phone muted">{{ item.album_count }}</td>
          <td class="hide-phone" :class="(item.mb_artist_id ?? item.mb_release_id) ? 'muted' : 'warn'">{{ (item.mb_artist_id ?? item.mb_release_id) ? 'Linked' : 'Not linked' }}</td>
          <td>
            <ItemActions
              :view="view"
              @edit="startEdit(item)"
              @archive="run(() => api.post(`/admin/${kind}/${item.id}/archive`))"
              @delete="run(() => api.delete(`/admin/${kind}/${item.id}`))"
              @restore="run(() => api.post(`/admin/${kind}/${item.id}/${view === 'archived' ? 'unarchive' : 'restore'}`))"
              @permanent="confirming = item"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <Teleport to="body">
    <div v-if="editing" class="scrim" @click.self="editing = null">
      <form class="sheet" @submit.prevent="saveEdit">
        <div class="heading">Edit {{ noun }}</div>
        <input v-model="draft" class="input" maxlength="255" aria-label="Name" />
        <button class="btn primary block" :disabled="!draft.trim()">Save</button>
      </form>
    </div>
  </Teleport>

  <ConfirmDialog
    v-if="confirming"
    :title="`Delete “${nameOf(confirming)}” permanently?`"
    body="This can't be undone."
    @cancel="confirming = null"
    @confirm="run(() => api.delete(`/admin/${kind}/${confirming.id}/permanent`)); confirming = null"
  />
</template>
