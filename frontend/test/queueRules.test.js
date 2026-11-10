import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextIndex, nextRepeatMode, previousIndex, removeFromQueue, reshuffle, shuffleWithFirst } from '../src/lib/queueRules.js';

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

// A predictable "random" sequence, so shuffle results can be checked.
const seeded = (seed = 7) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

describe('play order', () => {
  it('shuffle keeps the chosen song first and every song once', () => {
    const order = shuffleWithFirst(queue, 2, seeded());
    assert.equal(order[0].id, 3);
    assert.deepEqual(order.map((track) => track.id).sort(), [1, 2, 3, 4]);
  });

  it('reshuffling for a new lap never repeats the last song first', () => {
    for (let seed = 1; seed < 50; seed += 1) {
      assert.notEqual(reshuffle(queue, 4, seeded(seed))[0].id, 4);
    }
  });

  it('next stops at the end unless repeating everything', () => {
    assert.equal(nextIndex(1, 4, 'off'), 2);
    assert.equal(nextIndex(3, 4, 'off'), -1);
    assert.equal(nextIndex(3, 4, 'one'), -1);
    assert.equal(nextIndex(3, 4, 'all'), 0);
  });

  it('previous wraps to the end only when repeating everything', () => {
    assert.equal(previousIndex(2, 4, 'off'), 1);
    assert.equal(previousIndex(0, 4, 'off'), 0);
    assert.equal(previousIndex(0, 4, 'all'), 3);
  });

  it('repeat cycles off, all, one', () => {
    assert.equal(nextRepeatMode('off'), 'all');
    assert.equal(nextRepeatMode('all'), 'one');
    assert.equal(nextRepeatMode('one'), 'off');
  });
});

