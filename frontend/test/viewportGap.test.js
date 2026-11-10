import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideGap } from '../src/lib/viewportGap.js';

const iphone = { standalone: true, fullHeight: 874, safeTop: 62 };

describe('iPhone viewport gap', () => {
  it('corrects the short state', () => {
    assert.equal(decideGap({ ...iphone, innerHeight: 812 }), 62);
  });

  it('leaves the full state alone', () => {
    assert.equal(decideGap({ ...iphone, innerHeight: 874 }), 0);
  });

  it('ignores gaps that are not the status bar, such as the keyboard', () => {
    assert.equal(decideGap({ ...iphone, innerHeight: 520 }), 0);
    assert.equal(decideGap({ ...iphone, innerHeight: 850 }), 0);
  });

  it('allows a few pixels of rounding', () => {
    assert.equal(decideGap({ ...iphone, innerHeight: 815 }), 62);
  });

  it('does nothing outside the installed app, or with no status bar inset', () => {
    assert.equal(decideGap({ ...iphone, standalone: false, innerHeight: 812 }), 0);
    assert.equal(decideGap({ ...iphone, safeTop: 0, innerHeight: 812 }), 0);
  });
});
