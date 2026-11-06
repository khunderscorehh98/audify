import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { removeFromQueue } from '../src/lib/queueRules.js';

const queue = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const ids = (result) => result.queue.map((track) => track.id);

describe('removing songs from the queue', () => {
  it('moves on to the next song when the current one goes', () => {
    const result = removeFromQueue(queue, 1, [2]);
    assert.deepEqual(ids(result), [1, 3, 4]);
    assert.equal(result.index, 1);
    assert.equal(result.currentRemoved, true);
    assert.equal(result.queue[result.index].id, 3);
  });

  it('keeps playing when another song goes', () => {
    const result = removeFromQueue(queue, 2, [1]);
    assert.deepEqual(ids(result), [2, 3, 4]);
    assert.equal(result.index, 1);
    assert.equal(result.currentRemoved, false);
    assert.equal(result.queue[result.index].id, 3);
  });

  it('stops when the last song goes', () => {
    const result = removeFromQueue(queue, 3, [4]);
    assert.equal(result.index, -1);
    assert.equal(result.currentRemoved, true);
  });

  it('stops when nothing is left', () => {
    const result = removeFromQueue([{ id: 1 }], 0, [1]);
    assert.deepEqual(ids(result), []);
    assert.equal(result.index, -1);
  });

  it('handles several songs at once, including the next one', () => {
    const result = removeFromQueue(queue, 1, [2, 3]);
    assert.deepEqual(ids(result), [1, 4]);
    assert.equal(result.queue[result.index].id, 4);
  });

  it('does nothing for a song not in the queue', () => {
    const result = removeFromQueue(queue, 0, [99]);
    assert.equal(result.queue.length, 4);
    assert.equal(result.index, 0);
    assert.equal(result.currentRemoved, false);
  });
});
