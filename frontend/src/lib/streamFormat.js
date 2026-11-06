// Feature detection, never device sniffing (build §5).
const KEY = 'streamFormat';
const LOSSLESS_KEY = 'audify.lossless';

const FORMATS = [
  { key: 'opus', mime: 'audio/webm; codecs="opus"' },
  { key: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' },
];

export function streamFormat() {
  const saved = localStorage.getItem(KEY);
  if (saved) return saved;
  const audio = document.createElement('audio');
  const best = FORMATS.find((format) => audio.canPlayType(format.mime) !== '');
  const key = best ? best.key : 'aac';
  localStorage.setItem(KEY, key);
  return key;
}

/** Called when playback fails despite canPlayType saying yes. */
export const preferAac = () => localStorage.setItem(KEY, 'aac');

export const losslessEnabled = () => localStorage.getItem(LOSSLESS_KEY) === '1';
export const setLossless = (on) => localStorage.setItem(LOSSLESS_KEY, on ? '1' : '0');

export const BITRATES = { opus: 96, aac: 128, flac: 900 };
export const formatLabel = (key) =>
  key === 'flac' ? 'FLAC · lossless' : key === 'aac' ? 'AAC · 128 kbps' : 'Opus · 96 kbps';

// Data usage is an estimate: bitrate × seconds, per device, per month.
const usageKey = () => `audify.usage.${new Date().toISOString().slice(0, 7)}`;

export function addUsage(kind, megabytes) {
  const usage = readUsage();
  usage[kind] = (usage[kind] || 0) + megabytes;
  localStorage.setItem(usageKey(), JSON.stringify(usage));
}

export function readUsage() {
  try {
    return { streaming: 0, offline: 0, ...JSON.parse(localStorage.getItem(usageKey()) || '{}') };
  } catch {
    return { streaming: 0, offline: 0 };
  }
}
