<script setup>
import { ref } from 'vue';
import { devAuth, signIn } from '../lib/auth.js';
import { useSession } from '../stores/session.js';

const session = useSession();
const email = ref('owner@example.com');

async function submit() {
  await signIn(email.value.trim());
  if (devAuth) await session.load();
}
</script>

<template>
  <div class="center-screen">
    <div class="grow stack" style="align-items: center; justify-content: center">
      <img class="logo" src="/logo.svg" alt="" />
      <h1 class="display">Audify</h1>
      <p class="muted heading" style="font-weight: 400">Your music, your library — fast, light, and ready offline.</p>
    </div>
    <form class="stack" style="width: 100%" @submit.prevent="submit">
      <input v-if="devAuth" v-model="email" class="input" type="email" aria-label="Development email" />
      <button class="btn block" style="background: var(--text); color: var(--bg)">
        {{ devAuth ? 'Continue (development sign-in)' : 'Continue with Google' }}
      </button>
      <p class="muted label">Private app. New accounts need approval before they can listen.</p>
    </form>
  </div>
</template>
