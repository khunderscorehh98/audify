import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PULL_THRESHOLD, canPullOn, isVerticalPull, pullDistance } from '../src/lib/pullRules.js';

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
