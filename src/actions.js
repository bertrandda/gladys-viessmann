// -----------------------------------------------------------------------------
// Manifest actions: buttons of the Configuration screen. The resolved message
// is displayed under the button.
// -----------------------------------------------------------------------------

import { MESSAGES, errorMessage } from './messages.js';

/**
 * `test_connection`: list what the account holds and refresh the discovery.
 * @param {{ ready: () => 'missing-client-id' | 'not-linked' | 'ok', discover: () => Promise<{ installationCount: number, gateways: object[], unitCount: number }> }} app
 */
export async function testConnection(app) {
  const readiness = app.ready();
  if (readiness === 'missing-client-id') {
    return MESSAGES.missingClientId;
  }
  if (readiness === 'not-linked') {
    return MESSAGES.notLinked;
  }
  let result;
  try {
    result = await app.discover();
  } catch (err) {
    return errorMessage(err);
  }
  const { installationCount, gateways, unitCount } = result;
  const appliances = gateways.flatMap((gateway) => gateway.devices);
  const offline = gateways.filter((gateway) => !gateway.features).length;
  const models = [...new Set(appliances.map((device) => device.modelId))].join(', ') || '-';
  const offlineEn = offline > 0 ? ` ${offline} gateway(s) unreachable right now.` : '';
  const offlineFr = offline > 0 ? ` ${offline} passerelle(s) injoignable(s) pour le moment.` : '';
  return {
    en:
      `Connected to ViCare: ${installationCount} installation(s), ${gateways.length} gateway(s), ` +
      `${appliances.length} heating appliance(s) (${models}). ` +
      `${unitCount} device(s) available in the Discovery tab.${offlineEn}`,
    fr:
      `Connecté à ViCare : ${installationCount} installation(s), ${gateways.length} passerelle(s), ` +
      `${appliances.length} appareil(s) de chauffage (${models}). ` +
      `${unitCount} appareil(s) disponible(s) dans l'onglet Découverte.${offlineFr}`,
  };
}
