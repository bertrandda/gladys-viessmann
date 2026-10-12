// -----------------------------------------------------------------------------
// In-memory stand-in for the Gladys SDK object, for the unit tests.
//
// It records what the integration sends (discovered devices, states, config
// writes, connection statuses), lets the tests play Gladys' side (fire the
// registered handlers, emit 'connected'), and checks the payloads the way the
// Gladys 5.1 host API does: external id prefix, known category/type/unit,
// mandatory min/max, at most 100 numeric states per request.
//
// The known types come from the SDK, which follows the latest Gladys: the
// pairs it knows and Gladys 5.1 does not (the manifest minimum) are refused
// on top of it.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const CATEGORIES = Object.values(DEVICE_FEATURE_CATEGORIES);
const TYPES = Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group));
const UNITS = Object.values(DEVICE_FEATURE_UNITS);
// Category/type pairs added after Gladys 5.1. Matched on both: `preset` alone
// is also the camera preset, which 5.1 knows.
const NOT_IN_GLADYS_5_1 = [
  [DEVICE_FEATURE_CATEGORIES.THERMOSTAT, DEVICE_FEATURE_TYPES.THERMOSTAT.PRESET],
];

// Keep the test output readable: the integration logs every refresh.
process.env.LOG_LEVEL ??= 'silent';

export const SELECTOR = 'viessmann-test';

export function createFakeGladys({ config = {} } = {}) {
  const prefix = `ext:${SELECTOR}:`;
  const handlers = {};
  const fake = new EventEmitter();

  Object.assign(fake, {
    config: { ...config },
    discoveredDevices: [],
    states: [],
    configWrites: [],
    connectionStatuses: [],

    externalId: (suffix) => `${prefix}${suffix}`,
    externalIds(type, platformId) {
      const device = `${prefix}${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    // --- Handler registration (same names as the SDK) ---
    onSetValue: (cb) => (handlers.setValue = cb),
    onScanRequest: (cb) => (handlers.scanRequest = cb),
    onConfigUpdated: (cb) => (handlers.configUpdated = cb),
    onOAuthAuthorizeUrl: (cb) => (handlers.oauthAuthorizeUrl = cb),
    onOAuthCallback: (cb) => (handlers.oauthCallback = cb),
    onDeviceCreated: (cb) => (handlers.deviceCreated = cb),
    onDeviceUpdated: (cb) => (handlers.deviceUpdated = cb),
    onAction: (key, cb) => (handlers[`action:${key}`] = cb),
    handlers,

    // --- Host API ---
    async getConfig() {
      return { ...fake.config };
    },
    async setConfig(partial) {
      fake.configWrites.push(partial);
      Object.assign(fake.config, partial);
      return { success: true };
    },
    async setConnectionStatus(connected, message) {
      fake.connectionStatuses.push({ connected, message });
      return { success: true };
    },
    async publishDiscoveredDevices(devices) {
      devices.forEach((device, index) => validateDevice(device, index, prefix));
      fake.discoveredDevices = devices;
      return { success: true, count: devices.length };
    },
    async publishStates(states) {
      if (states.length > 100) {
        throw new Error('states: max 100 states per request');
      }
      for (const state of states) {
        if (!state.device_feature_external_id.startsWith(prefix)) {
          throw new Error(`state ${state.device_feature_external_id}: bad prefix`);
        }
        if (typeof state.state !== 'number' || !Number.isFinite(state.state)) {
          throw new Error(`state ${state.device_feature_external_id}: not a number`);
        }
      }
      fake.states.push(...states);
      return { success: true };
    },
    async publishState(featureExternalId, state) {
      return fake.publishStates([{ device_feature_external_id: featureExternalId, state }]);
    },

    // --- Test helpers ---
    /** Last value published for a feature external id. */
    lastState(featureExternalId) {
      return fake.states.findLast((s) => s.device_feature_external_id === featureExternalId)?.state;
    },
    /** Emit 'connected' and wait for the async listeners. */
    async connect() {
      await Promise.all(fake.listeners('connected').map((listener) => listener()));
    },
    lastStatus() {
      return fake.connectionStatuses.at(-1);
    },
  });

  return fake;
}

function validateDevice(device, index, prefix) {
  const path = `devices[${index}]`;
  if (typeof device.name !== 'string' || device.name.length === 0) {
    throw new Error(`${path}.name: must be a non-empty string`);
  }
  if (!device.external_id?.startsWith(prefix)) {
    throw new Error(`${path}.external_id: bad prefix`);
  }
  if (device.poll_frequency !== undefined) {
    throw new Error(`${path}.poll_frequency: not expected, the integration polls itself`);
  }
  device.features.forEach((feature, featureIndex) => {
    const featurePath = `${path}.features[${featureIndex}] (${feature.external_id})`;
    if (!feature.external_id?.startsWith(`${device.external_id}:`)) {
      throw new Error(`${featurePath}.external_id: must extend the device external id`);
    }
    if (!CATEGORIES.includes(feature.category)) {
      throw new Error(`${featurePath}.category: unknown category ${feature.category}`);
    }
    if (!TYPES.includes(feature.type)) {
      throw new Error(`${featurePath}.type: unknown type ${feature.type}`);
    }
    if (NOT_IN_GLADYS_5_1.some(([c, type]) => c === feature.category && type === feature.type)) {
      throw new Error(`${featurePath}: ${feature.category}/${feature.type} is not in Gladys 5.1`);
    }
    if (feature.unit !== undefined && !UNITS.includes(feature.unit)) {
      throw new Error(`${featurePath}.unit: unknown unit ${feature.unit}`);
    }
    for (const key of ['min', 'max']) {
      if (typeof feature[key] !== 'number') {
        throw new Error(`${featurePath}.${key}: required number (NOT NULL in Gladys)`);
      }
    }
    for (const key of ['read_only', 'has_feedback', 'keep_history']) {
      if (typeof feature[key] !== 'boolean') {
        throw new Error(`${featurePath}.${key}: required boolean`);
      }
    }
    if (feature.step !== undefined && !(feature.step > 0)) {
      throw new Error(`${featurePath}.step: must be a positive number`);
    }
  });
}
