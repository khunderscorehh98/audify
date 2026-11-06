<script setup>
import { ref } from 'vue';
import ConfirmDialog from './ConfirmDialog.vue';
import { useSession } from '../stores/session.js';

defineProps({ buttonClass: { type: String, default: 'btn outline block' } });

const session = useSession();
const asking = ref(false);
</script>

<template>
  <button :class="buttonClass" @click="asking = true">Sign out</button>
  <ConfirmDialog
    v-if="asking"
    icon="signout"
    title="Are you sure you want to sign out?"
    body="Any music playing will stop, and songs saved on this device will be removed. You'll need to sign in and download them again."
    confirm="Sign out"
    @confirm="session.signOut()"
    @cancel="asking = false"
  />
</template>
