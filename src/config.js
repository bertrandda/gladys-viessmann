// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills in the `config_schema` of `gladys-assistant-integration.json`
// (client id, refresh interval) and links the account with the `oauth2` field.
// The tokens are stored by the integration itself under keys OUTSIDE the
// schema (free internal storage of the Gladys config, never shown in the UI).
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  client_id: '',
  poll_interval: 120, // seconds between two refreshes of one gateway
};

export const POLL_INTERVAL_BOUNDS = { min: 60, max: 3600 };

// Config keys holding the tokens (outside the config_schema).
export const TOKEN_KEYS = ['access_token', 'refresh_token', 'token_expires_at'];

/**
 * Merge the user config with the defaults and coerce the types (values may
 * arrive as strings from a form).
 * @param {Record<string, unknown>} raw - Config returned by the SDK.
 */
export function normalizeConfig(raw = {}) {
  const interval = Number(raw.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    client_id: typeof raw.client_id === 'string' ? raw.client_id.trim() : DEFAULT_CONFIG.client_id,
    poll_interval: Number.isFinite(interval)
      ? Math.min(POLL_INTERVAL_BOUNDS.max, Math.max(POLL_INTERVAL_BOUNDS.min, interval))
      : DEFAULT_CONFIG.poll_interval,
  };
}

/**
 * The stored tokens of a config.
 * @param {Record<string, unknown>} config
 */
export function tokensOf(config) {
  return {
    access_token: config.access_token || undefined,
    refresh_token: config.refresh_token || undefined,
    token_expires_at: Number(config.token_expires_at) || 0,
  };
}

/** Config patch erasing the stored tokens. */
export const CLEARED_TOKENS = { access_token: '', refresh_token: '', token_expires_at: 0 };
