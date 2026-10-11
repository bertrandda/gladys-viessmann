// -----------------------------------------------------------------------------
// A "unit" is one Gladys device built from a Viessmann appliance: a heating
// circuit, the hot water, or the heat generator itself. It is assembled from
// a list of feature specs:
//
//   {
//     key,                         stable feature key (part of the external id: never change it)
//     describe(features, target),  Gladys feature fields when the appliance has
//                                  the feature, null otherwise
//     read(features, target),      current value (a number), undefined when unknown
//     write(value, context),       optional: run the command, resolve the value
//                                  to publish. context = { features, target, run }
//   }
//
// `features` is a FeatureSet (src/vicare/features.js), `target` locates the
// appliance: { installationId, gatewaySerial, deviceId, circuit? }.
// -----------------------------------------------------------------------------

// Fields every published feature carries, unless its spec overrides them.
const FEATURE_DEFAULTS = {
  read_only: true,
  has_feedback: false,
  keep_history: true,
};

/**
 * Build a unit, or null when the appliance exposes none of its features.
 * @param {object} gladys - SDK instance (for externalIds).
 * @param {object} options
 * @param {string} options.type - Device type namespace of the external id.
 * @param {string} options.platformId - Stable id of the unit on the Viessmann side.
 * @param {string} options.name - Default device name in Gladys.
 * @param {object} options.target - Where the appliance lives.
 * @param {import('../vicare/features.js').FeatureSet} options.features
 * @param {object[]} options.specs
 */
export function buildUnit(gladys, { type, platformId, name, target, features, specs }) {
  const ids = gladys.externalIds(type, platformId);
  const described = specs
    .map((spec) => ({ spec, fields: spec.describe(features, target) }))
    .filter(({ fields }) => fields);
  if (described.length === 0) {
    return null;
  }
  const specsByFeatureId = new Map(described.map(({ spec }) => [ids.feature(spec.key), spec]));

  return {
    externalId: ids.device,
    target,
    definition: {
      name,
      external_id: ids.device,
      // States are pushed by our own poller (src/poller.js), Gladys never polls.
      should_poll: false,
      // Technical data, upserted by Gladys on every publication: handy to
      // tell appliances apart when debugging.
      params: [
        { name: 'installation_id', value: String(target.installationId) },
        { name: 'gateway_serial', value: target.gatewaySerial },
        { name: 'device_id', value: target.deviceId },
      ],
      features: described.map(({ spec, fields }) => ({
        ...FEATURE_DEFAULTS,
        ...fields,
        external_id: ids.feature(spec.key),
      })),
    },

    /** Spec owning a feature external id. */
    specFor(featureExternalId) {
      return specsByFeatureId.get(featureExternalId);
    },

    /**
     * Current states, in the `publishStates` format. Unknown values are left
     * out rather than published as a fake 0.
     * @param {import('../vicare/features.js').FeatureSet} current
     */
    readStates(current) {
      return (
        described
          .map(({ spec }) => ({
            device_feature_external_id: ids.feature(spec.key),
            state: spec.read(current, target),
          }))
          .filter(({ state }) => typeof state === 'number' && Number.isFinite(state))
          // The API sends float noise (7.199999999999999 kWh).
          .map((entry) => ({ ...entry, state: Math.round(entry.state * 1000) / 1000 }))
      );
    },
  };
}

/**
 * Readable model name: `E3_Vitocal_250A` -> `Vitocal 250A`.
 * @param {string} modelId
 */
export function modelLabel(modelId) {
  const label = String(modelId ?? '')
    .replace(/^E3_/, '')
    .replace(/_/g, ' ')
    .trim();
  return label || 'Viessmann';
}

/**
 * A boolean property as the 0/1 Gladys expects, undefined when missing.
 * @param {import('../vicare/features.js').FeatureSet} features
 * @param {string} name
 * @param {string} [property]
 */
export function binary(features, name, property = 'active') {
  const value = features.value(name, property);
  return typeof value === 'boolean' ? Number(value) : undefined;
}
