<script setup>
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import RangeSlider from './RangeSlider.vue';
import { volumeAdjustable } from '../lib/volume.js';

const props = defineProps({ modelValue: { type: Number, required: true } });
const emit = defineEmits(['update:modelValue']);

let beforeMute = props.modelValue || 1;
const muted = computed(() => props.modelValue === 0);
const hidden = ref(!volumeAdjustable);

function set(value) {
  emit('update:modelValue', value);
}

function toggleMute() {
  if (muted.value) {
    set(beforeMute || 1);
  } else {
    beforeMute = props.modelValue;
    set(0);
  }
}
</script>

<template>
  <div v-if="!hidden" class="volume">
    <button class="icon-btn" :aria-label="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
      <Icon :name="muted ? 'volume-off' : 'volume'" :size="20" />
    </button>
    <RangeSlider :value="modelValue" :max="1" :step="0.01" label="Volume" @change="set" />
  </div>
</template>
