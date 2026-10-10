// Commands: what a Gladys action sends to ViCare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHandlers } from '../src/app.js';
import { THERMOSTAT_MODE, WATER_HEATER_MODE } from '../src/modes.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  BOILER_GATEWAY,
  HEATPUMP_GATEWAY,
  createFakeViCare,
  linkedConfig,
} from './helpers/fakeViCare.js';

async function setup(t) {
  const vicare = createFakeViCare();
  const gladys = createFakeGladys({ config: linkedConfig() });
  const app = registerHandlers(gladys, { fetch: vicare.fetch });
  t.after(() => app.stop());
  await gladys.connect();
  const setValue = (type, platformId, key, value) => {
    const ids = gladys.externalIds(type, platformId);
    return gladys.handlers.setValue(
      { external_id: ids.device },
      { external_id: ids.feature(key) },
      value,
    );
  };
  return { vicare, gladys, setValue };
}

test('the setpoint is written to the active program, rounded to its stepping', async (t) => {
  const { vicare, gladys, setValue } = await setup(t);
  await setValue('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`, 'target-temperature', 21.4);
  assert.deepEqual(vicare.commands(), [
    {
      feature: 'heating.circuits.0.operating.programs.normalHeating',
      command: 'setTemperature',
      deviceId: '0',
      params: { targetTemperature: 21 },
    },
  ]);
  const feature = gladys
    .externalIds('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`)
    .feature('target-temperature');
  assert.equal(gladys.lastState(feature), 21);
});

test('the setpoint is clamped to the program limits', async (t) => {
  const { vicare, setValue } = await setup(t);
  await setValue('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`, 'target-temperature', 45);
  assert.equal(vicare.commands()[0].params.targetTemperature, 37);
});

test('a program without adjustable temperature refuses the setpoint', async (t) => {
  const { vicare, setValue } = await setup(t);
  // The boiler circuit runs "standby".
  await assert.rejects(
    setValue('heating-circuit', `${BOILER_GATEWAY}-0-0`, 'target-temperature', 20),
    /active program "standby" has no adjustable temperature/,
  );
  assert.deepEqual(vicare.commands(), []);
});

test('the thermostat mode picks a ViCare mode the circuit accepts', async (t) => {
  const { vicare, setValue } = await setup(t);
  await setValue('heating-circuit', `${BOILER_GATEWAY}-0-0`, 'mode', THERMOSTAT_MODE.HEATING);
  await setValue('heating-circuit', `${BOILER_GATEWAY}-0-0`, 'mode', THERMOSTAT_MODE.OFF);
  await setValue('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`, 'mode', THERMOSTAT_MODE.OFF);
  assert.deepEqual(
    vicare.commands().map((c) => c.params.mode),
    // Boiler: keeps hot water when off. Heat pump: no "dhw" mode, so standby.
    ['dhwAndHeating', 'dhw', 'standby'],
  );
});

test('an unsupported thermostat mode is refused without calling ViCare', async (t) => {
  const { vicare, setValue } = await setup(t);
  await assert.rejects(
    setValue('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`, 'mode', THERMOSTAT_MODE.COOLING),
    /not supported by this circuit \(ViCare modes: heating, standby\)/,
  );
  assert.deepEqual(vicare.commands(), []);
});

test('hot water setpoint, mode and one-time charge', async (t) => {
  const { vicare, setValue } = await setup(t);
  await setValue('dhw', `${HEATPUMP_GATEWAY}-0`, 'target-temperature', 48);
  await setValue('dhw', `${HEATPUMP_GATEWAY}-0`, 'mode', WATER_HEATER_MODE.OFF);
  await setValue('dhw', `${HEATPUMP_GATEWAY}-0`, 'boost', 1);
  await setValue('dhw', `${HEATPUMP_GATEWAY}-0`, 'boost', 0);
  assert.deepEqual(
    vicare.commands().map(({ feature, command, params }) => [feature, command, params]),
    [
      ['heating.dhw.temperature.main', 'setTargetTemperature', { temperature: 48 }],
      ['heating.dhw.operating.modes.active', 'setMode', { mode: 'off' }],
      ['heating.dhw.oneTimeCharge', 'activate', {}],
      ['heating.dhw.oneTimeCharge', 'deactivate', {}],
    ],
  );
});

test('an unsupported hot water mode is refused', async (t) => {
  const { setValue } = await setup(t);
  await assert.rejects(
    setValue('dhw', `${HEATPUMP_GATEWAY}-0`, 'mode', WATER_HEATER_MODE.AWAY),
    /not supported by this appliance/,
  );
});

test('read-only features have no command', async (t) => {
  const { setValue } = await setup(t);
  await assert.rejects(
    setValue('heat-generator', `${HEATPUMP_GATEWAY}-0`, 'outside-temperature', 3),
    /No command/,
  );
});

test('a command for an unknown device triggers a discovery, then fails cleanly', async (t) => {
  const { vicare, setValue } = await setup(t);
  const before = vicare.apiRequests().length;
  await assert.rejects(setValue('dhw', 'unknown-0', 'boost', 1), /No command/);
  assert.equal(vicare.apiRequests().length, before + 3);
});

test('a refused command is reported to Gladys and nothing is published', async (t) => {
  const vicare = createFakeViCare({
    override: ({ method }) =>
      method === 'POST'
        ? { status: 400, body: { statusCode: 400, message: 'Invalid value' } }
        : undefined,
  });
  const gladys = createFakeGladys({ config: linkedConfig() });
  const app = registerHandlers(gladys, { fetch: vicare.fetch });
  t.after(() => app.stop());
  await gladys.connect();
  const ids = gladys.externalIds('dhw', `${HEATPUMP_GATEWAY}-0`);
  const published = gladys.states.length;
  await assert.rejects(
    gladys.handlers.setValue(
      { external_id: ids.device },
      { external_id: ids.feature('target-temperature') },
      50,
    ),
    /Invalid value/,
  );
  assert.equal(gladys.states.length, published);
});
