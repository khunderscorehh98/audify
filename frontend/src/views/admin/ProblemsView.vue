<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../lib/api.js';
import { bytes, timeAgo } from '../../lib/format.js';
import { useToast } from '../../stores/toast.js';

const toast = useToast();
const failed = ref([]);
const duplicates = ref([]);

async function load() {
  try {
    const [failedList, duplicateList] = await Promise.all([
      api.get('/admin/uploads?status=failed'),
      api.get('/admin/uploads?status=duplicate'),
    ]);
    failed.value = failedList.items;
    duplicates.value = duplicateList.items;
  } catch (error) {
    toast.error(error);
  }
}

async function run(path, message) {
  try {
    await api.post(path);
    toast.show(message);
    await load();
  } catch (error) {
    toast.error(error);
  }
}

onMounted(load);
</script>

<template>
  <header class="page-head"><h1 class="display">Failed and duplicate uploads</h1></header>

  <section>
    <h2 class="title" style="margin-bottom: 12px">Failed</h2>
    <p v-if="!failed.length" class="muted">No failed uploads.</p>
    <div v-for="item in failed" :key="item.id" class="card stack" style="margin-bottom: 12px">
      <div>
        <div class="truncate" style="font-weight: 600">{{ item.original_filename }}</div>
        <div class="muted label">{{ item.uploaded_by }} · {{ bytes(item.size_bytes) }} · {{ timeAgo(item.created_at) }}</div>
        <div class="danger label" style="margin-top: 4px">{{ item.error_message }}</div>
      </div>
      <div class="row">
        <button class="btn primary small" @click="run(`/admin/uploads/${item.id}/retry`, 'Sent for processing again')">Retry</button>
        <button class="btn outline small" @click="run(`/admin/uploads/${item.id}/dismiss`, 'Dismissed')">Dismiss</button>
      </div>
    </div>
  </section>

  <section class="section">
    <h2 class="title" style="margin-bottom: 12px">Duplicates</h2>
    <p v-if="!duplicates.length" class="muted">No duplicates waiting.</p>
    <div v-for="item in duplicates" :key="item.id" class="card stack" style="margin-bottom: 12px">
      <div>
        <div class="truncate" style="font-weight: 600">{{ item.original_filename }}</div>
        <div class="muted label">{{ item.uploaded_by }} · same file as “{{ item.duplicate_of?.title ?? 'a removed song' }}”</div>
      </div>
      <p v-if="item.duplicate_of?.can_restore" class="warn">That song is archived or deleted. Restore it?</p>
      <div class="row">
        <button v-if="item.duplicate_of?.can_restore" class="btn primary small" @click="run(`/admin/uploads/${item.id}/restore-existing`, 'Song restored')">Restore it</button>
        <button class="btn outline small" @click="run(`/admin/uploads/${item.id}/dismiss`, 'Dismissed')">Dismiss</button>
      </div>
    </div>
  </section>
</template>
