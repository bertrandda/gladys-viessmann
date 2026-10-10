# Gladys Viessmann ViCare

[Gladys Assistant](https://gladysassistant.com) external integration for
Viessmann boilers and heat pumps, through the ViCare cloud API. It is built on
the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js)
and the [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
and follows the behaviour of the Home Assistant
[ViCare integration](https://www.home-assistant.io/integrations/vicare/)
(PyViCare).

> Intégration Gladys pour les chaudières et pompes à chaleur Viessmann (ViCare).
> La documentation utilisateur en français est dans [`docs/fr.md`](docs/fr.md).

User documentation: [`docs/en.md`](docs/en.md) (English),
[`docs/fr.md`](docs/fr.md) (French). Gladys re-hosts these files and links them
from the Configuration screen.

## What it does

- **Account linking**: the manifest `oauth2` field renders a "Connect" button.
  The integration runs the OAuth2 authorization code flow with PKCE against the
  Viessmann IAM, using the client ID the user created on the Viessmann
  developer portal. Tokens are stored with `gladys.setConfig` under keys outside
  the `config_schema`, and refreshed automatically.
- **Devices**: for each `heating` appliance of the account, it creates
  - one **thermostat** per heating circuit: target temperature, mode, operating
    state, room and supply temperatures;
  - a **water heater** for domestic hot water: target temperature, mode, one-time
    charge, charging state, tank temperature;
  - a **heat generator** with read-only sensors: temperatures, burner and
    compressor activity, starts, hours, today's gas and power consumption.
    A feature is only published when the appliance reports it.
- **Refresh**: one API call per gateway reads every feature of every device
  behind it. The interval (120 s by default) is multiplied by the number of
  gateways, so the free plan quota (1450 calls a day) holds. An exhausted quota
  pauses the refresh until it renews.
- **Test the connection** button in the Configuration screen.

## Project structure

```
.
├─ index.js                     # SDK bootstrap (handlers live in src/app.js)
├─ src/
│  ├─ app.js                    # registerHandlers(gladys): every SDK handler
│  ├─ config.js                 # config defaults + normalization, token keys
│  ├─ modes.js                  # ViCare <-> Gladys mode mappings (Gladys enums)
│  ├─ messages.js               # bilingual status / action messages
│  ├─ actions.js                # "test_connection" manifest action
│  ├─ inventory.js              # installations -> gateways -> appliances
│  ├─ poller.js                 # refresh loop, quota handling, change detection
│  ├─ devices/
│  │  ├─ index.js               # registry: units, states, command routing
│  │  ├─ unit.js                # builds a Gladys device from feature specs
│  │  ├─ heatingCircuit.js      # thermostat per heating circuit
│  │  ├─ dhw.js                 # domestic hot water (water heater)
│  │  ├─ heatGenerator.js       # boiler / heat pump device
│  │  ├─ sensors.js             # table of the generator sensors
│  │  └─ heatSources.js         # burners and compressors
│  └─ vicare/
│     ├─ client.js              # API client: tokens, errors, endpoints
│     ├─ oauth.js               # PKCE, authorize URL, token requests
│     ├─ features.js            # read helpers over the ViCare features
│     ├─ errors.js              # typed errors (auth, quota, offline)
│     └─ constants.js           # endpoints and scopes
├─ docs/en.md, docs/fr.md       # user documentation
├─ test/                        # node --test, fake Gladys + fake ViCare cloud
└─ gladys-assistant-integration.json
```

To map a new ViCare sensor of the heat generator, add an entry to
[`src/devices/sensors.js`](src/devices/sensors.js). Thermostat and water heater
features are specs in [`heatingCircuit.js`](src/devices/heatingCircuit.js) and
[`dhw.js`](src/devices/dhw.js): `describe` (published only when the appliance
has the feature), `read` and, for commands, `write`.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="viessmann-vicare" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs in its container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test (no network: ViCare and Gladys are faked)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 and builds the Docker image.

## Publish

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. Run **Actions → Release → Run workflow** (`patch`, `minor` or `major`): it
   bumps the version in `package.json` and the manifest, tags, builds the
   multi-arch image to `ghcr.io/bertrandda/gladys-viessmann` and publishes the
   GitHub Release.
3. The repository needs the GitHub topic `gladys-assistant-integration` to be
   indexed by the Gladys store.

Replace [`cover.png`](cover.png) (800×534 px, ≤150 KB) with a real cover before
the first release: the current one is the template placeholder.

## License

Apache-2.0
