// -----------------------------------------------------------------------------
// Errors raised by the ViCare client, so callers can tell apart what the user
// must fix (re-link the account), what heals by itself (quota, offline
// gateway) and plain failures.
// -----------------------------------------------------------------------------

export class ViCareError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, errorType?: string }} [details]
   */
  constructor(message, { status, errorType } = {}) {
    super(message);
    this.name = 'ViCareError';
    this.status = status;
    this.errorType = errorType;
  }
}

// No usable token: the user has to (re)connect the ViCare account.
export class ViCareAuthError extends ViCareError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ViCareAuthError';
  }
}

// API quota exhausted (1450 calls a day on the free plan).
export class ViCareRateLimitError extends ViCareError {
  /**
   * @param {string} message
   * @param {number} resetAt - When the quota renews, in ms since the epoch.
   */
  constructor(message, resetAt) {
    super(message, { status: 429, errorType: 'RATE_LIMIT_EXCEEDED' });
    this.name = 'ViCareRateLimitError';
    this.resetAt = resetAt;
  }
}

// The cloud cannot reach the gateway or the appliance (offline, unplugged).
export class ViCareDeviceCommunicationError extends ViCareError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ViCareDeviceCommunicationError';
  }
}
