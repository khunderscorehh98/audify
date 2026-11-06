import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PULL_THRESHOLD, SWIPE_CANCEL_DISTANCE, canPullOn, isVerticalPull, pullDistance, swipeCancels, swipeOffset } from '../src/lib/pullRules.js';

describe('pull to refresh', () => {
  it('needs a deliberate pull to trigger', () => {
    assert.equal(pullDistance(100) < PULL_THRESHOLD, true);
    assert.equal(pullDistance(140), PULL_THRESHOLD);
  });

  it('stops at a limit and never goes negative', () => {
    assert.equal(pullDistance(1000), 110);
    assert.equal(pullDistance(-50), 0);
  });

  it('leaves sideways drags alone', () => {
    assert.equal(isVerticalPull(2, 30), true);
    assert.equal(isVerticalPull(40, 30), false);
    assert.equal(isVerticalPull(0, -30), false);
  });

  it('stays off screens where it would lose work', () => {
    assert.equal(canPullOn('/library'), true);
    assert.equal(canPullOn('/admin/approve'), false);
    assert.equal(canPullOn('/upload'), false);
  });
});

describe('swipe left to cancel', () => {
  it('only moves left', () => {
    assert.equal(swipeOffset(50), 0);
    assert.equal(swipeOffset(-50), -50);
  });

  it('cancels only after a deliberate swipe', () => {
    assert.equal(swipeCancels(swipeOffset(-(SWIPE_CANCEL_DISTANCE - 1))), false);
    assert.equal(swipeCancels(swipeOffset(-SWIPE_CANCEL_DISTANCE)), true);
    assert.equal(swipeCancels(swipeOffset(-300)), true);
  });
});

