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

// Errors of the Connect flow: a thrown error carries a single string, so it
// holds both languages.
export const OAUTH_ERRORS = {
  saveClientIdFirst:
    'Save the configuration with the client ID first, then click Connect. / ' +
    "Enregistrez d'abord la configuration avec l'identifiant client, puis cliquez sur Connecter.",
  unknownAuthorization:
    'Unknown or expired authorization: click Connect again. / ' +
    'Autorisation inconnue ou expirée : cliquez à nouveau sur Connecter.',
};

// Answers of the heating schedule widget (src/widgets/heatingSchedule.js).
export const WIDGET_MESSAGES = {
  notLinked: {
    en: 'The integration is not connected to ViCare yet: see its Configuration tab.',
    fr: "L'intégration n'est pas encore connectée à ViCare : voir son onglet Configuration.",
  },
  curveNeedsForm: {
    en: 'Changing the heating curve from the dashboard needs Gladys 5.2 or later.',
    fr: 'Modifier la courbe de chauffe depuis le tableau de bord demande Gladys 5.2 ou plus récent.',
  },
};

/** Toast confirming a heating curve change. */
export function curveSetMessage({ slope, shift }) {
  return {
    en: `Heating curve sent: slope ${slope}, shift ${shift}.`,
    fr: `Courbe de chauffe envoyée : pente ${slope}, parallèle ${shift}.`,
  };
}

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
