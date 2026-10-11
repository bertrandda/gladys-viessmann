// -----------------------------------------------------------------------------
// Read-only sensors of the heat generator (boiler or heat pump), as a table.
//
// To support a new ViCare sensor, add an entry: its stable key, its Gladys
// name/category/type/unit, and where to read it. An entry is only published
// when the appliance reports a value for it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { binary } from './unit.js';
import { heatSourceIndexes } from './heatSources.js';

// Probes measuring the water or the outside air: kept out of room averages.
const TEMPERATURES = [
  ['outside-temperature', 'Outside temperature', 'heating.sensors.temperature.outside'],
  [
    'boiler-supply-temperature',
    'Boiler supply temperature',
    'heating.boiler.sensors.temperature.commonSupply',
  ],
  ['boiler-temperature', 'Boiler temperature', 'heating.boiler.sensors.temperature.main'],
  ['return-temperature', 'Return temperature', 'heating.sensors.temperature.return'],
  [
    'primary-supply-temperature',
    'Primary circuit supply temperature',
    'heating.primaryCircuit.sensors.temperature.supply',
  ],
  [
    'primary-return-temperature',
    'Primary circuit return temperature',
    'heating.primaryCircuit.sensors.temperature.return',
  ],
  [
    'secondary-supply-temperature',
    'Secondary circuit supply temperature',
    'heating.secondaryCircuit.sensors.temperature.supply',
  ],
  [
    'secondary-return-temperature',
    'Secondary circuit return temperature',
    'heating.secondaryCircuit.sensors.temperature.return',
  ],
];

// Today's consumption: the `summary` features of recent models first, then
// the first entry of the `day` history of older ones.
const CONSUMPTIONS = [
  [
    'gas-heating-today',
    'Gas consumption heating today',
    'heating.gas.consumption.summary.heating',
    'heating.gas.consumption.heating',
  ],
  [
    'gas-dhw-today',
    'Gas consumption hot water today',
    'heating.gas.consumption.summary.dhw',
    'heating.gas.consumption.dhw',
  ],
  [
    'power-heating-today',
    'Power consumption heating today',
    'heating.power.consumption.summary.heating',
    'heating.power.consumption.heating',
  ],
  [
    'power-dhw-today',
    'Power consumption hot water today',
    'heating.power.consumption.summary.dhw',
    'heating.power.consumption.dhw',
  ],
  ['power-total-today', 'Power consumption today', null, 'heating.power.consumption.total'],
];

function temperature([key, name, feature]) {
  return {
    key,
    describe: (features) =>
      features.number(feature) === undefined
        ? null
        : {
            name,
            category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
            type: DEVICE_FEATURE_TYPES.TEMPERATURE_SENSOR.PROBE,
            unit: DEVICE_FEATURE_UNITS.CELSIUS,
            min: -50,
            max: 120,
          },
    read: (features) => features.number(feature),
  };
}

/**
 * Today's value of a consumption and its ViCare unit, undefined when absent.
 */
function todayConsumption(features, summaryFeature, historyFeature) {
  const summary = summaryFeature && features.number(summaryFeature, 'currentDay');
  if (typeof summary === 'number') {
    return { value: summary, unit: features.unit(summaryFeature, 'currentDay') };
  }
  const history = features.value(historyFeature, 'day');
  if (Array.isArray(history) && typeof history[0] === 'number') {
    return { value: history[0], unit: features.unit(historyFeature, 'day') };
  }
  return undefined;
}

// Gas is reported in m³ by older boilers and in kWh by recent ones. kWh goes
// to the energy category, m³ to the volume one: Gladys has no gas category.
const CONSUMPTION_UNITS = {
  kilowattHour: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.DAILY_CONSUMPTION,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  },
  cubicMeter: {
    category: DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR,
    type: DEVICE_FEATURE_TYPES.VOLUME_SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CUBIC_METER,
  },
};

function consumption([key, name, summaryFeature, historyFeature]) {
  // Electricity is always in kWh, even when the unit is left out.
  const defaultUnit = key.startsWith('power-') ? 'kilowattHour' : undefined;
  return {
    key,
    describe(features) {
      const today = todayConsumption(features, summaryFeature, historyFeature);
      const mapping = today && CONSUMPTION_UNITS[today.unit ?? defaultUnit];
      return mapping ? { name, ...mapping, min: 0, max: 100000 } : null;
    },
    read: (features) => todayConsumption(features, summaryFeature, historyFeature)?.value,
  };
}

/**
 * Specs of one burner or compressor: running, starts and operating hours.
 * @param {'burner' | 'compressor'} kind
 * @param {number} index
 * @param {boolean} several - Whether the appliance has more than one of them.
 */
function heatSourceSpecs(kind, index, several) {
  const feature = `heating.${kind}s.${index}`;
  const label = `${kind === 'burner' ? 'Burner' : 'Compressor'}${several ? ` ${index + 1}` : ''}`;
  const statistic = (property) => (features) => features.number(`${feature}.statistics`, property);
  return [
    {
      key: `${kind}-${index}-active`,
      describe: (features) =>
        binary(features, feature) === undefined
          ? null
          : {
              name: `${label} running`,
              // Same mapping as the Gladys Netatmo integration for its boiler status.
              category: DEVICE_FEATURE_CATEGORIES.SWITCH,
              type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
              min: 0,
              max: 1,
            },
      read: (features) => binary(features, feature),
    },
    {
      key: `${kind}-${index}-starts`,
      describe: (features) =>
        statistic('starts')(features) === undefined
          ? null
          : {
              name: `${label} starts`,
              category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
              type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
              min: 0,
              max: 100000000,
            },
      read: statistic('starts'),
    },
    {
      key: `${kind}-${index}-hours`,
      describe: (features) =>
        statistic('hours')(features) === undefined
          ? null
          : {
              name: `${label} operating hours`,
              category: DEVICE_FEATURE_CATEGORIES.DURATION,
              type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
              unit: DEVICE_FEATURE_UNITS.HOURS,
              min: 0,
              max: 10000000,
            },
      read: statistic('hours'),
    },
  ];
}

/**
 * Every sensor spec of a heat generator. Burners and compressors depend on
 * the appliance, the other entries are fixed.
 * @param {import('../vicare/features.js').FeatureSet} features
 */
export function generatorSpecs(features) {
  const burners = heatSourceIndexes(features, 'burners');
  const compressors = heatSourceIndexes(features, 'compressors');
  return [
    ...TEMPERATURES.map(temperature),
    ...burners.flatMap((index) => heatSourceSpecs('burner', index, burners.length > 1)),
    ...compressors.flatMap((index) => heatSourceSpecs('compressor', index, compressors.length > 1)),
    ...CONSUMPTIONS.map(consumption),
  ];
}
