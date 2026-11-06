import { onBeforeUnmount, ref, watch } from 'vue';
import { PULL_THRESHOLD, canPullOn, isVerticalPull, pullDistance } from './pullRules.js';

const MIN_SPIN_MS = 500;
// Dialogs and fields sit inside the scroller, but pulling on them isn't a refresh.
const IGNORED = '.scrim, .now, input, select, textarea';

export function usePullToRefresh(scroller, { path, onRefresh }) {
  const distance = ref(0);
  const refreshing = ref(false);
  let start = null;

  function touchStart(event) {
    const allowed =
      !refreshing.value &&
      event.touches.length === 1 &&
      scroller.value.scrollTop <= 0 &&
      canPullOn(path()) &&
      !event.target.closest(IGNORED);
    start = allowed ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }

  function touchMove(event) {
    if (!start) return;
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (!distance.value && !isVerticalPull(dx, dy)) {
      // Scrolling up or sideways: this gesture isn't a pull.
      if (Math.abs(dx) > 8 || dy < -8) start = null;
      return;
    }
    if (event.cancelable) event.preventDefault(); // Stops iOS's rubber-band bounce.
    distance.value = pullDistance(dy);
  }

  async function touchEnd() {
    const ready = distance.value >= PULL_THRESHOLD;
    start = null;
    if (!ready) {
      distance.value = 0;
      return;
    }
    refreshing.value = true;
    distance.value = PULL_THRESHOLD;
    const pause = new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS));
    await Promise.allSettled([onRefresh(), pause]);
    refreshing.value = false;
    distance.value = 0;
  }

  const attach = (element) => {
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: false }); // Needed for preventDefault.
    element.addEventListener('touchend', touchEnd);
    element.addEventListener('touchcancel', touchEnd);
  };
  const detach = (element) => {
    element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('touchmove', touchMove);
    element.removeEventListener('touchend', touchEnd);
    element.removeEventListener('touchcancel', touchEnd);
  };

  // The scroller only exists after sign-in.
  watch(scroller, (element, previous) => {
    if (previous) detach(previous);
    if (element) attach(element);
  });
  onBeforeUnmount(() => scroller.value && detach(scroller.value));

  return { distance, refreshing };
}
