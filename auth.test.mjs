import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, passwordPolicy, randomToken, sha256, verifyPassword } from '../src/lib/crypto.js';

test('password credentials are salted and verifiable without storing plaintext', async () => {
  const password = 'E88-Private-Login-2026';
  const credential = await hashPassword(password);
  assert.notEqual(credential.hash, password);
  assert.ok(credential.salt);
  assert.equal(await verifyPassword(password, credential.hash, credential.salt, credential.iterations), true);
  assert.equal(await verifyPassword('Incorrect-Password-2026', credential.hash, credential.salt, credential.iterations), false);
});

test('password policy requires length, letter cases, and a number', () => {
  assert.equal(passwordPolicy('short'), 'Password must contain at least 12 characters.');
  assert.match(passwordPolicy('alllowercasepassword'), /uppercase/);
  assert.equal(passwordPolicy('Strong-Password-2026'), '');
});

test('session and activation tokens are random and stored through one-way hashes', async () => {
  const first = randomToken();
  const second = randomToken();
  assert.notEqual(first, second);
  assert.equal(await sha256(first), await sha256(first));
  assert.notEqual(await sha256(first), await sha256(second));
});
