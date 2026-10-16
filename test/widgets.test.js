// The "Heating schedule" dashboard widget, built from the fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { DeviceRegistry } from '../src/devices/index.js';
import { FeatureSet } from '../src/vicare/features.js';
import { curveParams, programLabel, scheduleContent } from '../src/widgets/heatingSchedule.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  BOILER_GATEWAY,
  HEATPUMP_GATEWAY,
  INSTALLATION_ID,
  fixture,
} from './helpers/fakeViCare.js';

const gladys = createFakeGladys();

function registry() {
  const devices = (serial) =>
    fixture('installations')
      .data[0].gateways.find((g) => g.serial === serial)
      .devices.filter((d) => d.deviceType === 'heating')
      .map((d) => ({ id: d.id, modelId: d.modelId }));
  const result = new DeviceRegistry(gladys);
  result.update({
    installationCount: 1,
    gateways: [
      {
        installationId: INSTALLATION_ID,
        serial: BOILER_GATEWAY,
        devices: devices(BOILER_GATEWAY),
        features: fixture('gateway-boiler').data,
      },
      {
        installationId: INSTALLATION_ID,
        serial: HEATPUMP_GATEWAY,
        devices: devices(HEATPUMP_GATEWAY),
        features: fixture('gateway-heatpump').data,
      },
    ],
  });
  return result;
}

function content(externalId) {
  const units = registry();
  const unit = units.unit(externalId);
  return scheduleContent({
    unit,
    features: unit && units.featuresOf(unit.target),
    ttlSeconds: 120,
  });
}

const boilerCircuit = gladys.externalIds('heating-circuit', `${BOILER_GATEWAY}-0-0`).device;
const heatPumpCircuit = gladys.externalIds('heating-circuit', `${HEATPUMP_GATEWAY}-0-0`).device;

const byType = (components, type) => components.filter((c) => c.type === type);

test('the boiler circuit content fits the Gladys vocabulary and budget', () => {
  const result = content(boilerCircuit);
  assert.deepEqual(validateWidgetContent(result), []);
  assert.equal(result.ttl_seconds, 120);
});

test('the tiles: active program, live setpoint, heating curve', () => {
  const [program, setpoint, slope, shift] = byType(content(boilerCircuit).components, 'value');
  assert.deepEqual(program.value, { en: 'Standby', fr: 'Veille' });
  assert.equal(setpoint.device_feature, `${boilerCircuit}:target-temperature`);
  assert.equal(setpoint.value, undefined);
  assert.equal(slope.value, 1.2);
  assert.equal(shift.value, 4);
});

test('the week: one row a day, Monday first, plus what runs outside the slots', () => {
  const { components } = content(boilerCircuit);
  const [status] = byType(components, 'status');
  assert.equal(status.items.length, 7);
  assert.deepEqual(status.items[0].label, { en: 'Monday', fr: 'Lundi' });
  assert.deepEqual(status.items[0].value, { en: '05:30-22:00', fr: '05:30-22:00' });
  assert.deepEqual(status.items[6].label, { en: 'Sunday', fr: 'Dimanche' });
  assert.deepEqual(status.items[4].value, { en: '05:30-23:00', fr: '05:30-23:00' });
  const [caption] = byType(components, 'text');
  assert.equal(caption.variant, 'caption');
  assert.deepEqual(caption.text, {
    en: 'Outside the slots: Reduced (22 °C)',
    fr: 'Hors plages : Réduit (22 °C)',
  });
});

test('a non-normal slot is named, and a crowded day is cut between two slots', () => {
  const result = content(heatPumpCircuit);
  assert.deepEqual(validateWidgetContent(result), []);
  const [program] = byType(result.components, 'value');
  assert.deepEqual(program.value, { en: 'Normal', fr: 'Normal' });
  const [status] = byType(result.components, 'status');
  assert.deepEqual(status.items[0].value, {
    en: '00:00-03:00, 03:00-05:00 Comfort, …',
    fr: '00:00-03:00, 03:00-05:00 Confort, …',
  });
  const [caption] = byType(result.components, 'text');
  assert.equal(caption.text.fr, 'Hors plages : Réduit (18 °C)');
});

test('the heating curve button opens a form pre-filled with the current curve', () => {
  const [button] = byType(content(boilerCircuit).components, 'button');
  assert.equal(button.action.key, 'set_curve');
  const [slope, shift] = button.action.fields;
  assert.deepEqual(
    { key: slope.key, type: slope.type, min: slope.min, max: slope.max, default: slope.default },
    { key: 'slope', type: 'number', min: 0.2, max: 3.5, default: 1.2 },
  );
  assert.deepEqual(
    { key: shift.key, min: shift.min, max: shift.max, default: shift.default },
    { key: 'shift', min: -13, max: 40, default: 4 },
  );
  assert.equal(slope.description.fr, 'De 0.2 à 3.5, par pas de 0.1.');
});

test('a day without slot runs the default program', () => {
  const units = registry();
  const unit = units.unit(boilerCircuit);
  const features = units.featuresOf(unit.target);
  features.get('heating.circuits.0.heating.schedule').properties.entries.value.sun = [];
  const [status] = byType(
    scheduleContent({ unit, features, ttlSeconds: 120 }).components,
    'status',
  );
  assert.deepEqual(status.items[6].value, { en: 'Reduced', fr: 'Réduit' });
});

test('a device that is not a heating circuit gets an explanation', () => {
  const dhw = gladys.externalIds('dhw', `${BOILER_GATEWAY}-0`).device;
  for (const externalId of [dhw, 'ext:viessmann-test:unknown', undefined]) {
    const result = content(externalId);
    assert.deepEqual(validateWidgetContent(result), []);
    assert.equal(result.components.length, 1);
    assert.match(result.components[0].text.fr, /Choisissez un circuit de chauffage/);
  }
});

test('a circuit exposing nothing of the widget says so', () => {
  const unit = registry().unit(boilerCircuit);
  const result = scheduleContent({
    unit: { ...unit, featureExternalId: () => null },
    features: new FeatureSet([]),
    ttlSeconds: 120,
  });
  assert.equal(result.components.length, 1);
  assert.match(result.components[0].text.en, /no schedule nor heating curve/);
});

test('program labels: heat pump suffixes are dropped, unknown names kept', () => {
  assert.deepEqual(programLabel('reducedHeating'), { en: 'Reduced', fr: 'Réduit' });
  assert.deepEqual(programLabel('comfortEnergySaving'), { en: 'Eco', fr: 'Éco' });
  assert.deepEqual(programLabel('somethingNew'), { en: 'somethingNew', fr: 'somethingNew' });
});

test('the curve form values are brought within the appliance constraints', () => {
  const command = fixture('gateway-boiler').data.find(
    (f) => f.feature === 'heating.circuits.0.heating.curve',
  ).commands.setCurve;
  assert.deepEqual(curveParams(command, { slope: 1.23, shift: 4.4 }), { slope: 1.2, shift: 4 });
  assert.deepEqual(curveParams(command, { slope: '9', shift: '-20' }), { slope: 3.5, shift: -13 });
  assert.equal(curveParams(command, { slope: '', shift: 4 }), null);
  assert.equal(curveParams(command, { slope: 1.2 }), null);
});
