<script setup>
import { computed } from 'vue';

// One slider for the timeline and volume, styled in main.css (.seek).
const props = defineProps({
  value: { type: Number, required: true },
  max: { type: Number, required: true },
  min: { type: Number, default: 0 },
  step: { type: Number, default: 1 },
  label: { type: String, required: true },
});
const emit = defineEmits(['change']);

const fill = computed(() => {
  const range = props.max - props.min;
  return range > 0 ? `${Math.min(Math.max(((props.value - props.min) / range) * 100, 0), 100)}%` : '0%';
});
</script>

<template>
  <input
    class="seek"
    type="range"
    :min="min"
    :max="max || 0"
    :step="step"
    :value="value"
    :aria-label="label"
    :style="{ '--fill': fill }"
    @input="emit('change', Number($event.target.value))"
  />
</template>
