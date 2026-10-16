// -----------------------------------------------------------------------------
// Refresh loop: reads the features of every gateway and publishes the states
// that changed.
//
// Our own timer rather than Gladys' `onPoll`: the ViCare free plan allows
// 1450 calls a day, and one call returns every device of a gateway. The
// interval is the user's setting multiplied by the number of gateways, so the
// daily number of calls does not grow with the installation.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  ViCareAuthError,
  ViCareDeviceCommunicationError,
  ViCareRateLimitError,
} from './vicare/errors.js';

const logger = createLogger({ name: 'poller' });

// Re-send an unchanged value this often, so a stable value stays recent in Gladys.
const HEARTBEAT_MS = 30 * 60 * 1000;
// After a command, read the appliance again once it had time to apply it.
const REFRESH_AFTER_COMMAND_MS = 15_000;
// Margin after the quota reset date before calling again.
const RATE_LIMIT_MARGIN_MS = 60_000;
// Gladys accepts at most 100 states per request.
const MAX_STATES_PER_REQUEST = 100;

export class Poller {
  /**
   * @param {object} options
   * @param {object} options.gladys - SDK instance.
   * @param {import('./vicare/client.js').ViCareClient} options.client
   * @param {import('./devices/index.js').DeviceRegistry} options.registry
   * @param {number} options.intervalSeconds - Refresh interval for one gateway.
   * @param {(error: Error | null) => void} [options.onResult] - Outcome of every refresh.
   * @param {() => void} [options.onRefreshed] - Fresh features are in the registry.
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    client,
    registry,
    intervalSeconds,
    onResult = () => {},
    onRefreshed = () => {},
    now = Date.now,
  }) {
    this.gladys = gladys;
    this.client = client;
    this.registry = registry;
    this.intervalSeconds = intervalSeconds;
    this.onResult = onResult;
    this.onRefreshed = onRefreshed;
    this.now = now;
    this.running = false;
    this.timer = null;
    this.soonTimer = null;
    this.soonGateways = new Set();
    // Feature external id -> { state, at } of the last value Gladys accepted.
    this.lastPublished = new Map();
  }

  /** Delay between two refreshes, in ms. */
  intervalMs() {
    return this.intervalSeconds * 1000 * Math.max(1, this.registry.gatewayList().length);
  }

  /**
   * Publish the states already known (from the discovery), then refresh on
   * schedule.
   */
  async start() {
    this.running = true;
    await this.publish(this.registry.states());
    this.schedule(this.intervalMs());
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.soonTimer);
    this.timer = null;
    this.soonTimer = null;
    this.soonGateways.clear();
  }

  /** Apply a new interval setting from the next refresh on. */
  setIntervalSeconds(seconds) {
    this.intervalSeconds = seconds;
    if (this.running) {
      this.schedule(this.intervalMs());
    }
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (!this.running) {
      return;
    }
    let delay = this.intervalMs();
    try {
      for (const gateway of this.registry.gatewayList()) {
        await this.refreshGateway(gateway);
      }
      this.onResult(null);
      this.onRefreshed();
    } catch (err) {
      delay = this.handleError(err);
    }
    if (this.running && delay !== null) {
      this.schedule(delay);
    }
  }

  /**
   * Read a gateway again shortly, after a command. Requests within the delay
   * are merged into one call per gateway.
   * @param {string} gatewaySerial
   */
  refreshSoon(gatewaySerial) {
    this.soonGateways.add(gatewaySerial);
    if (this.soonTimer || !this.running) {
      return;
    }
    this.soonTimer = setTimeout(async () => {
      this.soonTimer = null;
      const serials = [...this.soonGateways];
      this.soonGateways.clear();
      const gateways = this.registry.gatewayList().filter((g) => serials.includes(g.serial));
      try {
        for (const gateway of gateways) {
          await this.refreshGateway(gateway);
        }
        this.onRefreshed();
      } catch (err) {
        const delay = this.handleError(err);
        if (this.running && delay !== null) {
          this.schedule(Math.max(delay, this.intervalMs()));
        }
      }
    }, REFRESH_AFTER_COMMAND_MS);
  }

  async refreshGateway({ installationId, serial }) {
    try {
      const features = await this.client.getGatewayFeatures(installationId, serial);
      this.registry.setGatewayFeatures(serial, features);
    } catch (err) {
      // An offline gateway keeps its last values; the others carry on.
      if (err instanceof ViCareDeviceCommunicationError) {
        logger.warn(`Gateway ${serial} unreachable: ${err.message}`);
        return;
      }
      throw err;
    }
    await this.publish(this.registry.states(serial));
  }

  /**
   * Report a failed refresh and choose when to try again: after the quota
   * reset, never (the account must be linked again), or at the next interval.
   * @returns {number | null} Delay before the next refresh, null to stop.
   */
  handleError(err) {
    this.onResult(err);
    if (err instanceof ViCareRateLimitError) {
      logger.warn(`${err.message}, next refresh after ${new Date(err.resetAt).toISOString()}`);
      return Math.max(err.resetAt - this.now() + RATE_LIMIT_MARGIN_MS, this.intervalMs());
    }
    if (err instanceof ViCareAuthError) {
      logger.error(`${err.message}: polling stopped until the account is linked again`);
      this.stop();
      return null;
    }
    logger.error('Refresh failed', err.message);
    return this.intervalMs();
  }

  /**
   * Forget what was published for a device, so its states go out again: Gladys
   * drops the states of a feature until the user creates the device.
   * @param {string} deviceExternalId
   */
  forget(deviceExternalId) {
    for (const id of this.lastPublished.keys()) {
      if (id.startsWith(`${deviceExternalId}:`)) {
        this.lastPublished.delete(id);
      }
    }
  }

  /**
   * Publish the states that changed since the last accepted publication (or
   * older than the heartbeat). A refused batch is not remembered, so it is
   * sent again next time.
   * @param {{ device_feature_external_id: string, state: number }[]} states
   */
  async publish(states) {
    const now = this.now();
    const changed = states.filter(({ device_feature_external_id: id, state }) => {
      const last = this.lastPublished.get(id);
      return !last || last.state !== state || now - last.at >= HEARTBEAT_MS;
    });
    for (let i = 0; i < changed.length; i += MAX_STATES_PER_REQUEST) {
      const batch = changed.slice(i, i + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
      } catch (err) {
        logger.warn(`Gladys refused ${batch.length} states: ${err.message}`);
        continue;
      }
      for (const { device_feature_external_id: id, state } of batch) {
        this.lastPublished.set(id, { state, at: now });
      }
    }
  }
}
