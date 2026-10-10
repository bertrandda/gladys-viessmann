// -----------------------------------------------------------------------------
// Read access to the ViCare features of ONE device.
//
// A feature is `{ feature: 'heating.dhw.temperature.main', isEnabled,
// properties: { value: { type, value, unit } }, commands: { setTargetTemperature:
// { params: { temperature: { constraints: { min, max, stepping } } } } } }`.
// A feature that is disabled, or whose property carries no value (models
// report placeholders such as `{}` or a disconnected sensor), counts as absent:
// that is how the device modules decide what to publish.
// -----------------------------------------------------------------------------

/**
 * The features of one device, out of the gateway-wide list.
 * @param {object[]} entities - Features of every device behind a gateway.
 * @param {string} deviceId
 */
export function featuresOfDevice(entities, deviceId) {
  return entities.filter(
    (entity) =>
      entity.deviceId === deviceId ||
      (entity.deviceId === undefined && entity.uri?.includes(`/devices/${deviceId}/`)),
  );
}

export class FeatureSet {
  /** @param {object[]} entities - Features of one device. */
  constructor(entities = []) {
    this.byName = new Map(
      entities.filter((entity) => entity.isEnabled !== false).map((e) => [e.feature, e]),
    );
  }

  /** @param {string} name */
  get(name) {
    return this.byName.get(name);
  }

  /** Names of the features matching a pattern. */
  names(pattern) {
    return [...this.byName.keys()].filter((name) => pattern.test(name));
  }

  /**
   * Value of a property, undefined when the feature or the value is missing.
   * @param {string} name
   * @param {string} [property]
   */
  value(name, property = 'value') {
    return this.get(name)?.properties?.[property]?.value;
  }

  /**
   * Numeric value of a property, undefined unless it is a finite number.
   * @param {string} name
   * @param {string} [property]
   */
  number(name, property = 'value') {
    const value = this.value(name, property);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  /**
   * Unit of a property: on the property itself, or the feature-wide `unit`.
   * @param {string} name
   * @param {string} [property]
   */
  unit(name, property = 'value') {
    const properties = this.get(name)?.properties ?? {};
    return properties[property]?.unit || properties.unit?.value || undefined;
  }

  /**
   * A command of a feature, whatever its `isExecutable` flag: that flag
   * follows the current state (no "deactivate" while inactive), which is stale
   * by the time a user acts, so the API is the judge.
   * @param {string} name
   * @param {string} command
   */
  command(name, command) {
    return this.get(name)?.commands?.[command];
  }
}

/**
 * Constraints of a command parameter (`min`, `max`, `stepping`, `enum`...).
 * @param {object | undefined} command
 * @param {string} param
 */
export function constraints(command, param) {
  return command?.params?.[param]?.constraints ?? {};
}

/**
 * Bring a number within the constraints of a command parameter: rounded to
 * the stepping, then clamped to min/max.
 * @param {number} value
 * @param {{ min?: number, max?: number, stepping?: number }} limits
 */
export function constrain(value, { min, max, stepping } = {}) {
  let result = value;
  if (typeof stepping === 'number' && stepping > 0) {
    const base = typeof min === 'number' ? min : 0;
    result = base + Math.round((result - base) / stepping) * stepping;
    // Floating point noise from the division (0.1 + 0.2...).
    result = Number(result.toFixed(6));
  }
  if (typeof min === 'number') {
    result = Math.max(min, result);
  }
  if (typeof max === 'number') {
    result = Math.min(max, result);
  }
  return result;
}
