<script setup>
import Icon from './Icon.vue';

// The same three controls on every admin list, depending on the tab.
defineProps({ view: { type: String, required: true }, canEdit: { type: Boolean, default: true } });
defineEmits(['edit', 'archive', 'delete', 'restore', 'permanent']);
</script>

<template>
  <div class="actions" @click.stop>
    <template v-if="view === 'active'">
      <button v-if="canEdit" class="icon-btn" aria-label="Edit" @click="$emit('edit')"><Icon name="edit" :size="20" /></button>
      <button class="icon-btn" aria-label="Archive" @click="$emit('archive')"><Icon name="archive" :size="20" /></button>
      <button class="icon-btn danger" aria-label="Move to Deleted" @click="$emit('delete')"><Icon name="trash" :size="20" /></button>
    </template>
    <button v-else-if="view === 'archived'" class="btn small outline" @click="$emit('restore')">Unarchive</button>
    <template v-else>
      <button class="btn small outline" @click="$emit('restore')">Restore</button>
      <button class="icon-btn danger" aria-label="Delete permanently" @click="$emit('permanent')"><Icon name="trash" :size="20" /></button>
    </template>
  </div>
</template>
