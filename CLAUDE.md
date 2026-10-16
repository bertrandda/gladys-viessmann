# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Viessmann boilers and heat
pumps: a Node.js service (Node 22+, ESM, no build step) running in its own
sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
(its only runtime dependency) and to the ViCare cloud API with the built-in
`fetch`. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "quota"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     SDK bootstrap only
src/app.js                   registerHandlers(gladys, { fetch, now }): every SDK handler
src/vicare/                  ViCare API: OAuth2 PKCE, client (tokens, typed errors), feature helpers
src/inventory.js             installations -> gateways -> heating appliances + their features
src/devices/                 Gladys devices built from feature specs (describe / read / write)
src/widgets/                 dashboard widgets, built from the features the poller holds
src/poller.js                own refresh loop (not Gladys onPoll): quota, change detection
src/modes.js                 ViCare <-> Gladys mode mappings, Gladys enum values
gladys-assistant-integration.json  manifest
docs/en.md, docs/fr.md       user documentation, re-hosted by Gladys (mandatory)
test/                        node --test; fake Gladys + fake ViCare (fetch) over JSON fixtures
```

## Rules

- **External ids are forever.** Devices use
  `gladys.externalIds(type, platformId)` with `platformId` built from the
  gateway serial and the ViCare device id (plus the circuit index), feature
  keys are the `key` of the specs. Changing one creates a new device in Gladys
  and orphans the old one, with its history and scenes.
- **The ViCare quota is small** (1450 calls a day on the free plan). One call
  per gateway reads everything; never add a per-device or per-feature call to
  the refresh loop.
- **Only publish what Gladys 5.1 knows.** Categories, types and units must
  exist in the published SDK _and_ in the Gladys release of the manifest
  `gladys_version` minimum (the thermostat `preset` type, for example, is not
  in Gladys 5.1). The SDK on npm can lag behind its GitHub README: check
  `node_modules`.
- **Never log tokens.** Tokens live in the Gladys config under keys outside
  the `config_schema` (`access_token`, `refresh_token`, `token_expires_at`).
  The container rootfs is read-only; nothing is written to disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **User-facing text** is bilingual (English and French): status and action
  messages (`src/messages.js`, `src/actions.js`), manifest texts, and
  `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
