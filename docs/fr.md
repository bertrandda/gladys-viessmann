# Viessmann ViCare

Cette intégration connecte à Gladys les chaudières (gaz, fioul) et pompes à
chaleur Viessmann reliées à l'application **ViCare**, via le cloud Viessmann :
chauffage, eau chaude sanitaire, températures et consommations.

## Prérequis

- Un appareil Viessmann visible dans l'application ViCare (passerelle
  Vitoconnect ou passerelle intégrée).
- Votre compte ViCare (adresse e-mail et mot de passe).
- Gladys 5.1 ou plus récent, avec un accès à Internet.

## 1. Créer un client sur le portail développeur Viessmann

L'API ViCare demande un « client » personnel, gratuit, que vous créez une
seule fois :

1. Ouvrez le [portail développeur Viessmann](https://app.developer.viessmann-climatesolutions.com)
   et connectez-vous avec vos identifiants ViCare.
2. Créez un nouveau client (menu **Clients**).
3. Donnez-lui un nom (par exemple « Gladys ») et indiquez comme **URI de
   redirection** l'adresse affichée dans l'écran de configuration de
   l'intégration, sous le bouton **Connecter** :
   `https://my.gladysassistant.com/redirect/oauth`. L'adresse doit être
   identique au caractère près. Laissez les autres options par défaut.
4. Enregistrez, puis copiez l'**identifiant client** (Client ID). Aucun secret
   n'est nécessaire.

L'offre gratuite (« Basic ») suffit : elle autorise 1450 appels à l'API par
jour.

## 2. Configurer l'intégration dans Gladys

L'ordre compte : Gladys a besoin de l'identifiant client enregistré pour
lancer la connexion.

1. Dans l'onglet **Configuration** de l'intégration (étape 1 de l'écran),
   collez l'identifiant client.
2. Cliquez sur **Enregistrer la configuration**, en bas de la page. Le message
   en haut de l'écran commence alors par « Identifiant client enregistré ».
3. Seulement ensuite, à l'étape 2 (**Compte ViCare**), cliquez sur
   **Connecter**, connectez-vous avec votre compte ViCare et acceptez l'accès.
4. Le statut passe à « Connecté ». Le bouton **Tester la connexion** indique
   les installations, passerelles et appareils trouvés.
5. Dans l'onglet **Découverte**, ajoutez les appareils et placez chaque
   circuit de chauffage dans sa pièce.

## Appareils créés

Pour chaque chaudière ou pompe à chaleur, l'intégration propose jusqu'à trois
types d'appareils. Seules les fonctionnalités que votre modèle expose
réellement sont créées.

### Un thermostat par circuit de chauffage

| Fonctionnalité         | Description                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consigne               | Température du programme en cours (normal, réduit, confort…). La modifier change la température de ce programme, comme dans l'application ViCare. |
| Mode                   | Arrêt, chauffage, refroidissement ou automatique (voir le tableau ci-dessous).                                                                    |
| État de fonctionnement | Au repos, en chauffe ou en refroidissement, d'après le brûleur ou le compresseur.                                                                 |
| Température ambiante   | Si une sonde d'ambiance est raccordée au circuit.                                                                                                 |
| Température de départ  | Température de l'eau envoyée dans le circuit.                                                                                                     |

### L'eau chaude sanitaire (chauffe-eau)

| Fonctionnalité        | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| Consigne eau chaude   | Température demandée pour l'eau chaude.                                              |
| Mode eau chaude       | Sur les appareils récents (E3) et les pompes à chaleur (voir le tableau ci-dessous). |
| Charge ponctuelle     | Chauffe le ballon une fois, tout de suite.                                           |
| Chauffe en cours      | Le ballon est en cours de chauffe.                                                   |
| Température du ballon | Température mesurée dans le ballon.                                                  |

### Le générateur (chaudière ou pompe à chaleur)

Des capteurs en lecture seule : températures extérieure, de chaudière, de
départ et de retour (circuits primaire et secondaire sur les pompes à
chaleur), brûleur et compresseur (en marche, nombre de démarrages, heures de
fonctionnement), consommations du jour en gaz (m³ ou kWh selon le modèle) et
en électricité (kWh).

### Correspondance des modes

Mode d'un circuit de chauffage :

| Mode ViCare                                                 | Mode Gladys     |
| ----------------------------------------------------------- | --------------- |
| `standby`, `dhw` (eau chaude seule)                         | Arrêt           |
| `heating`, `dhwAndHeating`, `forcedNormal`, `forcedReduced` | Chauffage       |
| `cooling`                                                   | Refroidissement |
| `heatingCooling`, `dhwAndHeatingCooling`                    | Automatique     |

Mettre un circuit à l'**arrêt** depuis Gladys choisit `dhw` quand l'appareil
le permet : le chauffage s'arrête mais l'eau chaude continue d'être produite.
L'eau chaude se pilote séparément, avec l'appareil chauffe-eau.

Mode de l'eau chaude :

| Mode ViCare                                   | Mode Gladys |
| --------------------------------------------- | ----------- |
| `off`                                         | Arrêt       |
| `eco`, `efficient`, `efficientWithMinComfort` | Éco         |
| `balanced`                                    | Automatique |
| `comfort`                                     | Manuel      |

Un mode que votre appareil ne propose pas est refusé, avec un message qui
indique les modes acceptés.

## Rafraîchissement et quota

- L'intégration lit toutes les données d'une passerelle en **un seul appel**.
  L'intervalle par défaut (120 s) consomme environ 720 appels par jour sur les
  1450 autorisés. Avec plusieurs passerelles, l'intervalle est multiplié par
  leur nombre, pour rester dans le quota.
- Après une commande, la nouvelle valeur s'affiche tout de suite, puis
  l'appareil est relu une quinzaine de secondes plus tard pour confirmer.
- Si le quota est épuisé, l'intégration se met en pause jusqu'à son
  renouvellement. L'écran de configuration affiche l'heure de reprise (UTC).
  Augmentez alors l'intervalle de rafraîchissement.

## Limites connues

- Les **préréglages** (confort, éco, absence) ne sont pas encore proposés :
  Gladys 5.1 n'a pas de fonctionnalité de préréglage pour les thermostats.
- Quand le circuit est sur un programme sans température réglable (veille,
  hors-gel), la consigne n'est pas affichée et ne peut pas être modifiée.
- Ne sont pas encore pris en charge : la modulation du brûleur (Gladys n'a
  pas de catégorie adaptée), le solaire thermique, le photovoltaïque et les
  batteries, la ventilation, les thermostats et sondes Zigbee, la courbe de
  chauffe et les températures de chaque programme.
- Le pilotage passe uniquement par le cloud Viessmann : il faut une connexion
  à Internet.

## Dépannage

- **« Saisissez l'identifiant client… »** : collez le Client ID du portail
  développeur et cliquez sur **Enregistrer la configuration** avant de cliquer
  sur Connecter.
- **« Erreur au lancement de la connexion »** sous le bouton Connecter, avec
  **« L'identifiant client n'est pas encore enregistré… »** en haut de
  l'écran : cliquez sur **Enregistrer la configuration** en bas de la page,
  puis à nouveau sur **Connecter**.
- **Erreur de redirection lors de la connexion** : l'URI de redirection du
  client sur le portail doit être exactement celle affichée sous le bouton
  Connecter.
- **« L'autorisation ViCare a expiré ou a été révoquée »** : cliquez à nouveau
  sur **Connecter**. Changer d'identifiant client oblige aussi à se
  reconnecter.
- **« Quota journalier de l'API ViCare atteint »** : patientez jusqu'à l'heure
  indiquée et augmentez l'intervalle de rafraîchissement.
- **Une passerelle hors ligne** : ses appareils gardent leurs dernières
  valeurs, les autres continuent d'être mis à jour.
- Les logs de l'intégration détaillent chaque erreur. Ils ne contiennent
  jamais vos tokens.
