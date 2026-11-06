<script setup>
import { computed, ref } from 'vue';
import { SWIPE_CANCEL_DISTANCE, swipeCancels, swipeOffset } from '../lib/pullRules.js';

const props = defineProps({ enabled: { type: Boolean, default: false } });
const emit = defineEmits(['cancel']);

const offset = ref(0);
const dragging = ref(false);
let startX = 0;

const revealed = computed(() => Math.min(Math.abs(offset.value) / SWIPE_CANCEL_DISTANCE, 1));

function down(event) {
  if (!props.enabled || event.target.closest('button')) return;
  startX = event.clientX;
  dragging.value = true;
  event.currentTarget.setPointerCapture(event.pointerId);
}

function move(event) {
  if (dragging.value) offset.value = swipeOffset(event.clientX - startX);
}

function up() {
  if (!dragging.value) return;
  const cancel = swipeCancels(offset.value);
  dragging.value = false;
  offset.value = 0;
  if (cancel) emit('cancel');
}

// The browser took over, usually for a vertical scroll.
function abandon() {
  dragging.value = false;
  offset.value = 0;
}
</script>

<template>
  <div class="swipe-row">
    <div class="swipe-row-action" :style="{ opacity: revealed }" aria-hidden="true">Cancel</div>
    <div
      class="swipe-row-body"
      :class="{ swipeable: enabled }"
      :style="{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 0.2s' }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="abandon"
    >
      <slot />
    </div>
  </div>
</template>
