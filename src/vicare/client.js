// -----------------------------------------------------------------------------
// ViCare cloud API client.
//
// Owns the tokens: refreshes the access token shortly before it expires (or
// when the API says it expired), and hands every new token set to
// `saveTokens` so it survives a restart. Turns the API error payloads into
// the typed errors of ./errors.js. Never logs a token.
// -----------------------------------------------------------------------------

import { API_BASE_URL, REQUEST_TIMEOUT_MS, TOKEN_REFRESH_MARGIN_MS } from './constants.js';
import {
  ViCareAuthError,
  ViCareDeviceCommunicationError,
  ViCareError,
  ViCareRateLimitError,
} from './errors.js';
import { refreshTokens } from './oauth.js';

// Without a reset date in a 429 answer, try again in an hour.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

export class ViCareClient {
  /**
   * @param {object} options
   * @param {string} options.clientId - Client id of the Viessmann developer portal.
   * @param {{ access_token?: string, refresh_token?: string, token_expires_at?: number }} [options.tokens]
   * @param {(tokens: object) => Promise<void>} [options.saveTokens] - Persists a refreshed token set.
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({ clientId, tokens = {}, saveTokens = async () => {}, fetch: fetchImpl, now }) {
    this.clientId = clientId;
    this.tokens = { ...tokens };
    this.saveTokens = saveTokens;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.now = now ?? Date.now;
    this.refreshing = null;
  }

  /** Whether an account is linked (it may still turn out to be revoked). */
  get linked() {
    return Boolean(this.tokens.refresh_token || this.tokens.access_token);
  }

  /**
   * A valid access token, refreshed when it is about to expire. Concurrent
   * callers share the same refresh request.
   * @param {{ forceRefresh?: boolean }} [options]
   */
  async getAccessToken({ forceRefresh = false } = {}) {
    const { access_token: accessToken, refresh_token: refreshToken } = this.tokens;
    const expiresAt = Number(this.tokens.token_expires_at) || 0;
    if (!forceRefresh && accessToken && expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return accessToken;
    }
    if (!refreshToken) {
      throw new ViCareAuthError('No ViCare account linked');
    }
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async refresh() {
    const tokens = await refreshTokens(this.fetch, {
      clientId: this.clientId,
      refreshToken: this.tokens.refresh_token,
      now: this.now,
    });
    this.tokens = { ...tokens, refresh_token: tokens.refresh_token ?? this.tokens.refresh_token };
    await this.saveTokens({ ...this.tokens });
    return this.tokens.access_token;
  }

  /**
   * Call the API, retrying once with a fresh token when the token was refused.
   * @param {'GET' | 'POST'} method
   * @param {string} path - Path below the API base URL.
   * @param {object} [body] - JSON body (POST).
   */
  async request(method, path, body, { retried = false } = {}) {
    const token = await this.getAccessToken();
    let response;
    try {
      response = await this.fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ViCareError(`ViCare API unreachable: ${err.message}`);
    }
    const payload = await response.json().catch(() => null);

    const tokenRefused = response.status === 401 || payload?.error === 'EXPIRED TOKEN';
    if (tokenRefused && !retried) {
      await this.getAccessToken({ forceRefresh: true });
      return this.request(method, path, body, { retried: true });
    }
    if (tokenRefused) {
      throw new ViCareAuthError('ViCare refused the access token', { status: 401 });
    }
    this.throwIfError(response, payload);
    return payload ?? {};
  }

  /**
   * Map an error answer to a typed error. Some errors come back with an HTTP
   * 200 and the real status in the body, hence the `statusCode` check.
   */
  throwIfError(response, payload) {
    const status = Number(payload?.statusCode ?? response.status);
    const errorType = payload?.errorType;
    if (errorType === 'RATE_LIMIT_EXCEEDED' || status === 429) {
      const resetAt =
        Number(payload?.extendedPayload?.limitReset) || this.now() + DEFAULT_RATE_LIMIT_BACKOFF_MS;
      const name = payload?.extendedPayload?.name ?? 'rate limit';
      throw new ViCareRateLimitError(`ViCare API quota exceeded (${name})`, resetAt);
    }
    if (errorType === 'DEVICE_COMMUNICATION_ERROR') {
      const reason = payload?.extendedPayload?.reason ?? 'offline';
      throw new ViCareDeviceCommunicationError(`ViCare cannot reach the appliance (${reason})`, {
        status,
        errorType,
      });
    }
    if (errorType === 'PACKAGE_NOT_PAID_FOR') {
      throw new ViCareError('This feature needs a paid ViCare API plan', { status, errorType });
    }
    if (!response.ok || status >= 400) {
      throw new ViCareError(payload?.message || `HTTP ${response.status}`, { status, errorType });
    }
  }

  /** Installations of the account, with their gateways and devices. */
  async getInstallations() {
    const payload = await this.request('GET', '/equipment/installations?includeGateways=true');
    return payload.data ?? [];
  }

  /**
   * Every feature of every device behind a gateway, in a single call (the
   * quota counts calls, not features).
   * @param {number | string} installationId
   * @param {string} gatewaySerial
   */
  async getGatewayFeatures(installationId, gatewaySerial) {
    const path =
      `/features/installations/${encodeURIComponent(installationId)}` +
      `/gateways/${encodeURIComponent(gatewaySerial)}/features?includeDevicesFeatures=true`;
    const payload = await this.request('GET', path);
    return payload.data ?? [];
  }

  /**
   * Run a command of a device feature.
   * @param {{ installationId: number | string, gatewaySerial: string, deviceId: string, feature: string, command: string, params?: object }} target
   */
  async executeCommand({ installationId, gatewaySerial, deviceId, feature, command, params = {} }) {
    const path =
      `/features/installations/${encodeURIComponent(installationId)}` +
      `/gateways/${encodeURIComponent(gatewaySerial)}` +
      `/devices/${encodeURIComponent(deviceId)}` +
      `/features/${encodeURIComponent(feature)}/commands/${encodeURIComponent(command)}`;
    const payload = await this.request('POST', path, params);
    if (payload?.data?.success === false) {
      throw new ViCareError(`ViCare refused ${feature}/${command}: ${payload.data.reason}`);
    }
    return payload;
  }
}
