import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, tokensOf } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims the client id and coerces the interval from a form string', () => {
  const config = normalizeConfig({ client_id: '  abc  ', poll_interval: '300' });
  assert.equal(config.client_id, 'abc');
  assert.equal(config.poll_interval, 300);
});

test('normalizeConfig keeps the interval within the manifest bounds', () => {
  assert.equal(normalizeConfig({ poll_interval: 10 }).poll_interval, 60);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).poll_interval, 3600);
  assert.equal(normalizeConfig({ poll_interval: 'abc' }).poll_interval, 120);
});

test('normalizeConfig keeps the token keys stored outside the schema', () => {
  const config = normalizeConfig({ refresh_token: 'r', access_token: 'a', token_expires_at: 5 });
  assert.deepEqual(tokensOf(config), {
    access_token: 'a',
    refresh_token: 'r',
    token_expires_at: 5,
  });
});

test('tokensOf treats cleared tokens as absent', () => {
  assert.deepEqual(tokensOf({ access_token: '', refresh_token: '', token_expires_at: 0 }), {
    access_token: undefined,
    refresh_token: undefined,
    token_expires_at: 0,
  });
});
