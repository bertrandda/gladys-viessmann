import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
  WATER_HEATER_MODE,
  circuitModeFromGladys,
  circuitModeToGladys,
  dhwModeFromGladys,
  dhwModeToGladys,
  operatingState,
} from '../src/modes.js';

test('circuit modes map to the Gladys thermostat modes', () => {
  assert.equal(circuitModeToGladys('standby'), THERMOSTAT_MODE.OFF);
  assert.equal(circuitModeToGladys('dhw'), THERMOSTAT_MODE.OFF);
  assert.equal(circuitModeToGladys('dhwAndHeating'), THERMOSTAT_MODE.HEATING);
  assert.equal(circuitModeToGladys('heating'), THERMOSTAT_MODE.HEATING);
  assert.equal(circuitModeToGladys('cooling'), THERMOSTAT_MODE.COOLING);
  assert.equal(circuitModeToGladys('heatingCooling'), THERMOSTAT_MODE.AUTO);
  assert.equal(circuitModeToGladys('ventilation'), undefined);
});

test('turning a circuit off keeps hot water when the appliance allows it', () => {
  assert.equal(
    circuitModeFromGladys(THERMOSTAT_MODE.OFF, ['standby', 'dhw', 'dhwAndHeating']),
    'dhw',
  );
  assert.equal(circuitModeFromGladys(THERMOSTAT_MODE.OFF, ['heating', 'standby']), 'standby');
});

test('a Gladys mode picks the first ViCare mode the appliance accepts', () => {
  const combi = ['standby', 'dhw', 'dhwAndHeating'];
  assert.equal(circuitModeFromGladys(THERMOSTAT_MODE.HEATING, combi), 'dhwAndHeating');
  assert.equal(circuitModeFromGladys(THERMOSTAT_MODE.HEATING, ['heating', 'standby']), 'heating');
  assert.equal(circuitModeFromGladys(THERMOSTAT_MODE.COOLING, combi), undefined);
  assert.equal(circuitModeFromGladys(42, combi), undefined);
});

test('every Gladys circuit mode written back reads as itself', () => {
  const all = ['standby', 'dhw', 'heating', 'dhwAndHeating', 'cooling', 'heatingCooling'];
  for (const mode of Object.values(THERMOSTAT_MODE)) {
    assert.equal(circuitModeToGladys(circuitModeFromGladys(mode, all)), mode);
  }
});

test('hot water modes map to the Gladys water heater modes', () => {
  assert.equal(dhwModeToGladys('off'), WATER_HEATER_MODE.OFF);
  assert.equal(dhwModeToGladys('efficient'), WATER_HEATER_MODE.ECO);
  assert.equal(dhwModeToGladys('efficientWithMinComfort'), WATER_HEATER_MODE.ECO);
  assert.equal(dhwModeToGladys('balanced'), WATER_HEATER_MODE.AUTO);
  assert.equal(dhwModeToGladys('comfort'), WATER_HEATER_MODE.MANUAL);
  assert.equal(dhwModeToGladys('unknown'), undefined);
});

test('hot water modes never use BOOST, which belongs to the one-time charge', () => {
  const all = ['off', 'eco', 'efficient', 'efficientWithMinComfort', 'balanced', 'comfort'];
  for (const mode of all) {
    assert.notEqual(dhwModeToGladys(mode), WATER_HEATER_MODE.BOOST);
  }
  assert.equal(dhwModeFromGladys(WATER_HEATER_MODE.BOOST, all), undefined);
});

test('a Gladys hot water mode picks a ViCare mode the appliance accepts', () => {
  const supported = ['efficientWithMinComfort', 'efficient', 'off'];
  assert.equal(dhwModeFromGladys(WATER_HEATER_MODE.ECO, supported), 'efficient');
  assert.equal(dhwModeFromGladys(WATER_HEATER_MODE.OFF, supported), 'off');
  assert.equal(dhwModeFromGladys(WATER_HEATER_MODE.MANUAL, supported), undefined);
});

test('operating state: cooling wins over heating, which wins over idle', () => {
  const { IDLE, HEATING, COOLING } = THERMOSTAT_OPERATING_STATE;
  assert.equal(operatingState({ burners: [false], compressors: [] }), IDLE);
  assert.equal(operatingState({ burners: [true], compressors: [] }), HEATING);
  assert.equal(
    operatingState({ burners: [], compressors: [{ active: true, phase: 'heating' }] }),
    HEATING,
  );
  // A running compressor without a known phase heats.
  assert.equal(operatingState({ burners: [], compressors: [{ active: true }] }), HEATING);
  assert.equal(
    operatingState({ burners: [true], compressors: [{ active: true, phase: 'cooling' }] }),
    COOLING,
  );
  // A stopped compressor reporting "cooling" does not cool.
  assert.equal(
    operatingState({ burners: [], compressors: [{ active: false, phase: 'cooling' }] }),
    IDLE,
  );
});
