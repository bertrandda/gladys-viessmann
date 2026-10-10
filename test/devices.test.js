// Discovery: which Gladys devices and features the fixtures produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { DeviceRegistry, buildUnits } from '../src/devices/index.js';
import { circuitIndexes } from '../src/devices/heatingCircuit.js';
import { modelLabel } from '../src/devices/unit.js';
import { FeatureSet, constrain } from '../src/vicare/features.js';
import { THERMOSTAT_MODE, WATER_HEATER_MODE } from '../src/modes.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  BOILER_GATEWAY,
  HEATPUMP_GATEWAY,
  INSTALLATION_ID,
  fixture,
} from './helpers/fakeViCare.js';

const gladys = createFakeGladys();

function inventory() {
  const devices = (serial) =>
    fixture('installations')
      .data[0].gateways.find((g) => g.serial === serial)
      .devices.filter((d) => d.deviceType === 'heating')
      .map((d) => ({ id: d.id, modelId: d.modelId }));
  return {
    installationCount: 1,
    gateways: [
      {
        installationId: INSTALLATION_ID,
        serial: BOILER_GATEWAY,
        devices: devices(BOILER_GATEWAY),
        features: fixture('gateway-boiler').data,
      },
      {
        installationId: INSTALLATION_ID,
        serial: HEATPUMP_GATEWAY,
        devices: devices(HEATPUMP_GATEWAY),
        features: fixture('gateway-heatpump').data,
      },
    ],
  };
}

function registry() {
  const r = new DeviceRegistry(gladys);
  r.update(inventory());
  return r;
}

const deviceId = (type, platformId) => gladys.externalIds(type, platformId).device;
const featureKeys = (device) => device.features.map((f) => f.external_id.split(':').pop());

test('each appliance gives a thermostat per circuit, a water heater and a generator', () => {
  const ids = buildUnits(gladys, inventory()).map((unit) => unit.externalId);
  assert.deepEqual(ids, [
    deviceId('heating-circuit', `${BOILER_GATEWAY}-0-0`),
    deviceId('dhw', `${BOILER_GATEWAY}-0`),
    deviceId('heat-generator', `${BOILER_GATEWAY}-0`),
    deviceId('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`),
    deviceId('dhw', `${HEATPUMP_GATEWAY}-0`),
    deviceId('heat-generator', `${HEATPUMP_GATEWAY}-0`),
  ]);
});

test('device payloads pass the Gladys validation', async () => {
  // The fake applies the host API checks (category, type, unit, min/max...).
  await gladys.publishDiscoveredDevices(registry().definitions());
});

test('external ids are unique and do not depend on the order of the API answer', () => {
  const ids = registry()
    .definitions()
    .flatMap((d) => [d.external_id, ...d.features.map((f) => f.external_id)]);
  assert.equal(new Set(ids).size, ids.length);

  const reversed = inventory();
  reversed.gateways.reverse();
  for (const gateway of reversed.gateways) {
    gateway.features = [...gateway.features].reverse();
  }
  const r = new DeviceRegistry(gladys);
  r.update(reversed);
  const reversedIds = r
    .definitions()
    .flatMap((d) => [d.external_id, ...d.features.map((f) => f.external_id)]);
  assert.deepEqual(new Set(reversedIds), new Set(ids));
});

test('the heat pump circuit is a thermostat with setpoint, mode and operating state', () => {
  const circuit = registry()
    .definitions()
    .find((d) => d.external_id === deviceId('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`));
  assert.equal(circuit.name, 'Vitocal 250A - Heating circuit 1');
  assert.deepEqual(featureKeys(circuit), [
    'target-temperature',
    'mode',
    'operating-state',
    'supply-temperature',
  ]);
  const [target, mode] = circuit.features;
  assert.equal(target.category, DEVICE_FEATURE_CATEGORIES.THERMOSTAT);
  assert.equal(target.type, DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE);
  assert.deepEqual([target.min, target.max, target.step, target.read_only], [3, 37, 1, false]);
  assert.equal(mode.type, DEVICE_FEATURE_TYPES.THERMOSTAT.MODE);
  assert.equal(mode.read_only, false);
  // The supply temperature is a probe: kept out of the room average.
  assert.equal(circuit.features[3].type, DEVICE_FEATURE_TYPES.TEMPERATURE_SENSOR.PROBE);
});

test('the hot water of the heat pump exposes its mode, the boiler one does not', () => {
  const definitions = registry().definitions();
  const heatPumpDhw = definitions.find(
    (d) => d.external_id === deviceId('dhw', `${HEATPUMP_GATEWAY}-0`),
  );
  const boilerDhw = definitions.find(
    (d) => d.external_id === deviceId('dhw', `${BOILER_GATEWAY}-0`),
  );
  assert.deepEqual(featureKeys(heatPumpDhw), [
    'target-temperature',
    'mode',
    'boost',
    'storage-temperature',
  ]);
  assert.deepEqual(featureKeys(boilerDhw), ['target-temperature', 'boost', 'storage-temperature']);
  assert.ok(heatPumpDhw.features.every((f) => f.category !== DEVICE_FEATURE_CATEGORIES.THERMOSTAT));
});

test('the boiler generator reports gas in m³ and its burner, the heat pump its compressor', () => {
  const definitions = registry().definitions();
  const boiler = definitions.find(
    (d) => d.external_id === deviceId('heat-generator', `${BOILER_GATEWAY}-0`),
  );
  const heatPump = definitions.find(
    (d) => d.external_id === deviceId('heat-generator', `${HEATPUMP_GATEWAY}-0`),
  );
  assert.ok(featureKeys(boiler).includes('burner-0-active'));
  assert.ok(!featureKeys(boiler).some((key) => key.startsWith('compressor')));
  const gas = boiler.features.find((f) => f.external_id.endsWith(':gas-dhw-today'));
  assert.equal(gas.category, DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR);
  assert.equal(gas.unit, 'cubicmeter');
  assert.deepEqual(
    featureKeys(heatPump).filter((key) => key.startsWith('compressor')),
    ['compressor-0-active', 'compressor-0-starts', 'compressor-0-hours'],
  );
  assert.ok(!featureKeys(heatPump).some((key) => key.startsWith('gas-')));
});

test('features of another device behind the same gateway never leak in', () => {
  // The fixture holds an outside temperature of -40 °C for RoomControl-1.
  const r = registry();
  const outside = gladys
    .externalIds('heat-generator', `${HEATPUMP_GATEWAY}-0`)
    .feature('outside-temperature');
  const state = r.states(HEATPUMP_GATEWAY).find((s) => s.device_feature_external_id === outside);
  assert.equal(state.state, 12.2);
});

test('states are read from the current features, unknown values are left out', () => {
  const r = registry();
  const states = new Map(r.states().map((s) => [s.device_feature_external_id, s.state]));
  const circuit = gladys.externalIds('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`);
  const dhw = gladys.externalIds('dhw', `${HEATPUMP_GATEWAY}-0`);
  const boilerCircuit = gladys.externalIds('heating-circuit', `${BOILER_GATEWAY}-0-0`);
  const generator = gladys.externalIds('heat-generator', `${HEATPUMP_GATEWAY}-0`);

  assert.equal(states.get(circuit.feature('target-temperature')), 20); // normalHeating
  assert.equal(states.get(circuit.feature('mode')), THERMOSTAT_MODE.HEATING);
  assert.equal(states.get(dhw.feature('mode')), WATER_HEATER_MODE.ECO); // efficient
  assert.equal(states.get(dhw.feature('target-temperature')), 55);
  // Float noise from the API is rounded.
  assert.equal(states.get(generator.feature('power-total-today')), 7.2);
  // The boiler circuit runs the "standby" program, which has no temperature:
  // nothing is published rather than a fake value.
  assert.equal(states.get(boilerCircuit.feature('mode')), THERMOSTAT_MODE.OFF); // dhw
  assert.equal(states.has(boilerCircuit.feature('target-temperature')), false);
});

test('fresh gateway features replace the previous ones', () => {
  const r = registry();
  const features = fixture('gateway-heatpump').data;
  features.find(
    (f) => f.feature === 'heating.compressors.0' && f.deviceId === '0',
  ).properties.active.value = true;
  r.setGatewayFeatures(HEATPUMP_GATEWAY, features);
  const running = gladys
    .externalIds('heat-generator', `${HEATPUMP_GATEWAY}-0`)
    .feature('compressor-0-active');
  const state = gladys
    .externalIds('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`)
    .feature('operating-state');
  const states = new Map(
    r.states(HEATPUMP_GATEWAY).map((s) => [s.device_feature_external_id, s.state]),
  );
  assert.equal(states.get(running), 1);
  assert.equal(states.get(state), 1); // heating
});

test('an unreachable gateway gives no device', () => {
  const inv = inventory();
  inv.gateways[0].features = null;
  const units = buildUnits(gladys, inv);
  assert.ok(units.every((unit) => unit.target.gatewaySerial === HEATPUMP_GATEWAY));
});

test('circuits come from the enabled list, or from the circuit features', () => {
  const withList = new FeatureSet([
    { feature: 'heating.circuits', properties: { enabled: { value: ['0', '2'] } } },
  ]);
  assert.deepEqual(circuitIndexes(withList), ['0', '2']);
  const withoutList = new FeatureSet([
    { feature: 'heating.circuits.1', properties: { active: { value: true } } },
    { feature: 'heating.circuits.0', properties: { active: { value: true } } },
    { feature: 'heating.circuits.0.sensors.temperature.supply', properties: {} },
  ]);
  assert.deepEqual(circuitIndexes(withoutList), ['0', '1']);
});

test('disabled features and empty placeholders count as absent', () => {
  const features = new FeatureSet([
    { feature: 'a', isEnabled: false, properties: { value: { value: 1 } } },
    { feature: 'b', properties: {} },
    { feature: 'c', properties: { value: { value: 'text' } } },
  ]);
  assert.equal(features.get('a'), undefined);
  assert.equal(features.number('b'), undefined);
  assert.equal(features.number('c'), undefined);
});

test('constrain rounds to the stepping and clamps to the limits', () => {
  assert.equal(constrain(21.4, { min: 3, max: 37, stepping: 1 }), 21);
  assert.equal(constrain(21.6, { min: 3, max: 37, stepping: 1 }), 22);
  assert.equal(constrain(20.3, { min: 3, max: 37, stepping: 0.5 }), 20.5);
  assert.equal(constrain(80, { min: 10, max: 60 }), 60);
  assert.equal(constrain(1, { min: 3 }), 3);
  assert.equal(constrain(22.25, {}), 22.25);
});

test('model ids become readable names', () => {
  assert.equal(modelLabel('E3_Vitocal_250A'), 'Vitocal 250A');
  assert.equal(modelLabel('E3_Vitodens_300_W'), 'Vitodens 300 W');
  assert.equal(modelLabel(''), 'Viessmann');
});
