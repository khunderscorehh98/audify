<script setup>
defineProps({
  modelValue: { type: String, required: true },
  counts: { type: Object, default: () => ({}) },
});
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="chips" role="tablist">
    <button
      v-for="view in ['active', 'archived', 'deleted']"
      :key="view"
      class="chip"
      :class="{ on: modelValue === view }"
      role="tab"
      :aria-selected="modelValue === view"
      @click="$emit('update:modelValue', view)"
    >
      {{ view.charAt(0).toUpperCase() + view.slice(1) }}<template v-if="counts[view] !== undefined">&nbsp;· {{ counts[view] }}</template>
    </button>
  </div>
</template>
