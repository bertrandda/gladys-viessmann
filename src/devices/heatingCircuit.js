// -----------------------------------------------------------------------------
// Device type: HEATING CIRCUIT -> a Gladys thermostat.
//
// One Gladys device per circuit (`heating.circuits.N`), so each circuit can be
// placed in its own room. The setpoint is the temperature of the program the
// circuit currently runs (normal, reduced, comfort...): changing it changes
// that program, like the ViCare app and Home Assistant do.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
  circuitModeFromGladys,
  circuitModeToGladys,
  operatingState,
} from '../modes.js';
import { constrain, constraints } from '../vicare/features.js';
import { heatSourceIndexes, heatSources } from './heatSources.js';
import { buildUnit } from './unit.js';

const DEVICE_TYPE = 'heating-circuit';

// Setpoint range when the appliance does not say (the usual ViCare bounds).
const DEFAULT_SETPOINT = { min: 3, max: 37 };

// Programs whose setTemperature command gives the setpoint range when the
// active program has none (standby, frost protection...).
const RANGE_PROGRAMS = ['normal', 'normalHeating', 'comfort', 'comfortHeating', 'reduced'];

const prefix = ({ circuit }) => `heating.circuits.${circuit}`;
const programFeature = (target, program) => `${prefix(target)}.operating.programs.${program}`;
const activeProgram = (features, target) =>
  features.value(`${prefix(target)}.operating.programs.active`);

function setpointCommand(features, target) {
  for (const program of [activeProgram(features, target), ...RANGE_PROGRAMS]) {
    const command = program && features.command(programFeature(target, program), 'setTemperature');
    if (command) {
      return command;
    }
  }
  return undefined;
}

const temperatureSensor = (key, name, sensor, type) => ({
  key,
  describe: (features, target) =>
    features.number(`${prefix(target)}.sensors.temperature.${sensor}`) === undefined
      ? null
      : {
          name,
          category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
          type,
          unit: DEVICE_FEATURE_UNITS.CELSIUS,
          min: -50,
          max: 120,
        },
  read: (features, target) => features.number(`${prefix(target)}.sensors.temperature.${sensor}`),
});

export const CIRCUIT_SPECS = [
  {
    key: 'target-temperature',
    describe(features, target) {
      const command = setpointCommand(features, target);
      if (!command) {
        return null;
      }
      const limits = constraints(command, 'targetTemperature');
      return {
        name: 'Target temperature',
        category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
        type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: limits.min ?? DEFAULT_SETPOINT.min,
        max: limits.max ?? DEFAULT_SETPOINT.max,
        ...(limits.stepping > 0 ? { step: limits.stepping } : {}),
        read_only: false,
        has_feedback: true,
      };
    },
    read(features, target) {
      const program = activeProgram(features, target);
      return program ? features.number(programFeature(target, program), 'temperature') : undefined;
    },
    async write(value, { features, target, run }) {
      const program = activeProgram(features, target);
      const feature = program && programFeature(target, program);
      const command = feature && features.command(feature, 'setTemperature');
      if (!command) {
        throw new Error(
          `The active program "${program ?? 'unknown'}" has no adjustable temperature`,
        );
      }
      const temperature = constrain(value, constraints(command, 'targetTemperature'));
      await run(feature, 'setTemperature', { targetTemperature: temperature });
      return temperature;
    },
  },
  {
    key: 'mode',
    describe(features, target) {
      const feature = `${prefix(target)}.operating.modes.active`;
      if (circuitModeToGladys(features.value(feature)) === undefined) {
        return null;
      }
      return {
        name: 'Mode',
        category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
        type: DEVICE_FEATURE_TYPES.THERMOSTAT.MODE,
        min: THERMOSTAT_MODE.OFF,
        max: THERMOSTAT_MODE.AUTO,
        read_only: !features.command(feature, 'setMode'),
        has_feedback: true,
      };
    },
    read: (features, target) =>
      circuitModeToGladys(features.value(`${prefix(target)}.operating.modes.active`)),
    async write(value, { features, target, run }) {
      const feature = `${prefix(target)}.operating.modes.active`;
      const supported = constraints(features.command(feature, 'setMode'), 'mode').enum ?? [];
      const mode = circuitModeFromGladys(value, supported);
      if (!mode) {
        throw new Error(
          `Mode ${value} is not supported by this circuit (ViCare modes: ${supported.join(', ') || 'none'})`,
        );
      }
      await run(feature, 'setMode', { mode });
      return value;
    },
  },
  {
    key: 'operating-state',
    describe: (features) =>
      heatSourceIndexes(features, 'burners').length +
        heatSourceIndexes(features, 'compressors').length ===
      0
        ? null
        : {
            name: 'Operating state',
            category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
            type: DEVICE_FEATURE_TYPES.THERMOSTAT.OPERATING_STATE,
            min: THERMOSTAT_OPERATING_STATE.IDLE,
            max: THERMOSTAT_OPERATING_STATE.COOLING,
          },
    read: (features) => operatingState(heatSources(features)),
  },
  // Measured in the room: counts in the room temperature.
  temperatureSensor(
    'room-temperature',
    'Room temperature',
    'room',
    DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
  ),
  // Water temperature in the pipes: a probe, kept out of the room average.
  temperatureSensor(
    'supply-temperature',
    'Supply temperature',
    'supply',
    DEVICE_FEATURE_TYPES.TEMPERATURE_SENSOR.PROBE,
  ),
];

/**
 * Indexes of the circuits of an appliance: the `enabled` list of
 * `heating.circuits`, or every `heating.circuits.N` when the list is missing.
 * @param {import('../vicare/features.js').FeatureSet} features
 */
export function circuitIndexes(features) {
  const enabled = features.value('heating.circuits', 'enabled');
  if (Array.isArray(enabled)) {
    return enabled.map(String);
  }
  return features
    .names(/^heating\.circuits\.\d+$/)
    .map((name) => name.split('.')[2])
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * One thermostat per circuit of the appliance.
 * @param {object} gladys
 * @param {{ features: import('../vicare/features.js').FeatureSet, target: object, model: string }} appliance
 */
export function buildHeatingCircuits(gladys, { features, target, model }) {
  return circuitIndexes(features).map((circuit) => {
    const circuitName =
      features.value(`heating.circuits.${circuit}`, 'name') ||
      `Heating circuit ${Number(circuit) + 1}`;
    return buildUnit(gladys, {
      type: DEVICE_TYPE,
      platformId: `${target.gatewaySerial}-${target.deviceId}-${circuit}`,
      name: `${model} - ${circuitName}`,
      target: { ...target, circuit },
      features,
      specs: CIRCUIT_SPECS,
    });
  });
}
