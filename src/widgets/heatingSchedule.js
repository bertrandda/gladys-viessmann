// -----------------------------------------------------------------------------
// Dashboard widget "Heating schedule": the ViCare weekly schedule, the active
// program and the heating curve of one heating circuit.
//
// Everything comes from the features the poller already holds (the schedule
// and the curve are part of the one-call gateway read): showing the widget
// never costs an API call. The only write is the heating curve, from the form
// behind the button (Gladys 5.2: a 5.1 core relays the tap without the form).
// The schedule itself stays edited in the ViCare app.
// -----------------------------------------------------------------------------

import { constrain, constraints } from '../vicare/features.js';

export const WIDGET_KEY = 'heating_schedule';
export const SET_CURVE_ACTION = 'set_curve';

// Gladys caps: a status value at 40 characters, a tile value at 12.
const STATUS_VALUE_MAX = 40;
const TILE_VALUE_MAX = 12;

const DAYS = [
  ['mon', { en: 'Monday', fr: 'Lundi' }],
  ['tue', { en: 'Tuesday', fr: 'Mardi' }],
  ['wed', { en: 'Wednesday', fr: 'Mercredi' }],
  ['thu', { en: 'Thursday', fr: 'Jeudi' }],
  ['fri', { en: 'Friday', fr: 'Vendredi' }],
  ['sat', { en: 'Saturday', fr: 'Samedi' }],
  ['sun', { en: 'Sunday', fr: 'Dimanche' }],
];

// ViCare program names, once stripped of the heat pump suffixes
// (normalHeating, reducedEnergySaving...). Each label fits a tile (12).
const PROGRAM_LABELS = {
  normal: { en: 'Normal', fr: 'Normal' },
  reduced: { en: 'Reduced', fr: 'Réduit' },
  comfort: { en: 'Comfort', fr: 'Confort' },
  eco: { en: 'Eco', fr: 'Éco' },
  standby: { en: 'Standby', fr: 'Veille' },
  fixed: { en: 'Fixed', fr: 'Fixe' },
  summerEco: { en: 'Summer eco', fr: 'Été éco' },
  forcedLastFromSchedule: { en: 'Extended', fr: 'Prolongé' },
  holiday: { en: 'Holiday', fr: 'Vacances' },
  holidayAtHome: { en: 'At home', fr: 'À la maison' },
  frostprotection: { en: 'Frost guard', fr: 'Hors-gel' },
  manual: { en: 'Manual', fr: 'Manuel' },
};

const LANGUAGES = ['en', 'fr'];

const circuitPrefix = (circuit) => `heating.circuits.${circuit}`;
export const curveFeature = (circuit) => `${circuitPrefix(circuit)}.heating.curve`;
const scheduleFeature = (circuit) => `${circuitPrefix(circuit)}.heating.schedule`;
const programFeature = (circuit, program) =>
  `${circuitPrefix(circuit)}.operating.programs.${program}`;

/** Apply `fn` to each language of the widget texts. */
const localized = (fn) => Object.fromEntries(LANGUAGES.map((lang) => [lang, fn(lang)]));

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Readable label of a ViCare program or schedule mode, in both languages.
 * @param {string} program - `normal`, `reducedHeating`, `comfortEnergySaving`...
 */
export function programLabel(program) {
  if (PROGRAM_LABELS[program]) {
    return PROGRAM_LABELS[program];
  }
  if (/EnergySaving$/.test(program)) {
    return PROGRAM_LABELS.eco;
  }
  const base = program.replace(/(Heating|Cooling)$/, '');
  return PROGRAM_LABELS[base] ?? { en: program, fr: program };
}

/**
 * Temperature of the program a schedule mode stands for: `programs.reduced`
 * on boilers, `programs.reducedHeating` on heat pumps.
 */
function programTemperature(features, circuit, mode) {
  for (const program of [mode, `${mode}Heating`]) {
    const temperature = features.number(programFeature(circuit, program), 'temperature');
    if (temperature !== undefined) {
      return temperature;
    }
  }
  return undefined;
}

/** "03:00-05:00 Comfort, 05:30-22:00" for one day, in one language. */
function daySlots(entries, defaultMode, lang) {
  const slots = [...(entries ?? [])]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map((entry) => {
      const range = `${entry.start}-${entry.end}`;
      return entry.mode === 'normal' ? range : `${range} ${programLabel(entry.mode)[lang]}`;
    });
  if (slots.length === 0) {
    return defaultMode ? programLabel(defaultMode)[lang] : '-';
  }
  // Cut between two slots rather than in the middle of a time.
  let text = '';
  for (const [index, slot] of slots.entries()) {
    const next = text ? `${text}, ${slot}` : slot;
    const reserve = index < slots.length - 1 ? ', …'.length : 0;
    if (next.length + reserve > STATUS_VALUE_MAX) {
      return text ? `${text}, …` : truncate(slot, STATUS_VALUE_MAX);
    }
    text = next;
  }
  return text;
}

/**
 * The `setCurve` command of a circuit, undefined when the curve is read-only
 * or absent.
 * @param {import('../vicare/features.js').FeatureSet} features
 * @param {string} circuit
 */
export function curveCommand(features, circuit) {
  return features.command(curveFeature(circuit), 'setCurve');
}

/**
 * Parameters of `setCurve` from the widget form, brought within the
 * appliance's constraints. Null when a value is not a number.
 * @param {object} command - The `setCurve` command.
 * @param {{ slope?: unknown, shift?: unknown }} values - The form values.
 */
export function curveParams(command, values) {
  // The core validates the form; a string value still parses ("1.2"), an
  // empty one must not become 0.
  const toNumber = (value) => (value === '' || value === null ? NaN : Number(value));
  const slope = toNumber(values?.slope);
  const shift = toNumber(values?.shift);
  if (!Number.isFinite(slope) || !Number.isFinite(shift)) {
    return null;
  }
  return {
    slope: constrain(slope, constraints(command, 'slope')),
    shift: constrain(shift, constraints(command, 'shift')),
  };
}

function curveField(key, label, command, value) {
  const { min, max, stepping } = constraints(command, key);
  const field = { key, type: 'number', label, required: true };
  if (typeof min === 'number') {
    field.min = min;
  }
  if (typeof max === 'number') {
    field.max = max;
  }
  if (typeof min === 'number' && typeof max === 'number') {
    field.description = {
      en: `From ${min} to ${max}${stepping ? `, in steps of ${stepping}` : ''}.`,
      fr: `De ${min} à ${max}${stepping ? `, par pas de ${stepping}` : ''}.`,
    };
  }
  if (typeof value === 'number') {
    field.default = value;
  }
  return field;
}

/** A content made of one explanation. */
export function messageContent(text, ttlSeconds) {
  return { ttl_seconds: ttlSeconds, components: [{ type: 'text', text }] };
}

/**
 * Content of the widget for one unit. The components come in priority order:
 * the core drops the last ones when a cap is reached.
 * @param {object} options
 * @param {object | undefined} options.unit - Unit chosen in the widget settings.
 * @param {import('../vicare/features.js').FeatureSet} options.features - Its latest features.
 * @param {number} options.ttlSeconds - How long Gladys may cache the content.
 */
export function scheduleContent({ unit, features, ttlSeconds }) {
  const circuit = unit?.target?.circuit;
  if (circuit === undefined) {
    return messageContent(
      {
        en: 'Choose a heating circuit of the integration in the widget settings.',
        fr: "Choisissez un circuit de chauffage de l'intégration dans les réglages du widget.",
      },
      ttlSeconds,
    );
  }

  const components = [];

  const active = features.value(`${circuitPrefix(circuit)}.operating.programs.active`);
  if (typeof active === 'string' && active) {
    components.push({
      type: 'value',
      label: { en: 'Program', fr: 'Programme' },
      icon: 'clock',
      value: localized((lang) => truncate(programLabel(active)[lang], TILE_VALUE_MAX)),
    });
  }

  const setpoint = unit.featureExternalId('target-temperature');
  if (setpoint) {
    components.push({
      type: 'value',
      label: { en: 'Setpoint', fr: 'Consigne' },
      icon: 'thermometer',
      device_feature: setpoint,
    });
  }

  const slope = features.number(curveFeature(circuit), 'slope');
  const shift = features.number(curveFeature(circuit), 'shift');
  if (slope !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'Curve slope', fr: 'Pente' },
      icon: 'trending-up',
      value: slope,
    });
  }
  if (shift !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'Curve shift', fr: 'Parallèle' },
      icon: 'sliders',
      value: shift,
    });
  }

  const schedule = features.get(scheduleFeature(circuit));
  const entries = schedule?.properties?.entries?.value;
  if (entries && typeof entries === 'object') {
    const defaultMode = constraints(schedule.commands?.setSchedule, 'newSchedule').defaultMode;
    components.push({
      type: 'status',
      items: DAYS.map(([day, label]) => ({
        label,
        value: localized((lang) => daySlots(entries[day], defaultMode, lang)),
      })),
    });
    if (defaultMode) {
      const temperature = programTemperature(features, circuit, defaultMode);
      const suffix = temperature === undefined ? '' : ` (${temperature} °C)`;
      const program = programLabel(defaultMode);
      components.push({
        type: 'text',
        variant: 'caption',
        text: {
          en: `Outside the slots: ${program.en}${suffix}`,
          fr: `Hors plages : ${program.fr}${suffix}`,
        },
      });
    }
  }

  const command = curveCommand(features, circuit);
  if (command && slope !== undefined && shift !== undefined) {
    components.push({
      type: 'button',
      label: { en: 'Heating curve', fr: 'Courbe de chauffe' },
      icon: 'sliders',
      style: 'secondary',
      action: {
        key: SET_CURVE_ACTION,
        fields: [
          curveField('slope', { en: 'Slope', fr: 'Pente' }, command, slope),
          curveField('shift', { en: 'Shift', fr: 'Parallèle' }, command, shift),
        ],
      },
    });
  }

  if (components.length === 0) {
    return messageContent(
      {
        en: 'This circuit exposes no schedule nor heating curve.',
        fr: "Ce circuit n'expose ni planning ni courbe de chauffe.",
      },
      ttlSeconds,
    );
  }
  return { ttl_seconds: ttlSeconds, components };
}
