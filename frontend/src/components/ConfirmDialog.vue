<script setup>
import Icon from './Icon.vue';

defineProps({
  title: { type: String, required: true },
  body: { type: String, required: true },
  confirm: { type: String, default: 'Delete permanently' },
  icon: { type: String, default: 'trash' },
});
defineEmits(['confirm', 'cancel']);
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click.self="$emit('cancel')">
      <div class="sheet" role="alertdialog" :aria-label="title">
        <span class="avatar danger" style="width: 56px; height: 56px; background: var(--surface)"><Icon :name="icon" /></span>
        <div class="title">{{ title }}</div>
        <p class="muted">{{ body }}</p>
        <button class="btn danger-fill block" @click="$emit('confirm')">{{ confirm }}</button>
        <button class="btn outline block" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </Teleport>
</template>
