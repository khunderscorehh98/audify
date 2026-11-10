/**
 * Takes songs out of the play queue. Returns the new queue, where playback
 * should be, and whether the song playing now was one of those removed.
 * Pure, so it can be unit tested.
 */
export function removeFromQueue(queue, index, ids) {
  const gone = new Set(ids);
  const remaining = queue.filter((track) => !gone.has(track.id));
  const current = queue[index];
  if (!current || !gone.has(current.id)) {
    return { queue: remaining, index: remaining.findIndex((track) => track.id === current?.id), currentRemoved: false };
  }
  // The next surviving song sits where the removed one was.
  const next = queue.slice(0, index).filter((track) => !gone.has(track.id)).length;
  return { queue: remaining, index: next < remaining.length ? next : -1, currentRemoved: true };
}

const randomOrder = (items, random) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Shuffle on: the chosen song first, the rest in random order. */
export function shuffleWithFirst(tracks, firstIndex, random = Math.random) {
  if (!tracks.length) return [];
  const first = tracks[firstIndex] ?? tracks[0];
  return [first, ...randomOrder(tracks.filter((track) => track !== first), random)];
}

/** Repeat all with shuffle: a fresh order each lap, never the same song twice in a row. */
export function reshuffle(tracks, lastId, random = Math.random) {
  const order = randomOrder(tracks, random);
  if (order.length > 1 && order[0].id === lastId) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/** Where Next goes. -1 means the end of the queue. */
export function nextIndex(index, length, repeat) {
  if (index + 1 < length) return index + 1;
  return repeat === 'all' && length ? 0 : -1;
}

/** Where Previous goes, when it isn't restarting the current song. */
export function previousIndex(index, length, repeat) {
  if (index > 0) return index - 1;
  return repeat === 'all' && length ? length - 1 : 0;
}

export const REPEAT_MODES = ['off', 'all', 'one'];
export const nextRepeatMode = (mode) => REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length];

