<script setup>
import { computed, ref } from 'vue';
import { authErrorMessage } from '../lib/authErrors.js';
import * as auth from '../lib/auth.js';
import { useSession } from '../stores/session.js';

const MIN_PASSWORD = 8;

const session = useSession();
const mode = ref('signIn'); // signIn | create | reset
const email = ref(auth.devAuth ? 'owner@example.com' : '');
const password = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');

const title = computed(() => ({ signIn: 'Sign in', create: 'Create account', reset: 'Reset password' })[mode.value]);

function switchTo(next) {
  mode.value = next;
  error.value = '';
  notice.value = '';
}

async function attempt(action) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (failure) {
    error.value = authErrorMessage(failure.code);
  } finally {
    busy.value = false;
  }
}

function submit() {
  const address = email.value.trim();
  if (auth.devAuth) {
    auth.devSignIn(address);
    return session.load();
  }
  if (mode.value === 'create' && password.value.length < MIN_PASSWORD) {
    error.value = `Use at least ${MIN_PASSWORD} characters.`;
    return undefined;
  }
  return attempt(async () => {
    if (mode.value === 'reset') {
      await auth.resetPassword(address);
      notice.value = 'If that email has an account, a reset link is on its way.';
      return;
    }
    await (mode.value === 'create' ? auth.createAccount(address, password.value) : auth.signInWithEmail(address, password.value));
    await session.load();
  });
}
</script>

<template>
  <div class="center-screen">
    <div class="grow stack" style="align-items: center; justify-content: center">
      <img class="logo" src="/logo.svg" alt="" />
      <h1 class="display">Audify</h1>
      <p class="muted heading" style="font-weight: 400">Your music, your library — fast, light, and ready offline.</p>
    </div>

    <div class="stack" style="width: 100%; gap: 12px">
      <template v-if="!auth.devAuth && mode !== 'reset'">
        <button class="btn block" style="background: var(--text); color: var(--bg)" :disabled="busy" @click="attempt(auth.signInWithGoogle)">
          Continue with Google
        </button>
        <p class="muted label">or use your email</p>
      </template>

      <form class="stack" style="gap: 12px; text-align: left" @submit.prevent="submit">
        <input v-model="email" class="input" type="email" required autocomplete="email" placeholder="Email" aria-label="Email" />
        <input
          v-if="!auth.devAuth && mode !== 'reset'"
          v-model="password"
          class="input"
          type="password"
          required
          :autocomplete="mode === 'create' ? 'new-password' : 'current-password'"
          placeholder="Password"
          aria-label="Password"
        />
        <p v-if="error" class="danger label" role="alert">{{ error }}</p>
        <p v-if="notice" class="accent label" role="status">{{ notice }}</p>
        <button class="btn primary block" :disabled="busy">{{ auth.devAuth ? 'Continue (development sign-in)' : title }}</button>
      </form>

      <div v-if="!auth.devAuth" class="row spread label">
        <button v-if="mode !== 'signIn'" class="accent" style="min-height: 44px" @click="switchTo('signIn')">Back to sign in</button>
        <button v-else class="accent" style="min-height: 44px" @click="switchTo('create')">Create account</button>
        <button v-if="mode === 'signIn'" class="muted" style="min-height: 44px" @click="switchTo('reset')">Forgot password?</button>
      </div>
      <p class="muted label">Private app. New accounts need approval before they can listen.</p>
    </div>
  </div>
</template>
