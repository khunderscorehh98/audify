<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import Icon from '../../components/Icon.vue';
import ViewTabs from '../../components/ViewTabs.vue';
import { api } from '../../lib/api.js';
import { timeAgo } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { useToast } from '../../stores/toast.js';

const session = useSession();
const toast = useToast();
const view = ref('active');
const items = ref([]);
const counts = ref({});
const options = ref(null);
const confirming = ref(null);

const waiting = computed(() => items.value.filter((user) => user.status === 'pending'));
const approved = computed(() => items.value.filter((user) => user.status === 'approved'));
const blocked = computed(() => items.value.filter((user) => user.status === 'blocked'));
const isSelf = (user) => user.id === session.user?.id;

async function load() {
  const data = await api.get(`/admin/users?view=${view.value}`);
  items.value = data.items;
  counts.value = data.counts;
}

async function run(action) {
  options.value = null;
  try {
    await action();
    await load();
    session.refresh().catch(() => {});
  } catch (error) {
    toast.error(error);
  }
}

const setStatus = (user, status) => run(() => api.patch(`/admin/users/${user.id}`, { status }));

watch(view, load);
onMounted(load);
</script>

<template>
  <header class="page-head"><h1 class="display">Users</h1></header>
  <ViewTabs v-model="view" :counts="counts" />

  <div class="section stack" style="max-width: 720px">
    <p v-if="!items.length" class="muted">Nothing here.</p>

    <div v-for="user in waiting" :key="user.id" class="card stack" style="border: 1.5px solid var(--border-subtle)">
      <div class="row">
        <span class="avatar" style="width: 56px; height: 56px">{{ user.display_name.charAt(0).toUpperCase() }}</span>
        <div class="grow">
          <div class="heading truncate">{{ user.display_name }}</div>
          <div class="muted label">{{ user.email }} · signed up {{ timeAgo(user.created_at) }}</div>
        </div>
        <span class="badge soon">Waiting</span>
      </div>
      <div class="row">
        <button class="btn danger-outline grow" @click="setStatus(user, 'blocked')">Block</button>
        <button class="btn primary grow" @click="setStatus(user, 'approved')">Approve</button>
      </div>
    </div>

    <template v-for="group in [{ title: 'Approved', list: approved }, { title: 'Blocked', list: blocked }]" :key="group.title">
      <h2 v-if="group.list.length" class="overline">{{ group.title }}</h2>
      <div v-for="user in group.list" :key="user.id" class="row" style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px">
        <span class="avatar" style="width: 56px; height: 56px">{{ user.display_name.charAt(0).toUpperCase() }}</span>
        <div class="grow">
          <div class="row">
            <span class="heading truncate">{{ user.display_name }}</span>
            <span v-if="user.role === 'admin'" class="badge ok">Admin</span>
          </div>
          <div class="muted label">{{ isSelf(user) ? 'You' : 'Member' }} · {{ user.upload_count }} uploads</div>
        </div>
        <button v-if="!isSelf(user)" class="icon-btn" :aria-label="`Options for ${user.display_name}`" @click="options = user"><Icon name="dots" /></button>
      </div>
    </template>
  </div>

  <Teleport to="body">
    <div v-if="options" class="scrim" @click.self="options = null">
      <div class="sheet">
        <div class="muted">Options for {{ options.display_name }}</div>
        <template v-if="view === 'active'">
          <button class="sheet-action" @click="run(() => api.post(`/admin/users/${options.id}/archive`))"><Icon name="archive" /> Archive user</button>
          <button v-if="options.status === 'blocked'" class="sheet-action" @click="setStatus(options, 'approved')"><Icon name="check" /> Unblock</button>
          <button v-else class="sheet-action" @click="setStatus(options, 'blocked')"><Icon name="block" /> Block</button>
          <button class="sheet-action danger" @click="run(() => api.delete(`/admin/users/${options.id}`))"><Icon name="trash" /> Move to Deleted</button>
        </template>
        <button v-else-if="view === 'archived'" class="sheet-action" @click="run(() => api.post(`/admin/users/${options.id}/unarchive`))"><Icon name="renew" /> Unarchive</button>
        <template v-else>
          <button class="sheet-action" @click="run(() => api.post(`/admin/users/${options.id}/restore`))"><Icon name="renew" /> Restore</button>
          <button class="sheet-action danger" @click="confirming = options; options = null"><Icon name="trash" /> Delete permanently</button>
        </template>
      </div>
    </div>
  </Teleport>

  <ConfirmDialog
    v-if="confirming"
    :title="`Delete ${confirming.display_name} permanently?`"
    body="Their playlists, likes, history and upload records are removed. Songs they uploaded stay. This can't be undone."
    @cancel="confirming = null"
    @confirm="run(() => api.delete(`/admin/users/${confirming.id}/permanent`)); confirming = null"
  />
</template>
