// -----------------------------------------------------------------------------
// Fake ViCare cloud: a `fetch` replacement serving the JSON fixtures of
// test/fixtures, recording every request. Tests never touch the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const INSTALLATION_ID = 123456;
export const BOILER_GATEWAY = '7571381573112225';
export const HEATPUMP_GATEWAY = '7633107093013212';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * @param {object} [options]
 * @param {(request: { method: string, url: URL, body: any }) => object | undefined} [options.override]
 *   Answer a request differently: return `{ status, body }`, or undefined for the default.
 */
export function createFakeViCare({ override } = {}) {
  const requests = [];
  const gateways = {
    [BOILER_GATEWAY]: fixture('gateway-boiler'),
    [HEATPUMP_GATEWAY]: fixture('gateway-heatpump'),
  };
  const installations = fixture('installations');
  let tokenCounter = 0;

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    let body = init.body;
    if (typeof body === 'string' && init.headers?.['Content-Type'] === 'application/json') {
      body = JSON.parse(body);
    } else if (typeof body === 'string') {
      body = Object.fromEntries(new URLSearchParams(body));
    }
    const request = { method, url, body, headers: init.headers ?? {} };
    requests.push(request);

    const custom = override?.(request);
    if (custom) {
      return jsonResponse(custom.status ?? 200, custom.body);
    }

    if (url.pathname.endsWith('/idp/v3/token')) {
      tokenCounter += 1;
      return jsonResponse(200, {
        access_token: `access-${tokenCounter}`,
        refresh_token: `refresh-${tokenCounter}`,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (url.pathname === '/iot/v2/equipment/installations') {
      return jsonResponse(200, installations);
    }
    const featuresMatch =
      /^\/iot\/v2\/features\/installations\/\d+\/gateways\/(\d+)\/features$/.exec(url.pathname);
    if (featuresMatch && gateways[featuresMatch[1]]) {
      return jsonResponse(200, gateways[featuresMatch[1]]);
    }
    if (method === 'POST' && url.pathname.includes('/commands/')) {
      return jsonResponse(200, { data: { success: true, reason: 'COMMAND_EXECUTION_SUCCESS' } });
    }
    return jsonResponse(404, { statusCode: 404, message: 'Not found' });
  }

  return {
    fetch: fetchImpl,
    requests,
    gateways,
    /** Requests to the API (not the IAM). */
    apiRequests: () => requests.filter((r) => r.url.pathname.startsWith('/iot/')),
    commands: () =>
      requests
        .filter((r) => r.method === 'POST' && r.url.pathname.includes('/commands/'))
        .map((r) => {
          const [, feature, command] = /\/features\/([^/]+)\/commands\/([^/]+)$/.exec(
            r.url.pathname,
          );
          const deviceId = decodeURIComponent(/\/devices\/([^/]+)\//.exec(r.url.pathname)[1]);
          return { feature, command, deviceId, params: r.body };
        }),
    /** Change a property of a fixture feature (simulates the appliance). */
    setProperty(gatewaySerial, deviceId, feature, property, value) {
      const entity = gateways[gatewaySerial].data.find(
        (e) => e.feature === feature && e.deviceId === deviceId,
      );
      entity.properties[property].value = value;
    },
  };
}

/** A config with a linked account, as stored after the OAuth flow. */
export function linkedConfig(overrides = {}) {
  return {
    client_id: 'client-123',
    poll_interval: 120,
    access_token: 'stored-access',
    refresh_token: 'stored-refresh',
    token_expires_at: Date.now() + 3600 * 1000,
    ...overrides,
  };
}
