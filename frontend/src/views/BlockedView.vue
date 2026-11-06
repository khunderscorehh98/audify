<script setup>
import Icon from '../components/Icon.vue';
import SignOutButton from '../components/SignOutButton.vue';
</script>

<template>
  <div class="center-screen">
    <div class="grow stack" style="align-items: center; justify-content: center">
      <span class="avatar danger" style="width: 112px; height: 112px; background: var(--surface)"><Icon name="block" :size="44" /></span>
      <h1 class="title">Your access has been removed</h1>
      <p class="muted">Songs saved on this device have been deleted. Talk to the admin if you think this is a mistake.</p>
    </div>
    <SignOutButton />
  </div>
</template>
