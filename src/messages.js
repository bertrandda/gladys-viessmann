// -----------------------------------------------------------------------------
// User-facing messages (connection status, action results), English + French.
// -----------------------------------------------------------------------------

import { ViCareAuthError, ViCareRateLimitError } from './vicare/errors.js';

export const MESSAGES = {
  missingClientId: {
    en: 'Enter the client ID of your Viessmann developer application, save, then click Connect.',
    fr: "Saisissez l'identifiant client (client ID) de votre application développeur Viessmann, enregistrez, puis cliquez sur Connecter.",
  },
  notLinked: {
    en: 'Click Connect to link your ViCare account.',
    fr: 'Cliquez sur Connecter pour lier votre compte ViCare.',
  },
  authExpired: {
    en: 'The ViCare authorization expired or was revoked: click Connect again.',
    fr: "L'autorisation ViCare a expiré ou a été révoquée : cliquez à nouveau sur Connecter.",
  },
};

/** "14:05 UTC" */
function utcTime(timestamp) {
  return `${new Date(timestamp).toISOString().slice(11, 16)} UTC`;
}

/**
 * Message explaining an error to the user.
 * @param {Error} err
 */
export function errorMessage(err) {
  if (err instanceof ViCareAuthError) {
    return MESSAGES.authExpired;
  }
  if (err instanceof ViCareRateLimitError) {
    const time = utcTime(err.resetAt);
    return {
      en: `ViCare API daily quota reached: the integration resumes at ${time}.`,
      fr: `Quota journalier de l'API ViCare atteint : l'intégration reprend à ${time}.`,
    };
  }
  return {
    en: `ViCare API error (${err.message}), retrying at the next refresh.`,
    fr: `Erreur de l'API ViCare (${err.message}), nouvel essai au prochain rafraîchissement.`,
  };
}
