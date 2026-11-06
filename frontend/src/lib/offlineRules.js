// Pure rules behind the 5-day timer, kept separate so they can be unit tested.
export const LIFETIME_SECONDS = 432000; // 5 days
const DAY = 86400000;

export const expiresAt = (savedAt) => savedAt + LIFETIME_SECONDS * 1000;

/** Label and tone for a saved song at a given moment. */
export function expiryState(savedAt, now = Date.now()) {
  const left = expiresAt(savedAt) - now;
  if (left <= 0) return { tone: 'expired', days: 0, short: 'Expired', long: 'Expired — tap to download again' };
  if (left < DAY) return { tone: 'soon', days: 1, short: 'Tomorrow', long: 'Expires tomorrow' };
  const days = Math.ceil(left / DAY);
  if (days === 1) return { tone: 'soon', days, short: 'Tomorrow', long: 'Expires tomorrow' };
  return { tone: 'ok', days, short: `${days} days`, long: `Expires in ${days} days` };
}

/** Patch 2 §3: shared album art is deleted only with its last saved song. */
export function artworkToDelete(removed, remaining) {
  const stillUsed = new Set(remaining.map((item) => item.coverKey).filter(Boolean));
  return [...new Set(removed.map((item) => item.coverKey).filter(Boolean))].filter((key) => !stillUsed.has(key));
}
