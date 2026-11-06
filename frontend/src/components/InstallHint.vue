<script setup>
import { ref } from 'vue';

// iPhone has no install prompt, so show a one-time hint in Safari.
const KEY = 'audify.installHint';
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Feature check: only iOS exposes navigator.standalone.
const show = ref('standalone' in navigator && !standalone && !localStorage.getItem(KEY));

function dismiss() {
  localStorage.setItem(KEY, '1');
  show.value = false;
}
</script>

<template>
  <div v-if="show" class="notice quiet" style="margin-bottom: 16px">
    <span class="grow">Install Audify: tap Share, then Add to Home Screen. Open it from the icon to keep music playing when the phone locks.</span>
    <button class="btn small outline" @click="dismiss">Got it</button>
  </div>
</template>
