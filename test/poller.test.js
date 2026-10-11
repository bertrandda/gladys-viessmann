import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Poller } from '../src/poller.js';
import { DeviceRegistry } from '../src/devices/index.js';
import { discoverInventory } from '../src/inventory.js';
import { ViCareClient } from '../src/vicare/client.js';
import { ViCareAuthError, ViCareRateLimitError } from '../src/vicare/errors.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  BOILER_GATEWAY,
  HEATPUMP_GATEWAY,
  createFakeViCare,
  fixture,
  linkedConfig,
} from './helpers/fakeViCare.js';

// Let the async work started by a timer run to completion.
async function flush() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function setup(t, { override, intervalSeconds = 120 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1_000_000;
  // The override only applies once the setup's own discovery is done.
  let armed = false;
  const vicare = createFakeViCare({
    override: (request) => (armed ? override?.(request) : undefined),
  });
  const gladys = createFakeGladys();
  const config = linkedConfig();
  const client = new ViCareClient({
    clientId: config.client_id,
    tokens: { ...config, token_expires_at: Number.MAX_SAFE_INTEGER },
    fetch: vicare.fetch,
  });
  const registry = new DeviceRegistry(gladys);
  registry.update(await discoverInventory(client));
  const results = [];
  const poller = new Poller({
    gladys,
    client,
    registry,
    intervalSeconds,
    now: () => now,
    onResult: (err) => results.push(err),
  });
  t.after(() => poller.stop());
  vicare.requests.length = 0;
  armed = true;
  return {
    vicare,
    gladys,
    poller,
    registry,
    results,
    advance: async (ms) => {
      now += ms;
      t.mock.timers.tick(ms);
      await flush();
    },
  };
}

const featureCalls = (vicare) =>
  vicare.requests.filter((r) => r.url.pathname.endsWith('/features'));

test('start publishes the known states without calling ViCare', async (t) => {
  const { vicare, gladys, poller, registry } = await setup(t);
  await poller.start();
  assert.equal(gladys.states.length, registry.states().length);
  assert.equal(vicare.requests.length, 0);
});

test('the interval is multiplied by the number of gateways', async (t) => {
  const { vicare, poller } = await setup(t, { intervalSeconds: 120 });
  await poller.start();
  assert.equal(poller.intervalMs(), 240_000);
  // Nothing at 120 s, both gateways at 240 s.
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(featureCalls(vicare).length, 0);
  t.mock.timers.tick(120_000);
  await flush();
  assert.deepEqual(
    featureCalls(vicare).map((r) => r.url.pathname.split('/')[7]),
    [BOILER_GATEWAY, HEATPUMP_GATEWAY],
  );
});

test('only the states that changed are published, plus a 30-minute heartbeat', async (t) => {
  const { vicare, gladys, poller, advance, results } = await setup(t, { intervalSeconds: 300 });
  await poller.start();
  const initial = gladys.states.length;

  // 10 min (2 gateways x 300 s): one value changed, one state sent.
  vicare.setProperty(HEATPUMP_GATEWAY, '0', 'heating.dhw.temperature.main', 'value', 50);
  await advance(600_000);
  assert.deepEqual(results, [null]);
  const dhwTarget = gladys
    .externalIds('dhw', `${HEATPUMP_GATEWAY}-0`)
    .feature('target-temperature');
  assert.deepEqual(gladys.states.slice(initial), [
    { device_feature_external_id: dhwTarget, state: 50 },
  ]);

  // 20 min: nothing changed, nothing sent.
  await advance(600_000);
  assert.equal(gladys.states.length, initial + 1);

  // 30 min: the values sent at start are re-sent, the one sent at 10 min is not.
  await advance(600_000);
  const heartbeat = gladys.states.slice(initial + 1);
  assert.equal(heartbeat.length, initial - 1);
  assert.ok(heartbeat.every((s) => s.device_feature_external_id !== dhwTarget));
});

test('the quota error pauses the refreshes until the quota renews', async (t) => {
  let limited = true;
  const resetIn = 3 * 3600 * 1000;
  const body = { ...fixture('errors/rate-limit') };
  const { vicare, poller, advance, results } = await setup(t, {
    override: ({ url }) =>
      limited && url.pathname.endsWith('/features') ? { status: 429, body } : undefined,
  });
  body.extendedPayload = { ...body.extendedPayload, limitReset: 1_000_000 + 240_000 + resetIn };
  await poller.start();
  await advance(240_000);
  assert.ok(results[0] instanceof ViCareRateLimitError);
  const calls = featureCalls(vicare).length;

  limited = false;
  await advance(resetIn - 1000);
  assert.equal(featureCalls(vicare).length, calls, 'no call before the reset');
  await advance(61_000 + 1000);
  assert.equal(featureCalls(vicare).length, calls + 2);
  assert.equal(results.at(-1), null);
});

test('an authorization error stops the refreshes', async (t) => {
  const { vicare, poller, advance, results } = await setup(t, {
    override: ({ url }) => {
      if (url.pathname.endsWith('/token')) {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      return url.pathname.endsWith('/features')
        ? { status: 401, body: { error: 'EXPIRED TOKEN' } }
        : undefined;
    },
  });
  await poller.start();
  await advance(240_000);
  assert.ok(results[0] instanceof ViCareAuthError);
  assert.equal(poller.running, false);
  const calls = vicare.requests.length;
  await advance(10 * 240_000);
  assert.equal(vicare.requests.length, calls);
});

test('an offline gateway does not stop the other one', async (t) => {
  const offline = fixture('errors/gateway-offline');
  const { vicare, poller, advance, results } = await setup(t, {
    override: ({ url }) =>
      url.pathname.includes(`/gateways/${BOILER_GATEWAY}/`)
        ? { status: 400, body: offline }
        : undefined,
  });
  await poller.start();
  await advance(240_000);
  assert.deepEqual(results, [null]);
  assert.equal(featureCalls(vicare).length, 2);
});

test('refreshSoon merges the requests into one call per gateway, 15 s later', async (t) => {
  const { vicare, poller, advance } = await setup(t, { intervalSeconds: 3600 });
  await poller.start();
  poller.refreshSoon(HEATPUMP_GATEWAY);
  poller.refreshSoon(HEATPUMP_GATEWAY);
  await advance(14_000);
  assert.equal(featureCalls(vicare).length, 0);
  await advance(1_000);
  assert.equal(featureCalls(vicare).length, 1);
  assert.ok(featureCalls(vicare)[0].url.pathname.includes(HEATPUMP_GATEWAY));
});

test('states refused by Gladys are sent again next time', async (t) => {
  const { gladys, poller, registry } = await setup(t);
  const original = gladys.publishStates;
  gladys.publishStates = async () => {
    throw new Error('429 TOO_MANY_REQUESTS');
  };
  await poller.start();
  gladys.publishStates = original;
  await poller.publish(registry.states());
  assert.equal(gladys.states.length, registry.states().length);
});

test('forget re-sends the states of one device', async (t) => {
  const { gladys, poller, registry } = await setup(t);
  await poller.start();
  const sent = gladys.states.length;
  const dhw = gladys.externalIds('dhw', `${HEATPUMP_GATEWAY}-0`).device;
  poller.forget(dhw);
  await poller.publish(registry.states());
  const resent = gladys.states.slice(sent);
  assert.ok(resent.length > 0);
  assert.ok(resent.every((s) => s.device_feature_external_id.startsWith(`${dhw}:`)));
});
