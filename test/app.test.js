// End to end: the SDK handlers of src/app.js, driven like Gladys would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHandlers } from '../src/app.js';
import { MESSAGES } from '../src/messages.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { HEATPUMP_GATEWAY, createFakeViCare, fixture, linkedConfig } from './helpers/fakeViCare.js';

const REDIRECT_URI = 'https://my.gladysassistant.com/redirect/oauth';

function setup(t, { config = {}, override } = {}) {
  const vicare = createFakeViCare({ override });
  const gladys = createFakeGladys({ config });
  const app = registerHandlers(gladys, { fetch: vicare.fetch });
  t.after(() => app.stop());
  return { vicare, gladys, app };
}

test('without a client id, the status asks for it and nothing is called', async (t) => {
  const { vicare, gladys } = setup(t);
  await gladys.connect();
  assert.deepEqual(gladys.lastStatus(), { connected: false, message: MESSAGES.missingClientId });
  assert.equal(vicare.requests.length, 0);
});

test('with a client id but no account, the status asks to click Connect', async (t) => {
  const { gladys } = setup(t, { config: { client_id: 'client-123' } });
  await gladys.connect();
  assert.deepEqual(gladys.lastStatus(), { connected: false, message: MESSAGES.notLinked });
});

test('a linked account publishes the devices and their states on connection', async (t) => {
  const { vicare, gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  assert.deepEqual(gladys.lastStatus(), { connected: true, message: undefined });
  assert.equal(gladys.discoveredDevices.length, 6);
  assert.ok(gladys.states.length > 30);
  // 1 call for the installations + 1 per gateway.
  assert.equal(vicare.apiRequests().length, 3);
});

test('the Connect flow: authorize URL, callback, tokens stored, devices published', async (t) => {
  const { vicare, gladys } = setup(t, { config: { client_id: 'client-123' } });
  await gladys.connect();

  const authorizeUrl = new URL(
    await gladys.handlers.oauthAuthorizeUrl('vicare_account', REDIRECT_URI),
  );
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'client-123');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), REDIRECT_URI);
  const state = authorizeUrl.searchParams.get('state');
  assert.ok(state);

  await gladys.handlers.oauthCallback('vicare_account', {
    code: 'abc',
    state,
    redirectUri: REDIRECT_URI,
  });
  const tokenRequest = vicare.requests.find((r) => r.url.pathname === '/idp/v3/token');
  assert.equal(tokenRequest.body.code, 'abc');
  assert.equal(tokenRequest.body.client_id, 'client-123');
  assert.ok(tokenRequest.body.code_verifier.length >= 43);
  assert.equal(gladys.config.access_token, 'access-1');
  assert.equal(gladys.config.refresh_token, 'refresh-1');
  assert.ok(gladys.config.token_expires_at > Date.now());
  assert.equal(gladys.discoveredDevices.length, 6);
  assert.deepEqual(gladys.lastStatus(), { connected: true, message: undefined });
});

test('the callback refuses a state it did not issue', async (t) => {
  const { vicare, gladys } = setup(t, { config: { client_id: 'client-123' } });
  await gladys.connect();
  await assert.rejects(
    gladys.handlers.oauthCallback('vicare_account', {
      code: 'abc',
      state: 'forged',
      redirectUri: REDIRECT_URI,
    }),
    /Unknown or expired authorization/,
  );
  assert.equal(vicare.requests.length, 0);
});

test('Connect without a saved client id explains what to do', async (t) => {
  const { vicare, gladys } = setup(t);
  await gladys.connect();
  await assert.rejects(
    gladys.handlers.oauthAuthorizeUrl('vicare_account', REDIRECT_URI),
    /client ID/,
  );
  // Gladys shows a generic error under the button: the status says to save.
  assert.deepEqual(gladys.lastStatus(), {
    connected: false,
    message: MESSAGES.saveBeforeConnect,
  });

  // Saving the client ID moves on to the next step, and Connect then works.
  gladys.config.client_id = 'client-123';
  await gladys.handlers.configUpdated({ ...gladys.config });
  assert.deepEqual(gladys.lastStatus(), { connected: false, message: MESSAGES.notLinked });
  const authorizeUrl = new URL(
    await gladys.handlers.oauthAuthorizeUrl('vicare_account', REDIRECT_URI),
  );
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'client-123');
  assert.equal(vicare.requests.length, 0);
});

test('a revoked authorization asks to connect again', async (t) => {
  const { gladys } = setup(t, {
    config: linkedConfig({ token_expires_at: 0 }),
    override: ({ url }) =>
      url.pathname.endsWith('/token')
        ? { status: 400, body: { error: 'invalid_grant' } }
        : undefined,
  });
  await gladys.connect();
  assert.deepEqual(gladys.lastStatus(), { connected: false, message: MESSAGES.authExpired });
});

test('the quota error at start-up is explained with the resume time', async (t) => {
  const body = fixture('errors/rate-limit');
  const { gladys } = setup(t, { config: linkedConfig(), override: () => ({ status: 429, body }) });
  await gladys.connect();
  const { connected, message } = gladys.lastStatus();
  assert.equal(connected, false);
  assert.match(message.en, /quota reached: the integration resumes at 16:20 UTC/);
  assert.match(message.fr, /16:20 UTC/);
});

test('changing the client id forgets the tokens of the previous one', async (t) => {
  const { gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  await gladys.handlers.configUpdated({ ...gladys.config, client_id: 'another-client' });
  assert.equal(gladys.config.refresh_token, '');
  assert.equal(gladys.config.access_token, '');
  assert.deepEqual(gladys.lastStatus(), { connected: false, message: MESSAGES.notLinked });
});

test('the echo of our own token writes changes nothing', async (t) => {
  const { vicare, gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  const calls = vicare.requests.length;
  await gladys.handlers.configUpdated({ ...gladys.config, access_token: 'other' });
  assert.equal(vicare.requests.length, calls);
  assert.deepEqual(gladys.configWrites, []);
});

test('the test button summarizes the account', async (t) => {
  const { gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  const message = await gladys.handlers['action:test_connection']({});
  assert.match(
    message.en,
    /^Connected to ViCare: 1 installation\(s\), 2 gateway\(s\), 2 heating appliance\(s\)/,
  );
  assert.match(message.en, /VScotHO1_200_11, E3_Vitocal_250A/);
  assert.match(message.en, /6 device\(s\) available in the Discovery tab\.$/);
  assert.match(message.fr, /^Connecté à ViCare : 1 installation\(s\)/);
});

test('the test button explains a missing setup instead of failing', async (t) => {
  const { gladys } = setup(t, { config: { client_id: 'client-123' } });
  await gladys.connect();
  assert.deepEqual(await gladys.handlers['action:test_connection']({}), MESSAGES.notLinked);
});

test('the test button reports an API error', async (t) => {
  const { gladys } = setup(t, {
    config: linkedConfig(),
    override: () => ({ status: 500, body: { statusCode: 500, message: 'Internal server error' } }),
  });
  await gladys.connect();
  const message = await gladys.handlers['action:test_connection']({});
  assert.match(
    message.en,
    /^ViCare API error \(Internal server error\), retrying at the next refresh\.$/,
  );
});

test('a scan request publishes the devices again', async (t) => {
  const { gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  gladys.discoveredDevices = [];
  await gladys.handlers.scanRequest();
  assert.equal(gladys.discoveredDevices.length, 6);
});

test('creating a device in Gladys re-sends its states', async (t) => {
  const { gladys } = setup(t, { config: linkedConfig() });
  await gladys.connect();
  const dhw = gladys.externalIds('dhw', `${HEATPUMP_GATEWAY}-0`).device;
  const sent = gladys.states.length;
  await gladys.handlers.deviceCreated({ external_id: dhw });
  const resent = gladys.states.slice(sent);
  assert.ok(resent.length > 0);
  assert.ok(resent.every((s) => s.device_feature_external_id.startsWith(`${dhw}:`)));
});

test('a failed start is retried later, even after a failed test', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let down = true;
  const { vicare, gladys } = setup(t, {
    config: linkedConfig(),
    override: ({ url }) =>
      down && url.pathname.startsWith('/iot/')
        ? { status: 503, body: { statusCode: 503, message: 'Unavailable' } }
        : undefined,
  });
  await gladys.connect();
  assert.equal(gladys.lastStatus().connected, false);
  await gladys.handlers['action:test_connection']({});

  down = false;
  const calls = vicare.apiRequests().length;
  t.mock.timers.tick(5 * 60 * 1000);
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(vicare.apiRequests().length, calls + 3);
  assert.deepEqual(gladys.lastStatus(), { connected: true, message: undefined });
  assert.equal(gladys.discoveredDevices.length, 6);
});
