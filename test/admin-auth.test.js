const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionToken,
  verifySessionToken,
} = require('../api/_admin-auth');

test('admin session tokens reject tampering and expiry', () => {
  const secret = 'test-secret-that-is-long-enough-for-tests';
  const now = Date.now();
  const token = createSessionToken(secret, now);

  assert.equal(verifySessionToken(token, secret, now + 1000), true);
  assert.equal(verifySessionToken(`${token}x`, secret, now + 1000), false);
  assert.equal(verifySessionToken(token, 'different-secret', now + 1000), false);
  assert.equal(verifySessionToken(token, secret, now + 13 * 60 * 60 * 1000), false);
});
