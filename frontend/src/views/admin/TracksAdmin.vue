<script setup>
import { onMounted, ref, watch } from 'vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ItemActions from '../../components/ItemActions.vue';
import LabelsForm from '../../components/LabelsForm.vue';
import ViewTabs from '../../components/ViewTabs.vue';
import { api } from '../../lib/api.js';
import { applyMatchCover } from '../../lib/artwork.js';
import { artistNames, bytes, duration, timeAgo } from '../../lib/format.js';
import { usePlayer } from '../../stores/player.js';
import { useToast } from '../../stores/toast.js';

const toast = useToast();
const player = usePlayer();
const view = ref('active');
const query = ref('');
const items = ref([]);
const counts = ref({});
const detail = ref(null);
const editing = ref(null);
const confirming = ref(null);
const form = ref(null);
let timer = null;

async function load() {
  try {
    const data = await api.get(`/admin/tracks?view=${view.value}&q=${encodeURIComponent(query.value)}`);
    items.value = data.items;
    counts.value = data.counts;
  } catch (error) {
    toast.error(error);
  }
}

async function open(track) {
  detail.value = await api.get(`/admin/tracks/${track.id}`).catch(toast.error);
}

async function run(action) {
  try {
    await action();
    detail.value = null;
    await load();
    return true;
  } catch (error) {
    toast.error(error);
    return false;
  }
}

/** Archive or delete, then take the song off this device's player. */
async function hide(trackId, action) {
  if (await run(action)) player.removeTracks([trackId]);
}

async function startEdit(track) {
  editing.value = await api.get(`/admin/tracks/${track.id}`).catch(toast.error);
}

async function saveEdit() {
  const changes = form.value.changes();
  const coverRelease = form.value.coverRelease();
  if (Object.keys(changes).length) {
    await run(async () => {
      const saved = await api.patch(`/admin/tracks/${editing.value.id}`, changes);
      await applyMatchCover(coverRelease, saved);
    });
  }
  editing.value = null;
}

watch(view, () => {
  detail.value = null;
  load();
});
watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});
onMounted(load);
</script>

<template>
  <header class="page-head">
    <h1 class="display">Tracks</h1>
    <input v-model="query" class="input" style="max-width: 280px" placeholder="Search title, artist, ID" aria-label="Search tracks" />
  </header>
  <ViewTabs v-model="view" :counts="counts" />

  <section class="section">
    <p v-if="!items.length" class="muted">Nothing here.</p>
    <table v-else class="table">
      <thead>
        <tr>
          <th class="hide-phone">ID</th>
          <th>Title</th>
          <th class="hide-phone">Artist</th>
          <th class="hide-phone">Album</th>
          <th class="hide-phone">Uploaded by</th>
          <th><span class="hide-phone" style="display: inline">&nbsp;</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="track in items" :key="track.id" class="clickable" :class="{ selected: detail?.id === track.id }" @click="open(track)">
          <td class="hide-phone muted">#{{ track.id }}</td>
          <td>
            <div style="font-weight: 600">{{ track.title }}</div>
            <div class="muted label">
              <template v-if="view === 'deleted'">Deleted {{ timeAgo(track.deleted_at) }}<template v-if="track.deleted_by_name"> by {{ track.deleted_by_name }}</template></template>
              <template v-else>{{ artistNames(track) }}</template>
            </div>
          </td>
          <td class="hide-phone">{{ artistNames(track) }}</td>
          <td class="hide-phone muted">{{ track.album?.title }}</td>
          <td class="hide-phone muted">{{ track.uploader }}</td>
          <td>
            <ItemActions
              :view="view"
              @edit="startEdit(track)"
              @archive="hide(track.id, () => api.post(`/admin/tracks/${track.id}/archive`))"
              @delete="hide(track.id, () => api.delete(`/admin/tracks/${track.id}`))"
              @restore="run(() => api.post(`/admin/tracks/${track.id}/${view === 'archived' ? 'unarchive' : 'restore'}`))"
              @permanent="confirming = track"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <Teleport to="body">
    <div v-if="detail" class="scrim" @click.self="detail = null">
      <div class="sheet">
        <div class="muted label">Track #{{ detail.id }}</div>
        <div class="title">{{ detail.title }}</div>
        <div class="muted">{{ artistNames(detail) }}<template v-if="detail.album"> · {{ detail.album.title }}</template></div>
        <div class="row spread"><span class="muted">Duration</span><span>{{ duration(detail.duration_ms) }}</span></div>
        <div class="row spread"><span class="muted">Labels</span><span>{{ detail.metadata_status }}</span></div>
        <div class="row spread"><span class="muted">Uploaded by</span><span>{{ detail.uploader }}</span></div>
        <div class="overline">Stored files</div>
        <div v-for="file in detail.files" :key="file.kind" class="row spread card" style="padding: 8px 12px">
          <span style="font-weight: 600; text-transform: capitalize">{{ file.kind }}</span>
          <span class="muted label">
            <template v-if="file.kind === 'original' && file.codec === 'flac'">Lossless: original (FLAC) · </template>
            <template v-else-if="file.bitrate_kbps">{{ file.bitrate_kbps }} kbps · </template>
            {{ bytes(file.size_bytes) }}
          </span>
        </div>
        <button class="btn outline block" @click="detail = null">Close</button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="editing" class="now" role="dialog" aria-label="Edit labels">
      <div class="row spread" style="margin-bottom: 16px">
        <button class="btn" style="padding: 0" @click="editing = null">Cancel</button>
        <span class="heading">Edit labels</span>
        <button class="btn primary pill small" @click="saveEdit">Save</button>
      </div>
      <LabelsForm ref="form" :track="editing" />
    </div>
  </Teleport>

  <ConfirmDialog
    v-if="confirming"
    :title="`Delete “${confirming.title}” permanently?`"
    body="The song and all its files are removed from storage, and it disappears from every playlist, like and play history. This can't be undone."
    @cancel="confirming = null"
    @confirm="hide(confirming.id, () => api.delete(`/admin/tracks/${confirming.id}/permanent`)); confirming = null"
  />
</template>
