import { DEFAULT_PROFILE, type KitchenProfile } from './kitchen-profile.ts';

/**
 * The interface languages. The client sends its choice in a header so starter data (appliances,
 * dish types, pantry basics) arrives in the same language as the screens around it, and Scoop
 * speaks with a voice that can pronounce it. Recipes follow the profile's free-text language.
 */
export const LANGUAGE_HEADER = 'x-pantry-language';
export const LANGUAGE_CODES = ['en', 'pt', 'es', 'fr'] as const;
export type LanguageCode = typeof LANGUAGE_CODES[number];

/** What the profile stores as the recipe language for each interface language; the client keeps the same names. */
const RECIPE_LANGUAGE: Record<LanguageCode, string> = {
  en: 'English', pt: 'Português (Portugal)', es: 'Español', fr: 'Français',
};

/** The same languages named in English, for prompts. */
const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English', pt: 'European Portuguese', es: 'Spanish', fr: 'French',
};

/** Kokoro voices per language. There is no European Portuguese voice, so Portuguese uses Dora (pt-BR). */
const VOICES: Record<LanguageCode, string> = { en: 'af_heart', pt: 'pf_dora', es: 'ef_dora', fr: 'ff_siwis' };

/**
 * English starter text to its translation. The client's dictionaries use the same English keys,
 * and a test checks they agree, so the setup screen's appliance names match the saved ones.
 */
export const STARTER_TRANSLATIONS: Record<Exclude<LanguageCode, 'en'>, Readonly<Record<string, string>>> = {
  pt: {
    Oven: 'Forno', Microwave: 'Micro-ondas', Fridge: 'Frigorífico', 'Air fryer': 'Fritadeira de ar', Hob: 'Placa',
    Freezer: 'Congelador', Blender: 'Liquidificadora', Toaster: 'Torradeira', Kettle: 'Chaleira',
    Dinner: 'Jantar', 'Main course, lunch or dinner': 'Prato principal, almoço ou jantar', Breakfast: 'Pequeno-almoço',
    Dessert: 'Sobremesa', 'Ice cream': 'Gelado', 'Frozen desserts, including ice cream and sorbet': 'Sobremesas geladas, incluindo gelado e sorvete',
    'Side dish': 'Acompanhamento', Snack: 'Lanche', Baking: 'Pastelaria', 'Cakes, bread, biscuits…': 'Bolos, pão, bolachas…',
    Drink: 'Bebida', 'Smoothie, shake, cocktail…': 'Smoothie, batido, cocktail…',
    Water: 'Água', Salt: 'Sal', 'Black pepper': 'Pimenta preta', Eggs: 'Ovos', Milk: 'Leite', 'Olive oil': 'Azeite',
    Flour: 'Farinha', Sugar: 'Açúcar', Rice: 'Arroz',
  },
  es: {
    Oven: 'Horno', Microwave: 'Microondas', Fridge: 'Nevera', 'Air fryer': 'Freidora de aire', Hob: 'Placa',
    Freezer: 'Congelador', Blender: 'Batidora', Toaster: 'Tostadora', Kettle: 'Hervidor',
    Dinner: 'Cena', 'Main course, lunch or dinner': 'Plato principal, comida o cena', Breakfast: 'Desayuno',
    Dessert: 'Postre', 'Ice cream': 'Helado', 'Frozen desserts, including ice cream and sorbet': 'Postres helados, incluidos helados y sorbetes',
    'Side dish': 'Guarnición', Snack: 'Tentempié', Baking: 'Repostería', 'Cakes, bread, biscuits…': 'Pasteles, pan, galletas…',
    Drink: 'Bebida', 'Smoothie, shake, cocktail…': 'Smoothie, batido, cóctel…',
    Water: 'Agua', Salt: 'Sal', 'Black pepper': 'Pimienta negra', Eggs: 'Huevos', Milk: 'Leche', 'Olive oil': 'Aceite de oliva',
    Flour: 'Harina', Sugar: 'Azúcar', Rice: 'Arroz',
  },
  fr: {
    Oven: 'Four', Microwave: 'Micro-ondes', Fridge: 'Réfrigérateur', 'Air fryer': 'Friteuse à air', Hob: 'Plaque de cuisson',
    Freezer: 'Congélateur', Blender: 'Mixeur', Toaster: 'Grille-pain', Kettle: 'Bouilloire',
    Dinner: 'Dîner', 'Main course, lunch or dinner': 'Plat principal, déjeuner ou dîner', Breakfast: 'Petit-déjeuner',
    Dessert: 'Dessert', 'Ice cream': 'Glace', 'Frozen desserts, including ice cream and sorbet': 'Desserts glacés, dont glaces et sorbets',
    'Side dish': 'Accompagnement', Snack: 'En-cas', Baking: 'Pâtisserie', 'Cakes, bread, biscuits…': 'Gâteaux, pain, biscuits…',
    Drink: 'Boisson', 'Smoothie, shake, cocktail…': 'Smoothie, milk-shake, cocktail…',
    Water: 'Eau', Salt: 'Sel', 'Black pepper': 'Poivre noir', Eggs: 'Œufs', Milk: 'Lait', 'Olive oil': 'Huile d’olive',
    Flour: 'Farine', Sugar: 'Sucre', Rice: 'Riz',
  },
};

/** A header value such as `pt` or `pt-PT`; anything unknown is English. */
export function languageCode(value: unknown): LanguageCode {
  const code = String(Array.isArray(value) ? value[0] : value ?? '').trim().toLowerCase().split('-')[0] ?? '';
  return (LANGUAGE_CODES as readonly string[]).includes(code) ? code as LanguageCode : 'en';
}

export function starterText(text: string, language: LanguageCode): string {
  return language === 'en' ? text : STARTER_TRANSLATIONS[language][text] ?? text;
}

export const speechVoice = (language: LanguageCode): string => VOICES[language];

/** Whether a profile's recipe language is one the language switcher sets (older free-text ones are left alone). */
export function isRecipeLanguage(text: string): boolean {
  const value = text.trim().toLocaleLowerCase();
  return Object.values(RECIPE_LANGUAGE).some((name) => name.toLocaleLowerCase() === value);
}

/**
 * The language the AI writes recipes in. Prompts and recipes stay in English and the cook reads a
 * translation; an older free-text language (e.g. "English steps, Portuguese ingredient names") is used as written.
 */
export const writingLanguage = (profileLanguage: string): string => isRecipeLanguage(profileLanguage) ? 'English' : profileLanguage;

/**
 * The kitchen's language, named for a prompt: a language the switcher sets by its English name, an
 * older free-text one (e.g. "English steps, Portuguese ingredient names") as written, English when blank.
 */
export function kitchenLanguage(profileLanguage: string): string {
  const value = profileLanguage.trim();
  const code = LANGUAGE_CODES.find((code) => RECIPE_LANGUAGE[code].toLocaleLowerCase() === value.toLocaleLowerCase());
  return code ? LANGUAGE_NAMES[code] : value || 'English';
}

/** The starting profile, its suggestions written in the interface language. */
export function defaultProfile(language: LanguageCode): KitchenProfile {
  if (language === 'en') return DEFAULT_PROFILE;
  const named = <T extends { name: string; details: string }>(entry: T): T =>
    ({ ...entry, name: starterText(entry.name, language), details: entry.details && starterText(entry.details, language) });
  return {
    ...DEFAULT_PROFILE,
    appliances: DEFAULT_PROFILE.appliances.map(named),
    dishTypes: DEFAULT_PROFILE.dishTypes.map(named),
    language: RECIPE_LANGUAGE[language],
  };
}
