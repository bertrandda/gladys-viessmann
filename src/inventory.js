// -----------------------------------------------------------------------------
// Inventory of the ViCare account: installations -> gateways -> heating
// appliances, plus the current features of each gateway.
//
// Costs 1 call for the installations + 1 per gateway (the features of every
// device behind a gateway come in a single call).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ViCareDeviceCommunicationError } from './vicare/errors.js';

const logger = createLogger({ name: 'inventory' });

// The appliances this integration maps. Gateways, room controls, ventilation
// units and energy systems are listed by the API too, and left aside.
const SUPPORTED_DEVICE_TYPES = ['heating'];

/**
 * @typedef {object} Gateway
 * @property {number | string} installationId
 * @property {string} serial
 * @property {{ id: string, modelId: string, status?: string }[]} devices - Supported appliances.
 * @property {object[] | null} features - Features of the gateway, null when it is unreachable.
 */

/**
 * List the supported appliances of the account and read their features.
 * @param {import('./vicare/client.js').ViCareClient} client
 * @returns {Promise<{ installationCount: number, gateways: Gateway[] }>}
 */
export async function discoverInventory(client) {
  const installations = await client.getInstallations();
  const gateways = [];
  for (const installation of installations) {
    for (const gateway of installation.gateways ?? []) {
      const devices = (gateway.devices ?? [])
        .filter((device) => SUPPORTED_DEVICE_TYPES.includes(device.deviceType))
        .map((device) => ({
          id: String(device.id),
          modelId: device.modelId ?? '',
          status: device.status,
        }));
      if (devices.length > 0) {
        gateways.push({
          installationId: installation.id,
          serial: String(gateway.serial),
          devices,
          features: null,
        });
      }
    }
  }

  for (const gateway of gateways) {
    try {
      gateway.features = await client.getGatewayFeatures(gateway.installationId, gateway.serial);
    } catch (err) {
      // An offline gateway must not hide the other ones: its appliances are
      // simply missing from this discovery.
      if (!(err instanceof ViCareDeviceCommunicationError)) {
        throw err;
      }
      logger.warn(`Gateway ${gateway.serial} unreachable, skipped: ${err.message}`);
    }
  }

  return { installationCount: installations.length, gateways };
}
