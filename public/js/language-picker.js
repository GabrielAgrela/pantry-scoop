import { api } from './api.js';
import { h, showError } from './dom.js';
import { LANGUAGES, locale, recipeLanguage, setLanguage, t } from './i18n.js';

/** The app's languages, each written in its own language. `onbeforechange` may save other edits before the reload. */
export function languageSelect({ signedIn, onbeforechange, ...attrs }) {
  const select = h('select', { 'aria-label': t('Language'), ...attrs, onchange: async () => {
    const code = select.value;
    select.disabled = true;
    await onbeforechange?.();
    await chooseLanguage(code, { signedIn }).finally(() => { select.value = locale; select.disabled = false; });
  } },
    ...LANGUAGES.map((language) => h('option', { value: language.code, selected: language.code === locale, lang: language.code }, language.name)));
  return select;
}

/**
 * Switches the interface and, when signed in, the recipe language Scoop writes in. Signed out,
 * the choice is saved to the account at the next signed-in start.
 */
export async function chooseLanguage(code, { signedIn }) {
  if (code === locale) return;
  if (signedIn) {
    try { await api.updateProfile({ language: recipeLanguage(code) }); } catch (error) { showError(error); return; }
  }
  if (!setLanguage(code, { pending: !signedIn })) showError(new Error(t('Your browser blocked saving the language. Allow site data, then try again.')));
}
