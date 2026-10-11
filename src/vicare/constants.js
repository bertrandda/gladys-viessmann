// -----------------------------------------------------------------------------
// Viessmann ViCare cloud endpoints (same ones as PyViCare / Home Assistant).
// -----------------------------------------------------------------------------

export const AUTHORIZE_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize';
export const TOKEN_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
export const API_BASE_URL = 'https://api.viessmann-climatesolutions.com/iot/v2';

// `IoT` reaches every feature of the devices, `offline_access` is what makes
// the token endpoint return a refresh token.
export const SCOPES = ['IoT', 'offline_access'];

export const REQUEST_TIMEOUT_MS = 30_000;

// Refresh the access token this long before it expires (it lives one hour).
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
