import { ValidationError } from './errors.ts';
import { normalizeName } from './text.ts';
import { pantryBasicsSelection } from './pantry-basics.ts';

/** A piece of kitchen equipment and whatever about it shapes a recipe (capacity, limits, quirks). */
export interface Appliance {
  readonly name: string;
  readonly details: string;
  readonly emoji?: string;
}

/** A kind of dish the user asks for, and what it means to them (e.g. "made in the ice-cream machine"). */
export interface DishType {
  readonly name: string;
  readonly details: string;
}

/** Reserved for "no preference" in a suggestion request, so no dish type may be called that. */
export const ANY_DISH = 'any';

/** Everything about the user's kitchen that shapes a recipe but is not an ingredient. */
export interface KitchenProfile {
  readonly appliances: readonly Appliance[];
  readonly dishTypes: readonly DishType[];
  /** Default number of people to cook for. */
  readonly servings: number;
  readonly units: string;
  readonly language: string;
  readonly preferences: string;
  /** Missing on kitchens saved before guided setup existed. */
  readonly setupComplete?: boolean;
  readonly setupStep?: number;
  /** Confirmed starter choices; missing means the basics have not been reviewed yet. */
  readonly pantryBasics?: readonly string[];
}

export const ICE_CREAM_MACHINE: Appliance = {
  name: 'Cecotec Gelacy 1200 Touch ice-cream machine',
  details: 'Compressor, 1.2 L bowl. Total mix before churning must be 700–850 ml. Churn 30–40 min.',
};

export const LEGACY_PROFILE: KitchenProfile = {
  appliances: [
    ICE_CREAM_MACHINE,
    { name: 'Freezer', details: 'Around -15 ºC: plan for scoopability of frozen desserts.' },
    { name: 'Hob', details: '' },
    { name: 'Oven', details: '' },
    { name: 'Blender', details: '' },
  ],
  dishTypes: [
    { name: 'Dinner', details: 'Main course, lunch or dinner' },
    { name: 'Breakfast', details: '' },
    { name: 'Dessert', details: '' },
    { name: 'Ice cream', details: 'Frozen dessert made in the ice-cream machine' },
    { name: 'Side dish', details: '' },
    { name: 'Snack', details: '' },
    { name: 'Baking', details: 'Cakes, bread, biscuits…' },
    { name: 'Drink', details: 'Smoothie, shake, cocktail…' },
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

/** Common starting choices, reviewed in setup; no model, capacity or personal diet is assumed. */
export const DEFAULT_PROFILE: KitchenProfile = {
  appliances: [
    { name: 'Oven', details: '', emoji: '♨️' },
    { name: 'Microwave', details: '', emoji: '📻' },
    { name: 'Fridge', details: '', emoji: '🧊' },
    { name: 'Air fryer', details: '', emoji: '🍟' },
    { name: 'Hob', details: '', emoji: '🍳' },
    { name: 'Freezer', details: '', emoji: '❄️' },
  ],
  dishTypes: LEGACY_PROFILE.dishTypes.map((dish) => dish.name === 'Ice cream'
    ? { ...dish, details: 'Frozen desserts, including ice cream and sorbet' }
    : { ...dish }),
  servings: 2,
  units: 'Metric (g, ml, °C)',
  language: 'English',
  preferences: '',
  setupComplete: false,
  setupStep: 0,
  pantryBasics: undefined,
};

export const PROFILE_LIMITS = { maxAppliances: 20, maxDishTypes: 20, maxNameLength: 80, maxDetailsLength: 500, maxTextLength: 2000, maxServings: 20 } as const;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} is too long.`);
  return trimmed;
}

/** A name plus free-text details: the shape shared by appliances and dish types. */
function namedEntry(value: unknown, index: number, label: string): { name: string; details: string } {
  if (typeof value !== 'object' || value === null) throw new ValidationError(`${label} ${index + 1} must be an object.`);
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, `${label} ${index + 1} name`, PROFILE_LIMITS.maxNameLength);
  if (name === '') throw new ValidationError(`${label} ${index + 1} needs a name.`);
  return { name, details: text(raw.details ?? '', `${name} details`, PROFILE_LIMITS.maxDetailsLength) };
}

function appliances(value: unknown): Appliance[] {
  if (!Array.isArray(value)) throw new ValidationError('appliances must be a list.');
  if (value.length > PROFILE_LIMITS.maxAppliances) {
    throw new ValidationError(`At most ${PROFILE_LIMITS.maxAppliances} appliances.`);
  }
  return value.map((entry, index) => {
    const appliance = namedEntry(entry, index, 'Appliance');
    const raw = entry as Record<string, unknown>;
    if (raw.emoji === undefined) return appliance;
    const emoji = text(raw.emoji, `${appliance.name} emoji`, 32);
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
    if (segments.length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)) {
      throw new ValidationError(`${appliance.name} emoji must be a single emoji.`);
    }
    return { ...appliance, emoji };
  });
}

function dishTypes(value: unknown): DishType[] {
  if (!Array.isArray(value)) throw new ValidationError('dishTypes must be a list.');
  if (value.length > PROFILE_LIMITS.maxDishTypes) {
    throw new ValidationError(`At most ${PROFILE_LIMITS.maxDishTypes} dish types.`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const dish = namedEntry(entry, index, 'Dish type');
    const key = normalizeName(dish.name);
    if (key === ANY_DISH || key === 'any dish') throw new ValidationError(`"${dish.name}" is reserved. Pick another name.`);
    if (seen.has(key)) throw new ValidationError(`There is already a dish type called "${dish.name}".`);
    seen.add(key);
    return dish;
  });
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
    dishTypes: pick('dishTypes', dishTypes, base.dishTypes),
    servings: pick('servings', servings, base.servings),
    units: pick('units', (v) => text(v, 'units', PROFILE_LIMITS.maxTextLength), base.units),
    language: pick('language', (v) => text(v, 'language', PROFILE_LIMITS.maxTextLength), base.language),
    preferences: pick('preferences', (v) => text(v, 'preferences', PROFILE_LIMITS.maxTextLength), base.preferences),
    pantryBasics: pick('pantryBasics', pantryBasicsSelection, base.pantryBasics),
    setupComplete: pick('setupComplete', (v) => {
      if (typeof v !== 'boolean') throw new ValidationError('setupComplete must be a boolean.');
      return v;
    }, base.setupComplete),
    setupStep: pick('setupStep', (v) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 2) throw new ValidationError('setupStep must be between 0 and 2.');
      return v;
    }, base.setupStep),
  };
}
