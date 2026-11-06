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
