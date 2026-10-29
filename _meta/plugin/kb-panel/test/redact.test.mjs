import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, hasSecret } from '../redact.js';

test('redacts common provider token shapes', () => {
  // Build the fixtures at runtime so the public-snapshot secret scanner does
  // not flag this test file itself.
  const sk = 'sk-' + 'proj-abcdefghijklmnopqrstuvwx';
  const gh = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz123456';
  const text = `key ${sk} and ${gh}`;
  const out = redactSecrets(text);
  assert.equal(out.includes(sk), false);
  assert.equal(out.includes(gh), false);
  assert.match(out, /\[REDACTED:api-key\]/);
  assert.match(out, /\[REDACTED:github-token\]/);
});

test('redacts key = value assignments but keeps the label', () => {
  const out = redactSecrets('api_key = "abcdEFGH12345678" and password: hunter2long');
  assert.match(out, /api_key = "\[REDACTED\]/);
  assert.match(out, /password: \[REDACTED\]/);
  assert.doesNotMatch(out, /abcdEFGH12345678/);
});

test('leaves ordinary prose about tokens alone', () => {
  const text = 'The token budget is 800 tokens; the password policy is documented.';
  assert.equal(redactSecrets(text), text);
  assert.equal(hasSecret(text), false);
});

test('redacts Bearer headers and PEM private keys', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
  const out = redactSecrets(`Authorization: Bearer abcdefghijklmnop\n${pem}`);
  assert.doesNotMatch(out, /abcdefghijklmnop/);
  assert.doesNotMatch(out, /MIIEow/);
  assert.match(out, /\[REDACTED:private-key\]/);
});

test('empty and null inputs are safe', () => {
  assert.equal(redactSecrets(''), '');
  assert.equal(redactSecrets(null), '');
  assert.equal(redactSecrets(undefined), '');
});
