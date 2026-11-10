// One volume for the player and the approval preview, remembered on this device.
const KEY = 'audify.volume';

/**
 * Computers only. Phones and tablets use their own volume buttons, which work
 * everywhere and keep background playback safe. iOS also ignores volume set by
 * a web page, so that's checked too.
 */
export const volumeAdjustable = (() => {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return false; // Touch-first device
    const probe = new Audio();
    probe.volume = 0.5;
    return probe.volume === 0.5;
  } catch {
    return false;
  }
})();

export function loadVolume() {
  if (!volumeAdjustable) return 1;
  try {
    const saved = Number(localStorage.getItem(KEY));
    return localStorage.getItem(KEY) !== null && saved >= 0 && saved <= 1 ? saved : 1;
  } catch {
    return 1;
  }
}

export function saveVolume(value) {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // Private mode: the volume just isn't remembered.
  }
}
