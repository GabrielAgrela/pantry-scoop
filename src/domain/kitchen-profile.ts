import { ValidationError } from './errors.ts';

/** A piece of kitchen equipment and whatever about it shapes a recipe (capacity, limits, quirks). */
export interface Appliance {
  readonly name: string;
  readonly details: string;
}

/** Everything about the user's kitchen that shapes a recipe but is not an ingredient. */
export interface KitchenProfile {
  readonly appliances: readonly Appliance[];
  /** Default number of people to cook for. */
  readonly servings: number;
  readonly units: string;
  readonly language: string;
  readonly preferences: string;
}

export const ICE_CREAM_MACHINE: Appliance = {
  name: 'Cecotec Gelacy 1200 Touch ice-cream machine',
  details: 'Compressor, 1.2 L bowl. Total mix before churning must be 700–850 ml. Churn 30–40 min.',
};

export const DEFAULT_PROFILE: KitchenProfile = {
  appliances: [
    ICE_CREAM_MACHINE,
    { name: 'Freezer', details: 'Around -15 ºC: plan for scoopability of frozen desserts.' },
    { name: 'Hob', details: '' },
    { name: 'Oven', details: '' },
    { name: 'Blender', details: '' },
  ],
  servings: 2,
  units: 'ml and spoons (tbsp/tsp), not grams',
  language: 'English instructions, Portuguese ingredient names as on the packaging',
  preferences: [
    'Always include calorie and sugar estimates.',
    'Ice cream: low-sugar homemade ice cream gets too hard in my freezer, so include texture fixes (vodka, glycerine, fat balance, xanthan).',
    'Sweeteners I use: erythritol, Canderel, aspartame.',
    'Avoid boring recipes (e.g. ice cream that is just Greek yogurt + flavour).',
  ].join('\n'),
};

export const PROFILE_LIMITS = { maxAppliances: 20, maxNameLength: 80, maxDetailsLength: 500, maxTextLength: 2000, maxServings: 20 } as const;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} is too long.`);
  return trimmed;
}

function appliance(value: unknown, index: number): Appliance {
  if (typeof value !== 'object' || value === null) throw new ValidationError(`Appliance ${index + 1} must be an object.`);
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, `Appliance ${index + 1} name`, PROFILE_LIMITS.maxNameLength);
  if (name === '') throw new ValidationError(`Appliance ${index + 1} needs a name.`);
  return { name, details: text(raw.details ?? '', `${name} details`, PROFILE_LIMITS.maxDetailsLength) };
}

function appliances(value: unknown): Appliance[] {
  if (!Array.isArray(value)) throw new ValidationError('appliances must be a list.');
  if (value.length > PROFILE_LIMITS.maxAppliances) {
    throw new ValidationError(`At most ${PROFILE_LIMITS.maxAppliances} appliances.`);
  }
  return value.map(appliance);
}

function servings(value: unknown): number {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num) || num < 1 || num > PROFILE_LIMITS.maxServings) {
    throw new ValidationError(`servings must be a whole number between 1 and ${PROFILE_LIMITS.maxServings}.`);
  }
  return num;
}

/** Merges a (partial) update onto a base profile; unknown keys are ignored. */
export function mergeProfile(base: KitchenProfile, input: unknown): KitchenProfile {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Profile must be an object.');
  const raw = input as Record<string, unknown>;
  const pick = <T>(key: keyof KitchenProfile, parse: (value: unknown) => T, fallback: T): T =>
    raw[key] === undefined ? fallback : parse(raw[key]);

  return {
    appliances: pick('appliances', appliances, base.appliances),
    servings: pick('servings', servings, base.servings),
    units: pick('units', (v) => text(v, 'units', PROFILE_LIMITS.maxTextLength), base.units),
    language: pick('language', (v) => text(v, 'language', PROFILE_LIMITS.maxTextLength), base.language),
    preferences: pick('preferences', (v) => text(v, 'preferences', PROFILE_LIMITS.maxTextLength), base.preferences),
  };
}
