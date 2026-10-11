// -----------------------------------------------------------------------------
// OAuth2 authorization code flow with PKCE, against the Viessmann IAM.
//
// Viessmann developer clients are "public": a client id and no secret, the
// PKCE code verifier proves that the token request comes from whoever started
// the authorization. Gladys relays the browser part (the `oauth2` field of the
// manifest): it hands us its redirect URI and gives back the code.
// -----------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AUTHORIZE_URL, REQUEST_TIMEOUT_MS, SCOPES, TOKEN_URL } from './constants.js';
import { ViCareAuthError, ViCareError } from './errors.js';

// How long a started authorization waits for its callback.
const PENDING_TTL_MS = 10 * 60 * 1000;

// Token endpoint errors meaning "these credentials are dead, link again".
const AUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

/**
 * A random PKCE code verifier: 64 characters of the unreserved set (RFC 7636).
 */
export function createCodeVerifier() {
  return randomBytes(48).toString('base64url');
}

/**
 * The S256 code challenge of a code verifier.
 * @param {string} verifier
 */
export function codeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * URL of the Viessmann sign-in page.
 * @param {{ clientId: string, redirectUri: string, state: string, verifier: string }} params
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state, verifier }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/**
 * Authorizations started from the Configuration screen, waiting for their
 * callback: the anti-CSRF `state` maps to the PKCE verifier (and the client
 * the sign-in was started for). In memory only —
 * a restart in the middle of a sign-in just means clicking Connect again.
 */
export class PendingAuthorizations {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.entries = new Map();
  }

  /**
   * Start an authorization: a fresh state and verifier.
   * @param {string} clientId - Client the authorization is made for.
   */
  create(clientId) {
    this.prune();
    const state = randomUUID();
    const verifier = createCodeVerifier();
    this.entries.set(state, { verifier, clientId, createdAt: this.now() });
    return { state, verifier };
  }

  /**
   * The verifier and client of a pending authorization, which is forgotten:
   * a state is single use. Undefined for an unknown or expired state.
   * @param {string} state
   * @returns {{ verifier: string, clientId: string } | undefined}
   */
  consume(state) {
    this.prune();
    const entry = this.entries.get(state);
    this.entries.delete(state);
    return entry && { verifier: entry.verifier, clientId: entry.clientId };
  }

  prune() {
    const limit = this.now() - PENDING_TTL_MS;
    for (const [state, entry] of this.entries) {
      if (entry.createdAt < limit) {
        this.entries.delete(state);
      }
    }
  }
}

/**
 * Call the token endpoint and normalize the answer into the tokens we store.
 * @param {typeof fetch} fetchImpl
 * @param {Record<string, string>} form
 * @param {() => number} now
 */
async function requestTokens(fetchImpl, form, now) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string') {
    const reason = body.error_description || body.error || `HTTP ${response.status}`;
    if (AUTH_ERRORS.has(body.error) || response.status === 401) {
      throw new ViCareAuthError(`ViCare authorization refused: ${reason}`, {
        status: response.status,
      });
    }
    throw new ViCareError(`ViCare token request failed: ${reason}`, { status: response.status });
  }
  return {
    access_token: body.access_token,
    // A refresh may not rotate the refresh token: the caller keeps the old one.
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    token_expires_at: now() + Number(body.expires_in ?? 3600) * 1000,
  };
}

/**
 * Exchange the authorization code for tokens.
 * @param {typeof fetch} fetchImpl
 * @param {{ clientId: string, code: string, redirectUri: string, verifier: string, now?: () => number }} params
 */
export function exchangeCode(fetchImpl, { clientId, code, redirectUri, verifier, now = Date.now }) {
  return requestTokens(
    fetchImpl,
    {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    now,
  );
}

/**
 * Get a new access token from the refresh token.
 * @param {typeof fetch} fetchImpl
 * @param {{ clientId: string, refreshToken: string, now?: () => number }} params
 */
export function refreshTokens(fetchImpl, { clientId, refreshToken, now = Date.now }) {
  return requestTokens(
    fetchImpl,
    { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken },
    now,
  );
}
