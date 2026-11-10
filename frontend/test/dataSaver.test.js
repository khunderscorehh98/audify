import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { streamingBlocked } from '../src/lib/dataSaver.js';

describe('Save mobile data', () => {
  it('does nothing while off', () => {
    assert.equal(streamingBlocked({ enabled: false, canDetect: true, type: 'cellular' }), false);
    assert.equal(streamingBlocked({ enabled: false, canDetect: false, type: 'unknown' }), false);
  });

  it('on Android, blocks streaming on mobile data only', () => {
    assert.equal(streamingBlocked({ enabled: true, canDetect: true, type: 'cellular' }), true);
    assert.equal(streamingBlocked({ enabled: true, canDetect: true, type: 'wifi' }), false);
    assert.equal(streamingBlocked({ enabled: true, canDetect: true, type: 'ethernet' }), false);
  });

  it('on iPhone, blocks streaming whenever it is on', () => {
    assert.equal(streamingBlocked({ enabled: true, canDetect: false, type: 'unknown' }), true);
  });
});
