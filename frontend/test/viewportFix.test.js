import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { viewportGap } from '../src/lib/viewportFix.js';

const iphone = { standalone: true, screenHeight: 852, screenWidth: 393 };

describe('iPhone viewport gap', () => {
  it('finds the missing status bar height', () => {
    assert.equal(viewportGap({ ...iphone, innerHeight: 793, innerWidth: 393 }), 59);
  });

  it('is zero when the viewport is already full', () => {
    assert.equal(viewportGap({ ...iphone, innerHeight: 852, innerWidth: 393 }), 0);
  });

  it('handles landscape', () => {
    assert.equal(viewportGap({ ...iphone, innerHeight: 393, innerWidth: 852 }), 0);
  });

  it('ignores the keyboard', () => {
    assert.equal(viewportGap({ ...iphone, innerHeight: 500, innerWidth: 393 }), 0);
  });

  it('only applies to the installed app', () => {
    assert.equal(viewportGap({ ...iphone, standalone: false, innerHeight: 700, innerWidth: 393 }), 0);
  });
});
