import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authErrorMessage } from '../src/lib/authErrors.js';

describe('sign-in error messages', () => {
  it("doesn't reveal whether an account exists", () => {
    const wrong = authErrorMessage('auth/wrong-password');
    assert.equal(authErrorMessage('auth/user-not-found'), wrong);
    assert.equal(authErrorMessage('auth/invalid-credential'), wrong);
  });

  it('never shows a raw Firebase code', () => {
    assert.doesNotMatch(authErrorMessage('auth/something-new'), /auth\//);
  });
});
