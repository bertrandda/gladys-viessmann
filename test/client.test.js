import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViCareClient } from '../src/vicare/client.js';
import {
  ViCareAuthError,
  ViCareDeviceCommunicationError,
  ViCareError,
  ViCareRateLimitError,
} from '../src/vicare/errors.js';
import {
  BOILER_GATEWAY,
  INSTALLATION_ID,
  createFakeViCare,
  fixture,
} from './helpers/fakeViCare.js';

function createClient(vicare, tokens = {}, extra = {}) {
  const saved = [];
  const client = new ViCareClient({
    clientId: 'client-123',
    tokens: {
      access_token: 'stored-access',
      refresh_token: 'stored-refresh',
      token_expires_at: Date.now() + 3600 * 1000,
      ...tokens,
    },
    saveTokens: async (t) => saved.push(t),
    fetch: vicare.fetch,
    ...extra,
  });
  return { client, saved };
}

test('requests carry the stored access token while it is valid', async () => {
  const vicare = createFakeViCare();
  const { client, saved } = createClient(vicare);
  const installations = await client.getInstallations();
  assert.equal(installations.length, 1);
  assert.equal(vicare.requests.length, 1);
  assert.equal(vicare.requests[0].headers.Authorization, 'Bearer stored-access');
  assert.equal(vicare.requests[0].url.searchParams.get('includeGateways'), 'true');
  assert.deepEqual(saved, []);
});

test('an access token about to expire is refreshed first, and the new tokens are saved', async () => {
  const vicare = createFakeViCare();
  const { client, saved } = createClient(vicare, { token_expires_at: Date.now() + 10_000 });
  await client.getInstallations();
  assert.equal(vicare.requests[0].url.pathname, '/idp/v3/token');
  assert.equal(vicare.requests[1].headers.Authorization, 'Bearer access-1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].access_token, 'access-1');
  assert.equal(saved[0].refresh_token, 'refresh-1');
});

test('concurrent requests share a single token refresh', async () => {
  const vicare = createFakeViCare();
  const { client } = createClient(vicare, { token_expires_at: 0 });
  await Promise.all([client.getInstallations(), client.getInstallations()]);
  const refreshes = vicare.requests.filter((r) => r.url.pathname === '/idp/v3/token');
  assert.equal(refreshes.length, 1);
});

test('an "EXPIRED TOKEN" answer triggers one refresh and one retry', async () => {
  let refused = false;
  const vicare = createFakeViCare({
    override: ({ url }) => {
      if (url.pathname.startsWith('/iot/') && !refused) {
        refused = true;
        return { status: 401, body: { error: 'EXPIRED TOKEN' } };
      }
      return undefined;
    },
  });
  const { client } = createClient(vicare);
  const installations = await client.getInstallations();
  assert.equal(installations.length, 1);
  assert.deepEqual(
    vicare.requests.map((r) => r.url.pathname),
    ['/iot/v2/equipment/installations', '/idp/v3/token', '/iot/v2/equipment/installations'],
  );
});

test('a token refused twice is an authorization error', async () => {
  const vicare = createFakeViCare({
    override: ({ url }) =>
      url.pathname.startsWith('/iot/')
        ? { status: 401, body: { error: 'EXPIRED TOKEN' } }
        : undefined,
  });
  const { client } = createClient(vicare);
  await assert.rejects(client.getInstallations(), ViCareAuthError);
});

test('without any token, requests fail with an authorization error and no call', async () => {
  const vicare = createFakeViCare();
  const { client } = createClient(vicare, { access_token: undefined, refresh_token: undefined });
  assert.equal(client.linked, false);
  await assert.rejects(client.getInstallations(), ViCareAuthError);
  assert.equal(vicare.requests.length, 0);
});

test('a 429 answer becomes a rate limit error carrying the reset date', async () => {
  const body = fixture('../fixtures/errors/rate-limit');
  const vicare = createFakeViCare({ override: () => ({ status: 429, body }) });
  const { client } = createClient(vicare);
  await assert.rejects(client.getInstallations(), (err) => {
    assert.ok(err instanceof ViCareRateLimitError);
    assert.equal(err.resetAt, 1584462010106);
    return true;
  });
});

test('an offline gateway becomes a device communication error', async () => {
  const body = fixture('../fixtures/errors/gateway-offline');
  const vicare = createFakeViCare({ override: () => ({ status: 400, body }) });
  const { client } = createClient(vicare);
  await assert.rejects(
    client.getGatewayFeatures(INSTALLATION_ID, BOILER_GATEWAY),
    ViCareDeviceCommunicationError,
  );
});

test('other API errors carry the API message', async () => {
  const vicare = createFakeViCare({
    override: () => ({ status: 500, body: { statusCode: 500, message: 'Internal server error' } }),
  });
  const { client } = createClient(vicare);
  await assert.rejects(client.getInstallations(), (err) => {
    assert.ok(err instanceof ViCareError);
    assert.match(err.message, /Internal server error/);
    assert.equal(err.status, 500);
    return true;
  });
});

test('a network failure is a plain ViCare error', async () => {
  const { client } = createClient({
    fetch: async () => {
      throw new Error('ECONNRESET');
    },
  });
  await assert.rejects(client.getInstallations(), /ViCare API unreachable: ECONNRESET/);
});

test('the gateway features come from the bulk endpoint, in one call', async () => {
  const vicare = createFakeViCare();
  const { client } = createClient(vicare);
  const features = await client.getGatewayFeatures(INSTALLATION_ID, BOILER_GATEWAY);
  assert.ok(features.length > 10);
  const [request] = vicare.requests;
  assert.equal(
    request.url.pathname,
    `/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${BOILER_GATEWAY}/features`,
  );
  assert.equal(request.url.searchParams.get('includeDevicesFeatures'), 'true');
});

test('commands are posted as JSON to the feature command URL', async () => {
  const vicare = createFakeViCare();
  const { client } = createClient(vicare);
  await client.executeCommand({
    installationId: INSTALLATION_ID,
    gatewaySerial: BOILER_GATEWAY,
    deviceId: '0',
    feature: 'heating.dhw.temperature.main',
    command: 'setTargetTemperature',
    params: { temperature: 50 },
  });
  assert.deepEqual(vicare.commands(), [
    {
      feature: 'heating.dhw.temperature.main',
      command: 'setTargetTemperature',
      deviceId: '0',
      params: { temperature: 50 },
    },
  ]);
});

test('a command refused in the answer body is an error', async () => {
  const vicare = createFakeViCare({
    override: ({ method }) =>
      method === 'POST' ? { body: { data: { success: false, reason: 'DEVICE_BUSY' } } } : undefined,
  });
  const { client } = createClient(vicare);
  await assert.rejects(
    client.executeCommand({
      installationId: 1,
      gatewaySerial: 'g',
      deviceId: '0',
      feature: 'heating.dhw.oneTimeCharge',
      command: 'activate',
    }),
    /DEVICE_BUSY/,
  );
});
