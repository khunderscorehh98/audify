<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../../components/Icon.vue';
import { api } from '../../lib/api.js';
import { useToast } from '../../stores/toast.js';

const router = useRouter();
const toast = useToast();
const summary = ref(null);

onMounted(async () => {
  summary.value = await api.get('/admin/summary').catch((error) => toast.error(error));
});
</script>

<template>
  <header class="page-head"><h1 class="display">Admin</h1></header>
  <template v-if="summary">
    <div class="grid admin-cards">
      <button class="card stack" style="gap: 4px; text-align: left; background: var(--accent-soft)" @click="router.push('/admin/approve')">
        <span class="display accent">{{ summary.uploads_pending }}</span>
        <span style="font-weight: 600">Uploads to review</span>
        <span class="accent" style="font-weight: 600">Review now →</span>
      </button>
      <button class="card stack" style="gap: 4px; text-align: left" @click="router.push('/admin/users')">
        <span class="display">{{ summary.users_pending }}</span>
        <span style="font-weight: 600">{{ summary.users_pending === 1 ? 'New sign-up' : 'New sign-ups' }}</span>
        <span class="muted" style="font-weight: 600">Approve or block →</span>
      </button>
    </div>
    <div v-if="summary.uploads_failed" class="section">
      <RouterLink to="/admin/problems" class="notice"><Icon name="warning" /> {{ summary.uploads_failed }} failed {{ summary.uploads_failed === 1 ? 'upload needs' : 'uploads need' }} attention</RouterLink>
    </div>
    <section class="section" style="max-width: 720px">
      <h2 class="overline" style="margin-bottom: 12px">Manage</h2>
      <div class="list-card">
        <RouterLink to="/admin/tracks" class="link-row">
          <Icon name="music" />
          <div class="grow"><div class="heading">Tracks</div><div class="muted">{{ summary.tracks.active }} active · {{ summary.tracks.archived }} archived · {{ summary.tracks.deleted }} deleted</div></div>
          <Icon name="forward" class="muted" />
        </RouterLink>
        <RouterLink to="/admin/artists" class="link-row">
          <Icon name="user" />
          <div class="grow"><div class="heading">Artists &amp; albums</div><div class="muted">{{ summary.artists }} artists · {{ summary.albums }} albums</div></div>
          <Icon name="forward" class="muted" />
        </RouterLink>
        <RouterLink to="/admin/genres" class="link-row">
          <Icon name="grid" />
          <div class="grow"><div class="heading">Genres</div><div class="muted">{{ summary.genres }} genres</div></div>
          <Icon name="forward" class="muted" />
        </RouterLink>
        <RouterLink to="/admin/users" class="link-row">
          <Icon name="users" />
          <div class="grow"><div class="heading">Users</div><div class="muted">{{ summary.users_approved }} approved · {{ summary.users_pending }} waiting</div></div>
          <Icon name="forward" class="muted" />
        </RouterLink>
        <RouterLink to="/admin/problems" class="link-row">
          <Icon name="warning" />
          <div class="grow"><div class="heading">Failed and duplicate uploads</div><div class="muted">{{ summary.uploads_failed }} failed</div></div>
          <Icon name="forward" class="muted" />
        </RouterLink>
      </div>
      <p class="muted" style="margin-top: 16px">Archived and deleted items are hidden from everyone until you restore them.</p>
    </section>
  </template>
</template>

<style scoped>
.admin-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 720px; }
</style>
