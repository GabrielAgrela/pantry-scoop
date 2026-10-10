import { pt } from './locales/pt.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';

/**
 * The interface language. English text is the key: `t('Save')` looks the sentence up in the
 * chosen language's dictionary and falls back to the English when a translation is missing, so a
 * forgotten string shows in English instead of breaking. `{name}` placeholders are filled from
 * `params`. Changing language reloads the page, so every module renders once in one language.
 *
 * `recipe` is what the kitchen profile stores as the recipe language, the text the AI is told to
 * write in; it is kept in step with the interface.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', recipe: 'English', aliases: ['english', 'ingles', 'inglés', 'anglais'] },
  { code: 'pt', name: 'Português', recipe: 'Português (Portugal)', aliases: ['portugues', 'português', 'portuguese', 'portugues (portugal)', 'portuguese (portugal)', 'portugués', 'portugais'] },
  { code: 'es', name: 'Español', recipe: 'Español', aliases: ['espanol', 'español', 'spanish', 'espanhol', 'espagnol', 'castellano'] },
  { code: 'fr', name: 'Français', recipe: 'Français', aliases: ['francais', 'français', 'french', 'frances', 'francés', 'francês'] },
];
const DICTIONARIES = { pt, es, fr };
/** Tells the server which language starter data (appliances, dish types, basics) and Scoop's voice use. */
export const LANGUAGE_HEADER = 'x-pantry-language';
const KEY = 'pantry-scoop-language';
/** Set when the language was picked while signed out; the next signed-in start saves it to the profile. */
const PENDING_KEY = 'pantry-scoop-language-pending';

const supported = (code) => LANGUAGES.some((language) => language.code === code);
const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

function detect() {
  let saved;
  try { saved = storage()?.getItem(KEY); } catch { /* storage blocked */ }
  if (supported(saved)) return saved;
  // Only a real page follows the device language; tests and tools stay in English.
  if (typeof document === 'undefined') return 'en';
  for (const tag of globalThis.navigator?.languages ?? [globalThis.navigator?.language]) {
    const code = String(tag ?? '').toLowerCase().split('-')[0];
    if (supported(code)) return code;
  }
  return 'en';
}

export const locale = detect();
/** For Intl formatting: Portuguese here is European Portuguese. */
export const localeTag = locale === 'pt' ? 'pt-PT' : locale;
const dictionary = DICTIONARIES[locale] ?? {};
const plurals = new Intl.PluralRules(localeTag);

export function t(text, params) {
  const template = dictionary[text] ?? text;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

let patterns;
/**
 * Translates a message that arrived already filled in, such as a server error naming an
 * ingredient: an exact match first, then any dictionary sentence with `{placeholders}` whose
 * English shape it fits. Unknown messages stay as they are.
 */
export function translateMessage(message) {
  const text = String(message ?? '');
  if (text in dictionary) return dictionary[text];
  patterns ??= Object.keys(dictionary).filter((key) => key.includes('{')).map((key) => {
    const names = [];
    const source = key.split(/(\{\w+\})/).map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name) { names.push(name); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { key, names, regex: new RegExp(`^${source}$`, 's') };
  });
  for (const { key, names, regex } of patterns) {
    const match = regex.exec(text);
    if (match) return t(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return text;
}

let sources;
/** The English a translated phrase came from, in any of the languages, such as 'Forno' → 'Oven'. */
export function englishOf(text) {
  sources ??= new Map(Object.values(DICTIONARIES).flatMap((entries) => Object.entries(entries).map(([english, translated]) => [translated.toLocaleLowerCase(), english])));
  const value = String(text ?? '').trim();
  return sources.get(value.toLocaleLowerCase()) ?? value;
}

/** Picks the singular or plural sentence for `count` (available as `{count}`), then translates it. */
export function tn(count, one, other, params) {
  return t(plurals.select(count) === 'one' ? one : other, { count, ...params });
}

export const languageName = (code = locale) => LANGUAGES.find((language) => language.code === code)?.name ?? code;
export const recipeLanguage = (code = locale) => LANGUAGES.find((language) => language.code === code)?.recipe ?? 'English';

/**
 * What the cook reads of a recipe: its stored translation into the current language, when it has
 * one. Only for showing; the recipe itself (in English, as the AI reads it) is what goes back to the server.
 */
export function readable(recipe, language = recipeLanguage()) {
  const wanted = language.toLocaleLowerCase();
  const text = Object.entries(recipe.translations ?? {}).find(([name]) => name.toLocaleLowerCase() === wanted)?.[1];
  if (!text) return recipe;
  return {
    ...recipe, title: text.title, summary: text.summary, makes: text.makes, steps: text.steps, tips: text.tips,
    ingredients: recipe.ingredients.map((item, index) => ({ ...item, name: text.ingredients[index]?.name ?? item.name, amount: text.ingredients[index]?.amount ?? item.amount })),
  };
}

/** The supported language a profile's free-text recipe language names, if any. */
export function languageOfText(text) {
  const value = String(text ?? '').trim().toLocaleLowerCase();
  return LANGUAGES.find((language) => language.recipe.toLocaleLowerCase() === value || language.aliases.includes(value))?.code;
}

/** Remembers the choice and reloads, so the whole app renders in the new language. */
export function setLanguage(code, { pending = false } = {}) {
  if (!supported(code)) return false;
  try {
    storage()?.setItem(KEY, code);
    if (pending) storage()?.setItem(PENDING_KEY, code);
    else storage()?.removeItem(PENDING_KEY);
    // A blocked storage would forget the choice on reload; reloading then would only flip back.
    if (storage()?.getItem(KEY) !== code) return false;
  } catch { return false; }
  location.reload();
  return true;
}

/** A language picked on the sign-in screen, not yet saved to the account. */
export function pendingLanguage() {
  try { const code = storage()?.getItem(PENDING_KEY); return supported(code) ? code : undefined; } catch { return undefined; }
}
export function clearPendingLanguage() {
  try { storage()?.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
}

/** Translates the static page shell: `data-i18n` sets text, `data-i18n-<attribute>` sets that attribute. */
export function translatePage(root = document) {
  for (const el of root.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (name === 'data-i18n') el.textContent = t(value);
      else if (name.startsWith('data-i18n-')) el.setAttribute(name.slice(10), t(value));
    }
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = localeTag;
  // The theme toggle is a classic script that runs before any module; it borrows this for its label.
  globalThis.pantryT = t;
}
