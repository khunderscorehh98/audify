<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';
import { useSession } from '../stores/session.js';

defineProps({
  playlists: { type: Array, default: () => [] },
  admin: { type: Boolean, default: false },
});

const session = useSession();
const badge = computed(() => session.user?.pending?.uploads ?? 0);
const userBadge = computed(() => session.user?.pending?.users ?? 0);
const initial = computed(() => (session.user?.display_name ?? '?').charAt(0).toUpperCase());
</script>

<template>
  <!-- Tablet rail and desktop sidebar. The Admin link only renders for admins;
       the server's 403 is the real protection. -->
  <nav class="sidebar" aria-label="Main">
    <RouterLink to="/" class="row brand">
      <img src="/logo.svg" alt="Audify" width="44" height="44" style="border-radius: 12px" />
      <span class="title brand-name">{{ admin ? 'Audify Admin' : 'Audify' }}</span>
    </RouterLink>
    <template v-if="admin">
      <RouterLink to="/admin/approve" class="nav"><Icon name="check" /><span>Approve uploads</span><span v-if="badge" class="count">{{ badge }}</span></RouterLink>
      <RouterLink to="/admin/tracks" class="nav"><Icon name="music" /><span>Tracks</span></RouterLink>
      <RouterLink to="/admin/artists" class="nav"><Icon name="user" /><span>Artists &amp; albums</span></RouterLink>
      <RouterLink to="/admin/genres" class="nav"><Icon name="grid" /><span>Genres</span></RouterLink>
      <RouterLink to="/admin/users" class="nav"><Icon name="users" /><span>Users</span><span v-if="userBadge" class="count">{{ userBadge }}</span></RouterLink>
      <RouterLink to="/admin/problems" class="nav"><Icon name="warning" /><span>Problems</span></RouterLink>
      <RouterLink to="/library" class="nav"><Icon name="back" /><span>Back to library</span></RouterLink>
    </template>
    <template v-else>
    <RouterLink to="/library" class="nav"><Icon name="library" /><span>Library</span></RouterLink>
    <RouterLink to="/search" class="nav only-wide"><Icon name="search" /><span>Search</span></RouterLink>
    <RouterLink to="/playlists" class="nav"><Icon name="playlists" /><span>Playlists</span></RouterLink>
    <RouterLink to="/liked" class="nav only-wide"><Icon name="heart" /><span>Liked songs</span></RouterLink>
    <RouterLink to="/recent" class="nav only-wide"><Icon name="clock" /><span>Recently played</span></RouterLink>
    <RouterLink to="/offline" class="nav"><Icon name="offline" /><span>Offline</span></RouterLink>
    <RouterLink to="/upload" class="nav"><Icon name="upload" /><span>Upload</span></RouterLink>
    <RouterLink v-if="session.isAdmin" to="/admin" class="nav">
      <Icon name="admin" /><span>Admin</span>
      <span v-if="badge" class="count">{{ badge }}</span>
    </RouterLink>
    <template v-if="playlists.length">
      <div class="overline side-section">Your playlists</div>
      <RouterLink
        v-for="playlist in playlists.slice(0, 6)"
        :key="playlist.id"
        :to="`/playlists/${playlist.id}`"
        class="nav plain only-wide truncate"
      >{{ playlist.name }}</RouterLink>
    </template>
    </template>
    <RouterLink v-if="!admin" to="/settings" class="nav hide-rail"><Icon name="settings" /><span>Settings</span></RouterLink>
    <RouterLink to="/settings" class="row side-user" aria-label="Settings">
      <span class="avatar" style="width: 44px; height: 44px">{{ initial }}</span>
      <span class="side-user-text">
        <span class="truncate" style="display: block; font-weight: 600">{{ session.user?.display_name }}</span>
        <span class="muted label">{{ session.isAdmin ? 'Admin' : 'Member' }}</span>
      </span>
    </RouterLink>
  </nav>

  <nav class="tabbar" aria-label="Main">
    <RouterLink to="/library"><Icon name="library" />Library</RouterLink>
    <RouterLink to="/playlists"><Icon name="playlists" />Playlists</RouterLink>
    <RouterLink to="/offline"><Icon name="offline" />Offline</RouterLink>
    <RouterLink to="/upload"><Icon name="upload" />Upload</RouterLink>
    <RouterLink v-if="session.isAdmin" to="/admin">
      <Icon name="admin" />Admin
      <span v-if="badge" class="count">{{ badge }}</span>
    </RouterLink>
  </nav>
</template>
