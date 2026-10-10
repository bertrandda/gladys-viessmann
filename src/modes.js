// -----------------------------------------------------------------------------
// ViCare <-> Gladys value mappings.
//
// The Gladys enums below are the integer values the core stores for the
// thermostat and water heater features. The SDK exports the feature types but
// not these values, so they are copied from `server/utils/constants.js` of the
// Gladys repository (THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE,
// WATER_HEATER_MODE, as shipped in Gladys 5.1). They are append-only on the
// Gladys side: an existing integer never changes meaning.
// -----------------------------------------------------------------------------

export const THERMOSTAT_MODE = {
  OFF: 0,
  HEATING: 1,
  COOLING: 2,
  AUTO: 3,
};

export const THERMOSTAT_OPERATING_STATE = {
  IDLE: 0,
  HEATING: 1,
  COOLING: 2,
};

export const WATER_HEATER_MODE = {
  OFF: 0,
  AUTO: 1,
  ECO: 2,
  BOOST: 3,
  MANUAL: 4,
  AWAY: 5,
  PROGRAM: 6,
};

// Operating mode of a heating circuit (`heating.circuits.N.operating.modes.active`).
// "dhw" means "hot water only": the circuit itself does not heat.
const CIRCUIT_MODE_TO_GLADYS = {
  standby: THERMOSTAT_MODE.OFF,
  dhw: THERMOSTAT_MODE.OFF,
  heating: THERMOSTAT_MODE.HEATING,
  dhwAndHeating: THERMOSTAT_MODE.HEATING,
  forcedNormal: THERMOSTAT_MODE.HEATING,
  forcedReduced: THERMOSTAT_MODE.HEATING,
  cooling: THERMOSTAT_MODE.COOLING,
  heatingCooling: THERMOSTAT_MODE.AUTO,
  dhwAndHeatingCooling: THERMOSTAT_MODE.AUTO,
};

// When writing, the first ViCare mode the appliance accepts wins. Turning a
// circuit OFF prefers "dhw" over "standby" so hot water keeps running: the
// water heater is a separate Gladys device with its own controls.
const GLADYS_TO_CIRCUIT_MODES = {
  [THERMOSTAT_MODE.OFF]: ['dhw', 'standby'],
  [THERMOSTAT_MODE.HEATING]: ['dhwAndHeating', 'heating'],
  [THERMOSTAT_MODE.COOLING]: ['cooling'],
  [THERMOSTAT_MODE.AUTO]: ['dhwAndHeatingCooling', 'heatingCooling'],
};

// Operating mode of the domestic hot water (`heating.dhw.operating.modes.active`,
// E3 appliances and heat pumps). BOOST is left to the one-time charge command:
// Gladys asks never to expose the same function twice.
const DHW_MODE_TO_GLADYS = {
  off: WATER_HEATER_MODE.OFF,
  eco: WATER_HEATER_MODE.ECO,
  efficient: WATER_HEATER_MODE.ECO,
  efficientWithMinComfort: WATER_HEATER_MODE.ECO,
  balanced: WATER_HEATER_MODE.AUTO,
  comfort: WATER_HEATER_MODE.MANUAL,
};

const GLADYS_TO_DHW_MODES = {
  [WATER_HEATER_MODE.OFF]: ['off'],
  [WATER_HEATER_MODE.ECO]: ['eco', 'efficient', 'efficientWithMinComfort'],
  [WATER_HEATER_MODE.AUTO]: ['balanced'],
  [WATER_HEATER_MODE.MANUAL]: ['comfort'],
};

/**
 * Gladys thermostat mode of a ViCare circuit mode, undefined when unknown.
 * @param {string} vicareMode
 */
export function circuitModeToGladys(vicareMode) {
  return CIRCUIT_MODE_TO_GLADYS[vicareMode];
}

/**
 * ViCare circuit mode to send for a Gladys thermostat mode, among the modes
 * the appliance accepts. Undefined when the appliance supports none of them.
 * @param {number} gladysMode
 * @param {string[]} supportedModes - `enum` of the appliance's `setMode` command.
 */
export function circuitModeFromGladys(gladysMode, supportedModes) {
  return (GLADYS_TO_CIRCUIT_MODES[gladysMode] ?? []).find((mode) => supportedModes.includes(mode));
}

/**
 * Gladys water heater mode of a ViCare hot water mode, undefined when unknown.
 * @param {string} vicareMode
 */
export function dhwModeToGladys(vicareMode) {
  return DHW_MODE_TO_GLADYS[vicareMode];
}

/**
 * ViCare hot water mode to send for a Gladys water heater mode, among the
 * modes the appliance accepts. Undefined when the appliance supports none.
 * @param {number} gladysMode
 * @param {string[]} supportedModes - `enum` of the appliance's `setMode` command.
 */
export function dhwModeFromGladys(gladysMode, supportedModes) {
  return (GLADYS_TO_DHW_MODES[gladysMode] ?? []).find((mode) => supportedModes.includes(mode));
}

/**
 * Operating state of the heat source: cooling wins over heating, which wins
 * over idle. A running compressor heats unless it says it is cooling (models
 * do not agree on the phase names, and some report none).
 * @param {{ burners: boolean[], compressors: { active: boolean, phase?: string }[] }} sources
 */
export function operatingState({ burners, compressors }) {
  const running = compressors.filter((compressor) => compressor.active);
  if (running.some((compressor) => compressor.phase === 'cooling')) {
    return THERMOSTAT_OPERATING_STATE.COOLING;
  }
  if (burners.some(Boolean) || running.length > 0) {
    return THERMOSTAT_OPERATING_STATE.HEATING;
  }
  return THERMOSTAT_OPERATING_STATE.IDLE;
}
