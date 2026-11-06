<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
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
const active = ref([]); // uploads in progress on this page
let poll = null;

const rows = computed(() => [
  ...active.value,
  ...uploads.value.filter((item) => !active.value.some((running) => running.id === item.id)),
]);

const badge = (status) =>
  status === 'approved' ? 'ok' : status === 'failed' ? 'expired' : status === 'pending_approval' ? 'strong' : status === 'duplicate' ? 'soon' : '';

async function load() {
  uploads.value = (await api.get('/uploads/mine').catch(() => ({ items: uploads.value }))).items;
}

/** PUT goes straight to R2. XHR because fetch can't report upload progress. */
function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Upload failed')));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(file);
  });
}

async function send(file) {
  const entry = ref({ id: `new-${uuid()}`, original_filename: file.name, size_bytes: file.size, status: 'awaiting_upload', percent: 0 });
  active.value = [entry.value, ...active.value];
  const update = (changes) => {
    active.value = active.value.map((item) => (item.id === entry.value.id ? Object.assign(item, changes) : item));
  };
  try {
    const created = await api.post('/uploads', {
      filename: file.name,
      size_bytes: file.size,
      content_type: file.type || 'application/octet-stream',
    });
    await putFile(created.upload_url, file, created.content_type, (fraction) => update({ percent: Math.round(fraction * 100) }));
    await api.post(`/uploads/${created.id}/complete`);
    await load();
  } catch (error) {
    toast.error(error);
  } finally {
    active.value = active.value.filter((item) => item.id !== entry.value.id);
  }
}

async function choose(files) {
  over.value = false;
  for (const file of files) await send(file);
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
    <div v-for="item in rows" :key="item.id" style="border-bottom: 1px solid var(--border-subtle); padding: 8px 0">
      <div class="row">
        <span class="avatar muted" style="width: 56px; height: 56px; border-radius: 12px"><Icon name="music" /></span>
        <div class="grow">
          <div class="truncate" style="font-weight: 500">{{ item.original_filename }}</div>
          <div class="muted label">{{ bytes(item.size_bytes) }}</div>
        </div>
        <span class="badge" :class="badge(item.status)">
          {{ LABELS[item.status] ?? item.status }}<template v-if="item.percent !== undefined"> {{ item.percent }}%</template>
        </span>
      </div>
      <div v-if="item.percent !== undefined" class="bar" style="margin-top: 8px"><i :style="{ width: `${item.percent}%` }" /></div>
    </div>
  </section>
</template>
