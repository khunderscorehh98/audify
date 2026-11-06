<script setup>
import { ref } from 'vue';
import Icon from '../components/Icon.vue';
import SignOutButton from '../components/SignOutButton.vue';
import { useSession } from '../stores/session.js';

const session = useSession();
const checking = ref(false);

async function check() {
  checking.value = true;
  await session.refresh().catch(() => {});
  checking.value = false;
}
</script>

<template>
  <div class="center-screen">
    <div class="grow stack" style="align-items: center; justify-content: center">
      <span class="avatar warn" style="width: 112px; height: 112px; background: var(--surface)"><Icon name="clock" :size="44" /></span>
      <h1 class="title">Waiting for approval</h1>
      <p class="muted">Your account is set up. The admin needs to approve it before you can listen. You'll get in as soon as they do.</p>
      <div class="card row">
        <span class="avatar" style="width: 44px; height: 44px">{{ session.user?.display_name?.charAt(0)?.toUpperCase() }}</span>
        <div style="text-align: left">
          <div style="font-weight: 600">{{ session.user?.display_name }}</div>
          <div class="muted label">{{ session.user?.email }}</div>
        </div>
      </div>
    </div>
    <div class="stack" style="width: 100%">
      <button class="btn outline block" :disabled="checking" @click="check">Check again</button>
      <SignOutButton button-class="btn block accent" />
    </div>
  </div>
</template>
