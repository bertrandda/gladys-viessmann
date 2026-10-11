// -----------------------------------------------------------------------------
// Device type: HEAT GENERATOR -> read-only sensors of the boiler or heat pump
// (temperatures, burner/compressor activity, today's consumption). The table
// of sensors lives in ./sensors.js.
// -----------------------------------------------------------------------------

import { generatorSpecs } from './sensors.js';
import { buildUnit } from './unit.js';

const DEVICE_TYPE = 'heat-generator';

/**
 * The generator device of the appliance, or null when it reports no sensor.
 * @param {object} gladys
 * @param {{ features: import('../vicare/features.js').FeatureSet, target: object, model: string }} appliance
 */
export function buildHeatGenerator(gladys, { features, target, model }) {
  return buildUnit(gladys, {
    type: DEVICE_TYPE,
    platformId: `${target.gatewaySerial}-${target.deviceId}`,
    name: model,
    target,
    features,
    specs: generatorSpecs(features),
  });
}
