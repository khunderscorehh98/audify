import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIFETIME_SECONDS, artworkToDelete, expiresAt, expiryState } from '../src/lib/offlineRules.js';

const DAY = 86400000;
const now = 1_800_000_000_000;

describe('5-day rule', () => {
  it('lasts exactly 432,000 seconds', () => {
    assert.equal(LIFETIME_SECONDS, 432000);
    assert.equal(expiresAt(0), 432000 * 1000);
  });

  it('labels each stage', () => {
    assert.equal(expiryState(now, now).short, '5 days');
    assert.equal(expiryState(now - DAY, now).short, '4 days');
    assert.equal(expiryState(now - 4.5 * DAY, now).long, 'Expires tomorrow');
    assert.equal(expiryState(now - 4.5 * DAY, now).tone, 'soon');
    assert.equal(expiryState(now - 5 * DAY, now).tone, 'expired');
    assert.equal(expiryState(now - 6 * DAY, now).long, 'Expired — tap to download again');
  });
});

describe('shared artwork', () => {
  it('stays while another saved song uses it', () => {
    const removed = [{ id: 1, coverKey: 'a/' }];
    assert.deepEqual(artworkToDelete(removed, [{ id: 2, coverKey: 'a/' }]), []);
  });
  it('goes with the last song', () => {
    const removed = [{ id: 1, coverKey: 'a/' }, { id: 2, coverKey: 'a/' }, { id: 3, coverKey: null }];
    assert.deepEqual(artworkToDelete(removed, [{ id: 4, coverKey: 'b/' }]), ['a/']);
  });
});
