// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers: these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, POLL_INTERVAL_BOUNDS, TOKEN_KEYS } from '../src/config.js';
import { registerHandlers } from '../src/app.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// The first Gladys release knowing the water-heater category and the
// thermostat mode / operating-state features.
const MIN_GLADYS_VERSION = [5, 1, 0];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

const allFields = [
  ...manifest.config_schema,
  ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
];

test('every manifest action has a registered handler', () => {
  const gladys = createFakeGladys();
  const app = registerHandlers(gladys);
  app.stop();
  for (const action of manifest.actions ?? []) {
    assert.equal(
      typeof gladys.handlers[`action:${action.key}`],
      'function',
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('the account is linked through an oauth2 field, with OAuth handlers registered', () => {
  const oauthFields = manifest.config_schema.filter((f) => f.type === 'oauth2');
  assert.equal(oauthFields.length, 1);
  assert.equal(oauthFields[0].default, undefined, 'an oauth2 field holds no value');
  const gladys = createFakeGladys();
  registerHandlers(gladys).stop();
  assert.equal(typeof gladys.handlers.oauthAuthorizeUrl, 'function');
  assert.equal(typeof gladys.handlers.oauthCallback, 'function');
});

test('the token keys stay out of the config_schema (internal storage)', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  for (const key of TOKEN_KEYS) {
    assert.ok(!keys.includes(key), `"${key}" must not be shown in the Configuration screen`);
  }
});

test('gladys_version covers the device features the integration publishes', () => {
  assert.ok(
    isAtLeast(minGladysVersion(), MIN_GLADYS_VERSION),
    `gladys_version must start at 5.1.0 or later, got "${manifest.gladys_version}"`,
  );
});

test('catalog categories: 1 to 3 entries', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('config_schema defaults and bounds stay consistent with src/config.js', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const interval = manifest.config_schema.find((f) => f.key === 'poll_interval');
  assert.equal(interval.min, POLL_INTERVAL_BOUNDS.min);
  assert.equal(interval.max, POLL_INTERVAL_BOUNDS.max);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}" has no placeholder`);
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(section.description.en.length <= 1000);
    assert.ok(section.description.fr.length <= 1000);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

// Gladys draws the Save configuration button at the bottom of the form and
// Connect needs the saved client ID: every field to save comes first, then a
// section introducing the account step.
test('the Connect button comes after every field to save, in its own section', () => {
  const schema = manifest.config_schema;
  const oauthIndex = schema.findIndex((f) => f.type === 'oauth2');
  const savable = schema.filter((f) => f.type !== 'section' && f.type !== 'oauth2');
  for (const field of savable) {
    assert.ok(schema.indexOf(field) < oauthIndex, `"${field.key}" must come before Connect`);
  }
  assert.equal(schema[oauthIndex - 1].type, 'section', 'a section must introduce Connect');
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('every text is a multi-language object with English and French', () => {
  const texts = [
    manifest.description,
    ...allFields.flatMap((f) => [f.label, f.description, f.placeholder]),
    ...allFields.flatMap((f) => (f.links ?? []).map((link) => link.label)),
    ...(manifest.actions ?? []).map((action) => action.label),
  ].filter((text) => text !== undefined);
  for (const text of texts) {
    assert.equal(typeof text, 'object', `plain string found: ${JSON.stringify(text)}`);
    assert.ok(text.en && text.fr, `missing translation: ${JSON.stringify(text)}`);
  }
});
