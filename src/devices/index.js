// -----------------------------------------------------------------------------
// Device registry: turns the ViCare inventory into Gladys devices, keeps the
// latest features of every gateway, and routes the commands.
//
// Each heating appliance gives up to three kinds of Gladys devices:
//   - ./heatingCircuit.js  one thermostat per heating circuit
//   - ./dhw.js             the hot water (water heater)
//   - ./heatGenerator.js   the boiler / heat pump sensors
// -----------------------------------------------------------------------------

import { FeatureSet, featuresOfDevice } from '../vicare/features.js';
import { buildDhw } from './dhw.js';
import { buildHeatGenerator } from './heatGenerator.js';
import { buildHeatingCircuits } from './heatingCircuit.js';
import { modelLabel } from './unit.js';

/**
 * Every Gladys device of an inventory.
 * @param {object} gladys
 * @param {{ gateways: import('../inventory.js').Gateway[] }} inventory
 */
export function buildUnits(gladys, inventory) {
  const units = [];
  for (const gateway of inventory.gateways) {
    if (!gateway.features) {
      continue;
    }
    for (const device of gateway.devices) {
      const appliance = {
        features: new FeatureSet(featuresOfDevice(gateway.features, device.id)),
        target: {
          installationId: gateway.installationId,
          gatewaySerial: gateway.serial,
          deviceId: device.id,
        },
        model: modelLabel(device.modelId),
      };
      units.push(
        ...buildHeatingCircuits(gladys, appliance),
        buildDhw(gladys, appliance),
        buildHeatGenerator(gladys, appliance),
      );
    }
  }
  return units.filter(Boolean);
}

export class DeviceRegistry {
  constructor(gladys) {
    this.gladys = gladys;
    this.units = [];
    this.byExternalId = new Map();
    // Gateway serial -> { installationId, serial, features }
    this.gateways = new Map();
  }

  /** Replace the inventory (after a discovery). */
  update(inventory) {
    this.units = buildUnits(this.gladys, inventory);
    this.byExternalId = new Map(this.units.map((unit) => [unit.externalId, unit]));
    this.gateways = new Map(
      inventory.gateways
        .filter((gateway) => gateway.features)
        .map((gateway) => [gateway.serial, { ...gateway }]),
    );
  }

  /** The `publishDiscoveredDevices` payload. */
  definitions() {
    return this.units.map((unit) => unit.definition);
  }

  has(deviceExternalId) {
    return this.byExternalId.has(deviceExternalId);
  }

  /** Gateways to poll: `{ installationId, serial }`. */
  gatewayList() {
    return [...this.gateways.values()].map(({ installationId, serial }) => ({
      installationId,
      serial,
    }));
  }

  /** Store fresh features of a gateway (from a poll). */
  setGatewayFeatures(serial, features) {
    const gateway = this.gateways.get(serial);
    if (gateway) {
      gateway.features = features;
    }
  }

  /** Latest features of the appliance a unit belongs to. */
  featuresOf(target) {
    const entities = this.gateways.get(target.gatewaySerial)?.features ?? [];
    return new FeatureSet(featuresOfDevice(entities, target.deviceId));
  }

  /**
   * Current states of every device, or of the devices of one gateway.
   * @param {string} [gatewaySerial]
   */
  states(gatewaySerial) {
    return this.units
      .filter((unit) => !gatewaySerial || unit.target.gatewaySerial === gatewaySerial)
      .flatMap((unit) => unit.readStates(this.featuresOf(unit.target)));
  }

  /**
   * Run a Gladys command on the appliance. Resolves with the gateway it
   * touched and the value to publish.
   * @param {{ external_id: string }} device
   * @param {{ external_id: string }} feature
   * @param {number} value
   * @param {import('../vicare/client.js').ViCareClient} client
   */
  async setValue(device, feature, value, client) {
    const unit = this.byExternalId.get(device.external_id);
    const spec = unit?.specFor(feature.external_id);
    if (!spec?.write) {
      throw new Error(`No command for ${feature.external_id}`);
    }
    const { target } = unit;
    const published = await spec.write(Number(value), {
      features: this.featuresOf(target),
      target,
      run: (featureName, command, params) =>
        client.executeCommand({
          installationId: target.installationId,
          gatewaySerial: target.gatewaySerial,
          deviceId: target.deviceId,
          feature: featureName,
          command,
          params,
        }),
    });
    return { gatewaySerial: target.gatewaySerial, published };
  }
}
