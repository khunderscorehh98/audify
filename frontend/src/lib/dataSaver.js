// "Save mobile data": only songs saved on this device play. Android (Chrome)
// reports when it's on mobile data, so there it applies automatically. iPhones
// don't tell web apps, so there it's a manual switch.
import { computed, ref } from 'vue';

const KEY = 'audify.saveData';

/** Pure rule, kept separate so it can be unit tested. */
export function streamingBlocked({ enabled, canDetect, type }) {
  if (!enabled) return false;
  return canDetect ? type === 'cellular' : true;
}

const connection = typeof navigator !== 'undefined' ? navigator.connection : undefined;
export const canDetect = Boolean(connection && typeof connection.type === 'string');

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const enabled = ref(read());
const type = ref(connection?.type ?? 'unknown');
connection?.addEventListener?.('change', () => {
  type.value = connection.type;
});

export const blocked = computed(() => streamingBlocked({ enabled: enabled.value, canDetect, type: type.value }));

export function toggle() {
  enabled.value = !enabled.value;
  try {
    localStorage.setItem(KEY, enabled.value ? '1' : '0');
  } catch {
    // Not remembered in private mode.
  }
}

export const BLOCKED_MESSAGE = canDetect
  ? 'Not saved on this device. Connect to Wi-Fi, or turn off Save mobile data.'
  : 'Not saved on this device. Turn off Save mobile data in Settings to stream it.';
