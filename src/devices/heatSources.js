// -----------------------------------------------------------------------------
// Burners (boilers) and compressors (heat pumps) of an appliance.
// -----------------------------------------------------------------------------

/**
 * Indexes of the burners or compressors an appliance reports
 * (`heating.burners.0`, `heating.compressors.1`...), sorted.
 * @param {import('../vicare/features.js').FeatureSet} features
 * @param {'burners' | 'compressors'} kind
 */
export function heatSourceIndexes(features, kind) {
  const pattern = new RegExp(`^heating\\.${kind}\\.(\\d+)$`);
  return features
    .names(pattern)
    .filter((name) => typeof features.value(name, 'active') === 'boolean')
    .map((name) => Number(pattern.exec(name)[1]))
    .sort((a, b) => a - b);
}

/**
 * Running state of every heat source, for the thermostat operating state.
 * @param {import('../vicare/features.js').FeatureSet} features
 */
export function heatSources(features) {
  return {
    burners: heatSourceIndexes(features, 'burners').map(
      (index) => features.value(`heating.burners.${index}`, 'active') === true,
    ),
    compressors: heatSourceIndexes(features, 'compressors').map((index) => ({
      active: features.value(`heating.compressors.${index}`, 'active') === true,
      phase: features.value(`heating.compressors.${index}`, 'phase'),
    })),
  };
}
