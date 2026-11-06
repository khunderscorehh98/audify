<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import SwipeToCancel from '../components/SwipeToCancel.vue';
import { api } from '../lib/api.js';
import { bytes, uuid } from '../lib/format.js';
import { useToast } from '../stores/toast.js';

const LABELS = {
  awaiting_upload: 'Uploading',
  uploaded: 'Waiting for processing',
  processing: 'Waiting for processing',
  pending_approval: 'Waiting for approval',
  approved: 'Live',
  duplicate: 'Already in the library',
  failed: 'Failed',
};

const toast = useToast();
const picker = ref(null);
const over = ref(false);
const uploads = ref([]);
const active = ref([]); // uploads in progress or queued on this page
const controls = new Map(); // entry id -> { cancelled, xhr, serverId }
let poll = null;

const rows = computed(() => {
  const running = new Set(active.value.map((item) => item.serverId));
  return [...active.value, ...uploads.value.filter((item) => !running.has(item.id))];
});

const canCancel = (item) => item.percent !== undefined || ['awaiting_upload', 'uploaded'].includes(item.status);

const badge = (status) =>
  status === 'approved' ? 'ok' : status === 'failed' ? 'expired' : status === 'pending_approval' ? 'strong' : status === 'duplicate' ? 'soon' : '';

async function load() {
  uploads.value = (await api.get('/uploads/mine').catch(() => ({ items: uploads.value }))).items;
}

/** PUT goes straight to R2. XHR because fetch can't report upload progress. */
function putFile(url, file, contentType, onProgress, control) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    control.xhr = xhr;
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Upload failed')));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new Error('Cancelled'));
    xhr.send(file);
  });
}

const removeEntry = (id) => {
  active.value = active.value.filter((item) => item.id !== id);
};

async function send(entry, file) {
  const control = controls.get(entry.id);
  if (control.cancelled) {
    controls.delete(entry.id);
    return;
  }
  const update = (changes) => {
    active.value = active.value.map((item) => (item.id === entry.id ? Object.assign(item, changes) : item));
  };
  update({ queued: false });
  try {
    const created = await api.post('/uploads', {
      filename: file.name,
      size_bytes: file.size,
      content_type: file.type || 'application/octet-stream',
    });
    control.serverId = created.id;
    update({ serverId: created.id });
    if (control.cancelled) throw new Error('Cancelled');
    await putFile(created.upload_url, file, created.content_type, (fraction) => update({ percent: Math.round(fraction * 100) }), control);
    if (control.cancelled) throw new Error('Cancelled');
    await api.post(`/uploads/${created.id}/complete`);
    await load();
  } catch (error) {
    // Cancelled or failed: leave nothing behind on the server.
    if (control.serverId) await api.delete(`/uploads/${control.serverId}`).catch(() => {});
    if (!control.cancelled) toast.error(error);
    await load();
  } finally {
    removeEntry(entry.id);
    controls.delete(entry.id);
  }
}

async function choose(files) {
  over.value = false;
  const entries = files.map((file) => ({
    id: `new-${uuid()}`,
    original_filename: file.name,
    size_bytes: file.size,
    status: 'awaiting_upload',
    percent: 0,
    queued: true,
    file,
  }));
  for (const { id } of entries) controls.set(id, { cancelled: false, xhr: null, serverId: null });
  active.value = [...entries, ...active.value];
  for (const entry of entries) await send(entry, entry.file);
}

async function cancel(item) {
  const control = controls.get(item.id);
  if (control) {
    // In progress or queued on this page. send() does the server cleanup.
    control.cancelled = true;
    control.xhr?.abort();
    removeEntry(item.id);
    toast.show('Upload cancelled');
    return;
  }
  try {
    await api.delete(`/uploads/${item.id}`);
    toast.show('Upload cancelled');
  } catch (error) {
    toast.error(error);
  }
  await load();
}

onMounted(() => {
  load();
  poll = setInterval(load, 15000);
});
onBeforeUnmount(() => clearInterval(poll));
</script>

<template>
  <header class="page-head"><h1 class="display">Upload music</h1></header>
  <div
    class="dropzone"
    :class="{ over }"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="choose([...$event.dataTransfer.files])"
  >
    <span class="avatar accent" style="width: 72px; height: 72px; background: var(--accent-soft)"><Icon name="upload" :size="32" /></span>
    <div class="heading">Choose music files</div>
    <p class="muted">MP3, FLAC, M4A, WAV, OGG and more. Songs go live after the admin approves them.</p>
    <input ref="picker" type="file" multiple hidden @change="choose([...$event.target.files]); $event.target.value = ''" />
    <button class="btn primary pill" @click="picker.click()">Browse files</button>
  </div>

  <section class="section">
    <h2 class="title">Your uploads</h2>
    <p v-if="!rows.length" class="muted">Nothing uploaded yet.</p>
    <p v-if="rows.some(canCancel)" class="swipe-hint muted caption">Swipe left on an upload to cancel it</p>
    <SwipeToCancel v-for="item in rows" :key="item.id" :enabled="canCancel(item)" @cancel="cancel(item)">
      <div style="border-bottom: 1px solid var(--border-subtle); padding: 8px 0">
      <div class="row">
        <span class="avatar muted" style="width: 56px; height: 56px; border-radius: 12px"><Icon name="music" /></span>
        <div class="grow">
          <div class="truncate" style="font-weight: 500">{{ item.original_filename }}</div>
          <div class="muted label">{{ bytes(item.size_bytes) }}</div>
        </div>
        <span class="badge" :class="badge(item.status)">
          <template v-if="item.queued">Queued</template>
          <template v-else>{{ LABELS[item.status] ?? item.status }}<template v-if="item.percent !== undefined"> {{ item.percent }}%</template></template>
        </span>
        <button v-if="canCancel(item)" class="icon-btn muted cancel-btn" :aria-label="`Cancel upload of ${item.original_filename}`" @click="cancel(item)"><Icon name="close" :size="20" /></button>
      </div>
      <div v-if="item.percent !== undefined && !item.queued" class="bar" style="margin-top: 8px"><i :style="{ width: `${item.percent}%` }" /></div>
      </div>
    </SwipeToCancel>
  </section>
</template>
