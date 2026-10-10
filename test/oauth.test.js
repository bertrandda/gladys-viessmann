import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PendingAuthorizations,
  buildAuthorizeUrl,
  codeChallenge,
  createCodeVerifier,
  exchangeCode,
  refreshTokens,
} from '../src/vicare/oauth.js';
import { ViCareAuthError, ViCareError } from '../src/vicare/errors.js';
import { createFakeViCare } from './helpers/fakeViCare.js';

const REDIRECT_URI = 'https://my.gladysassistant.com/redirect/oauth';

test('the code challenge follows RFC 7636 (appendix B test vector)', () => {
  assert.equal(
    codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('code verifiers are random and within the RFC 7636 length and charset', () => {
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(createCodeVerifier(), verifier);
});

test('the authorize URL carries the client, the redirect URI, the scopes and PKCE', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'abc',
      redirectUri: REDIRECT_URI,
      state: 's1',
      verifier: 'v'.repeat(64),
    }),
  );
  assert.equal(
    url.origin + url.pathname,
    'https://iam.viessmann-climatesolutions.com/idp/v3/authorize',
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'abc');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('scope'), 'IoT offline_access');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('code_challenge'), codeChallenge('v'.repeat(64)));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('a pending authorization is single use and expires after 10 minutes', () => {
  let now = 0;
  const pending = new PendingAuthorizations({ now: () => now });
  const first = pending.create('client-a');
  assert.deepEqual(pending.consume(first.state), {
    verifier: first.verifier,
    clientId: 'client-a',
  });
  assert.equal(pending.consume(first.state), undefined);

  const second = pending.create('client-a');
  now += 11 * 60 * 1000;
  assert.equal(pending.consume(second.state), undefined);
  assert.equal(pending.consume('never-issued'), undefined);
});

test('exchangeCode posts the code and the verifier, and computes the expiry', async () => {
  const vicare = createFakeViCare();
  const tokens = await exchangeCode(vicare.fetch, {
    clientId: 'abc',
    code: 'the-code',
    redirectUri: REDIRECT_URI,
    verifier: 'the-verifier',
    now: () => 1000,
  });
  assert.deepEqual(tokens, {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    token_expires_at: 1000 + 3600 * 1000,
  });
  const [request] = vicare.requests;
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body, {
    grant_type: 'authorization_code',
    client_id: 'abc',
    code: 'the-code',
    redirect_uri: REDIRECT_URI,
    code_verifier: 'the-verifier',
  });
});

test('refreshTokens keeps the refresh token undefined when the IAM does not rotate it', async () => {
  const vicare = createFakeViCare({
    override: () => ({ body: { access_token: 'new-access', expires_in: 3600 } }),
  });
  const tokens = await refreshTokens(vicare.fetch, {
    clientId: 'abc',
    refreshToken: 'r',
    now: () => 0,
  });
  assert.equal(tokens.access_token, 'new-access');
  assert.equal(tokens.refresh_token, undefined);
  assert.deepEqual(vicare.requests[0].body, {
    grant_type: 'refresh_token',
    client_id: 'abc',
    refresh_token: 'r',
  });
});

test('a revoked refresh token is an authorization error, a server failure is not', async () => {
  const revoked = createFakeViCare({
    override: () => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'expired' },
    }),
  });
  await assert.rejects(
    refreshTokens(revoked.fetch, { clientId: 'abc', refreshToken: 'r' }),
    ViCareAuthError,
  );

  const down = createFakeViCare({ override: () => ({ status: 503, body: {} }) });
  await assert.rejects(refreshTokens(down.fetch, { clientId: 'abc', refreshToken: 'r' }), (err) => {
    assert.ok(err instanceof ViCareError);
    assert.ok(!(err instanceof ViCareAuthError));
    return true;
  });
});
