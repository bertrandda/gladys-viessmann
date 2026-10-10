// -----------------------------------------------------------------------------
// Device type: DOMESTIC HOT WATER -> a Gladys water heater.
//
// The hot water setpoint, its operating mode (E3 appliances and heat pumps),
// the one-time charge (heat the tank now, once) and the tank temperature.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { WATER_HEATER_MODE, dhwModeFromGladys, dhwModeToGladys } from '../modes.js';
import { constrain, constraints } from '../vicare/features.js';
import { binary, buildUnit } from './unit.js';

const DEVICE_TYPE = 'dhw';

const TARGET_FEATURE = 'heating.dhw.temperature.main';
const MODE_FEATURE = 'heating.dhw.operating.modes.active';
const ONE_TIME_CHARGE_FEATURE = 'heating.dhw.oneTimeCharge';
// Newer models name the tank sensor dhwCylinder, older ones hotWaterStorage.
const TANK_FEATURES = [
  'heating.dhw.sensors.temperature.dhwCylinder',
  'heating.dhw.sensors.temperature.hotWaterStorage',
];

const DEFAULT_SETPOINT = { min: 10, max: 60 };

function tankTemperature(features) {
  return TANK_FEATURES.map((name) => features.number(name)).find((value) => value !== undefined);
}

export const DHW_SPECS = [
  {
    key: 'target-temperature',
    describe(features) {
      if (features.number(TARGET_FEATURE) === undefined) {
        return null;
      }
      const command = features.command(TARGET_FEATURE, 'setTargetTemperature');
      const limits = constraints(command, 'temperature');
      return {
        name: 'Hot water target temperature',
        category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
        type: DEVICE_FEATURE_TYPES.WATER_HEATER.TARGET_TEMPERATURE,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: limits.min ?? DEFAULT_SETPOINT.min,
        max: limits.max ?? DEFAULT_SETPOINT.max,
        ...(limits.stepping > 0 ? { step: limits.stepping } : {}),
        read_only: !command,
        has_feedback: true,
      };
    },
    read: (features) => features.number(TARGET_FEATURE),
    async write(value, { features, run }) {
      const command = features.command(TARGET_FEATURE, 'setTargetTemperature');
      if (!command) {
        throw new Error('The hot water setpoint cannot be changed on this appliance');
      }
      const temperature = constrain(value, constraints(command, 'temperature'));
      await run(TARGET_FEATURE, 'setTargetTemperature', { temperature });
      return temperature;
    },
  },
  {
    key: 'mode',
    describe(features) {
      if (dhwModeToGladys(features.value(MODE_FEATURE)) === undefined) {
        return null;
      }
      return {
        name: 'Hot water mode',
        category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
        type: DEVICE_FEATURE_TYPES.WATER_HEATER.MODE,
        min: WATER_HEATER_MODE.OFF,
        max: WATER_HEATER_MODE.PROGRAM,
        read_only: !features.command(MODE_FEATURE, 'setMode'),
        has_feedback: true,
      };
    },
    read: (features) => dhwModeToGladys(features.value(MODE_FEATURE)),
    async write(value, { features, run }) {
      const supported = constraints(features.command(MODE_FEATURE, 'setMode'), 'mode').enum ?? [];
      const mode = dhwModeFromGladys(value, supported);
      if (!mode) {
        throw new Error(
          `Hot water mode ${value} is not supported by this appliance (ViCare modes: ${supported.join(', ') || 'none'})`,
        );
      }
      await run(MODE_FEATURE, 'setMode', { mode });
      return value;
    },
  },
  {
    key: 'boost',
    describe: (features) =>
      binary(features, ONE_TIME_CHARGE_FEATURE) === undefined
        ? null
        : {
            name: 'One-time charge',
            category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
            type: DEVICE_FEATURE_TYPES.WATER_HEATER.BOOST,
            min: 0,
            max: 1,
            read_only: !features.command(ONE_TIME_CHARGE_FEATURE, 'activate'),
            has_feedback: true,
          },
    read: (features) => binary(features, ONE_TIME_CHARGE_FEATURE),
    async write(value, { run }) {
      const on = Number(value) === 1;
      await run(ONE_TIME_CHARGE_FEATURE, on ? 'activate' : 'deactivate', {});
      return on ? 1 : 0;
    },
  },
  {
    key: 'heating',
    describe: (features) =>
      binary(features, 'heating.dhw.charging') === undefined
        ? null
        : {
            name: 'Hot water heating',
            category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
            type: DEVICE_FEATURE_TYPES.WATER_HEATER.HEATING,
            min: 0,
            max: 1,
          },
    read: (features) => binary(features, 'heating.dhw.charging'),
  },
  {
    key: 'storage-temperature',
    describe: (features) =>
      tankTemperature(features) === undefined
        ? null
        : {
            name: 'Hot water tank temperature',
            category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
            type: DEVICE_FEATURE_TYPES.TEMPERATURE_SENSOR.PROBE,
            unit: DEVICE_FEATURE_UNITS.CELSIUS,
            min: 0,
            max: 100,
          },
    read: tankTemperature,
  },
];

/**
 * The hot water of the appliance, or null when it has none.
 * @param {object} gladys
 * @param {{ features: import('../vicare/features.js').FeatureSet, target: object, model: string }} appliance
 */
export function buildDhw(gladys, { features, target, model }) {
  if (!features.get('heating.dhw') || features.value('heating.dhw', 'active') === false) {
    return null;
  }
  return buildUnit(gladys, {
    type: DEVICE_TYPE,
    platformId: `${target.gatewaySerial}-${target.deviceId}`,
    name: `${model} - Hot water`,
    target,
    features,
    specs: DHW_SPECS,
  });
}
