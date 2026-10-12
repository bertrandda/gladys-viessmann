// -----------------------------------------------------------------------------
// Integration wiring: registers every SDK handler on a Gladys client.
//
// Kept apart from index.js so the tests can drive it with a fake Gladys and a
// fake `fetch`. Lifecycle:
//   1. on connection, read the config; without a client id or a linked
//      account, say so in the Configuration screen and wait;
//   2. otherwise discover the appliances, publish the Gladys devices, and
//      start the refresh loop (src/poller.js);
//   3. the "Connect" button runs the OAuth2 flow (onOAuthAuthorizeUrl /
//      onOAuthCallback), then step 2.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { testConnection } from './actions.js';
import { CLEARED_TOKENS, normalizeConfig, tokensOf } from './config.js';
import { DeviceRegistry } from './devices/index.js';
import { discoverInventory } from './inventory.js';
import { MESSAGES, errorMessage } from './messages.js';
import { Poller } from './poller.js';
import { ViCareClient } from './vicare/client.js';
import { ViCareAuthError, ViCareRateLimitError } from './vicare/errors.js';
import { PendingAuthorizations, buildAuthorizeUrl, exchangeCode } from './vicare/oauth.js';

const logger = createLogger({ name: 'viessmann' });

// After a failed start (API down...), try again this late.
const RETRY_DELAY_MS = 5 * 60 * 1000;
const RATE_LIMIT_MARGIN_MS = 60_000;

/**
 * @param {object} gladys - GladysIntegration instance (or a test double).
 * @param {{ fetch?: typeof fetch, now?: () => number }} [deps]
 * @returns {{ stop: () => void }}
 */
export function registerHandlers(
  gladys,
  { fetch: fetchImpl = globalThis.fetch, now = Date.now } = {},
) {
  const pending = new PendingAuthorizations({ now });
  const registry = new DeviceRegistry(gladys);
  let config = normalizeConfig();
  let client = null;
  let poller = null;
  let retryTimer = null;
  let lastStatus = null;

  // --- Helpers ----------------------------------------------------------------

  /** Connection status of the Configuration screen, sent only when it changes. */
  async function reportStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus) {
      return;
    }
    lastStatus = key;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.warn('Could not report the connection status', err.message);
    }
  }

  function readiness() {
    if (!config.client_id) {
      return 'missing-client-id';
    }
    return client?.linked ? 'ok' : 'not-linked';
  }

  function createClient() {
    client = new ViCareClient({
      clientId: config.client_id,
      tokens: tokensOf(config),
      fetch: fetchImpl,
      now,
      saveTokens: async (tokens) => {
        config = { ...config, ...tokens };
        await gladys.setConfig(tokens);
      },
    });
  }

  /** Read the appliances and publish the Gladys devices. */
  async function discover() {
    const inventory = await discoverInventory(client);
    registry.update(inventory);
    await gladys.publishDiscoveredDevices(registry.definitions());
    logger.info(
      `${registry.units.length} device(s) published for ${inventory.gateways.length} gateway(s)`,
    );
    return { ...inventory, unitCount: registry.units.length };
  }

  function stopAll() {
    poller?.stop();
    poller = null;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  /** Discover, then poll. Throws when the discovery fails. */
  async function initialize() {
    stopAll();
    const result = await discover();
    poller = new Poller({
      gladys,
      client,
      registry,
      intervalSeconds: config.poll_interval,
      now,
      onResult: (err) => reportStatus(!err, err ? errorMessage(err) : undefined),
    });
    await poller.start();
    await reportStatus(true);
    return result;
  }

  /** (Re)start from the current config, retrying later on a transient failure. */
  async function start() {
    stopAll();
    createClient();
    const state = readiness();
    if (state !== 'ok') {
      await reportStatus(
        false,
        state === 'missing-client-id' ? MESSAGES.missingClientId : MESSAGES.notLinked,
      );
      return;
    }
    try {
      await initialize();
    } catch (err) {
      await initializationFailed(err);
    }
  }

  /** Report a failed initialization and retry later, unless the user must act. */
  async function initializationFailed(err) {
    logger.error('Initialization failed', err.message);
    await reportStatus(false, errorMessage(err));
    if (err instanceof ViCareAuthError) {
      return;
    }
    const delay =
      err instanceof ViCareRateLimitError
        ? Math.max(err.resetAt - now() + RATE_LIMIT_MARGIN_MS, RETRY_DELAY_MS)
        : RETRY_DELAY_MS;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => start(), delay);
  }

  // --- Connection lifecycle ---------------------------------------------------

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      // Gladys may have restarted: tell it the status again.
      lastStatus = null;
      await start();
    } catch (err) {
      logger.error('Post-connection initialization failed', err.message);
    }
  });

  // Nothing to publish to while Gladys is away: spare the API quota.
  gladys.on('disconnected', () => stopAll());

  // --- Account linking (manifest field `vicare_account`, type oauth2) --------

  gladys.onOAuthAuthorizeUrl(async (_key, redirectUri) => {
    // The client id may have been saved a second ago: read the stored one.
    const { client_id: clientId } = normalizeConfig(await gladys.getConfig());
    if (!clientId) {
      // Gladys shows its own generic error for a failed Connect: the status
      // message at the top of the screen is what explains it.
      await reportStatus(false, MESSAGES.saveBeforeConnect);
      throw new Error('No saved client ID: save the configuration before clicking Connect');
    }
    const { state, verifier } = pending.create(clientId);
    return buildAuthorizeUrl({ clientId, redirectUri, state, verifier });
  });

  gladys.onOAuthCallback(async (_key, { code, state, redirectUri }) => {
    const authorization = pending.consume(state);
    if (!authorization) {
      throw new Error('Unknown or expired authorization: click Connect again');
    }
    const tokens = await exchangeCode(fetchImpl, {
      clientId: authorization.clientId,
      code,
      redirectUri,
      verifier: authorization.verifier,
      now,
    });
    if (!tokens.refresh_token) {
      logger.warn('No refresh token received: the link will last one hour');
    }
    const stored = { ...tokens, refresh_token: tokens.refresh_token ?? '' };
    await gladys.setConfig(stored);
    config = { ...config, client_id: authorization.clientId, ...stored };
    logger.info('ViCare account linked');
    await start();
  });

  // --- Devices ----------------------------------------------------------------

  gladys.onScanRequest(async () => {
    if (readiness() !== 'ok') {
      logger.warn('Scan ignored: no ViCare account linked');
      return;
    }
    if (!poller) {
      await start();
      return;
    }
    await discover();
    await poller.publish(registry.states());
  });

  gladys.onSetValue(async (device, feature, value) => {
    if (readiness() !== 'ok') {
      throw new Error('No ViCare account linked');
    }
    if (!registry.has(device.external_id)) {
      await discover();
    }
    const { gatewaySerial, published } = await registry.setValue(device, feature, value, client);
    logger.info(`Command ${feature.external_id} <- ${value}`);
    if (published !== undefined) {
      const states = [{ device_feature_external_id: feature.external_id, state: published }];
      await (poller ? poller.publish(states) : gladys.publishStates(states));
    }
    poller?.refreshSoon(gatewaySerial);
  });

  // Gladys drops the states of a device until the user creates it: send them
  // again as soon as it exists (or changed).
  const resendStates = async (device) => {
    if (!poller) {
      return;
    }
    poller.forget(device.external_id);
    await poller.publish(registry.states());
  };
  gladys.onDeviceCreated(resendStates);
  gladys.onDeviceUpdated(resendStates);

  // --- Configuration ----------------------------------------------------------

  gladys.onConfigUpdated(async (raw) => {
    const next = normalizeConfig(raw);
    const clientChanged = next.client_id !== config.client_id;
    const intervalChanged = next.poll_interval !== config.poll_interval;
    const wasLinked = Boolean(client?.linked || tokensOf(config).refresh_token);
    config = next;
    if (clientChanged) {
      // Tokens belong to the client that issued them.
      if (wasLinked) {
        await gladys.setConfig(CLEARED_TOKENS);
        config = { ...config, ...CLEARED_TOKENS };
      }
      await start();
    } else if (intervalChanged) {
      poller?.setIntervalSeconds(config.poll_interval);
    }
  });

  gladys.onAction('test_connection', () =>
    testConnection({
      ready: readiness,
      discover: async () => {
        if (!poller) {
          // Not running yet (failed start): a successful test starts it.
          try {
            return await initialize();
          } catch (err) {
            await initializationFailed(err);
            throw err;
          }
        }
        const result = await discover();
        await poller.publish(registry.states());
        return result;
      },
    }),
  );

  return { stop: stopAll };
}
