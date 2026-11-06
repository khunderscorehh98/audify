import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useToast = defineStore('toast', () => {
  const current = ref(null);
  let timer = null;

  function dismiss() {
    clearTimeout(timer);
    const finished = current.value;
    current.value = null;
    return finished;
  }

  function show(message, { action = null, onAction = null, duration = 3500 } = {}) {
    dismiss();
    current.value = { message, action, onAction };
    timer = setTimeout(dismiss, duration);
  }

  function act() {
    dismiss()?.onAction?.();
  }

  const error = (err) => show(err?.message || 'Something went wrong');

  return { current, show, dismiss, act, error };
});
