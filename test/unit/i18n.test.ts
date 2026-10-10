import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import type { Recipe } from '../../src/domain/recipe.ts';
import { sampleRecipe } from '../fakes/fixtures.ts';
import { STARTER_TRANSLATIONS, defaultProfile, languageCode, speechVoice } from '../../src/domain/language.ts';

type Dictionary = Record<string, string>;
const root = new URL('../../', import.meta.url);
const dictionaries: Record<'pt' | 'es' | 'fr', Dictionary> = {
  pt: ((await import(new URL('public/js/locales/pt.js', root).href)) as { pt: Dictionary }).pt,
  es: ((await import(new URL('public/js/locales/es.js', root).href)) as { es: Dictionary }).es,
  fr: ((await import(new URL('public/js/locales/fr.js', root).href)) as { fr: Dictionary }).fr,
};
const keys = JSON.parse(execFileSync(process.execPath, [new URL('scripts/i18n-keys.mjs', root).pathname], { encoding: 'utf8' })) as string[];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('interface translations', () => {
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    it(`${code} translates every sentence the interface can show`, () => {
      assert.deepEqual(keys.filter((key) => !dictionary[key]?.trim()), []);
    });

    it(`${code} keeps every {placeholder} of the English sentence`, () => {
      const broken = Object.entries(dictionary).filter(([english, translated]) => placeholders(english).join() !== placeholders(translated).join());
      assert.deepEqual(broken, []);
    });

    it(`${code} names starter appliances and dish types exactly as the server saves them`, () => {
      // The client shows these names itself too (setup, emoji picker); the rest only arrive from the server.
      const shared = Object.entries(STARTER_TRANSLATIONS[code as keyof typeof STARTER_TRANSLATIONS]).filter(([english]) => english in dictionary);
      assert.ok(shared.length >= 15);
      const differing = shared.filter(([english, translated]) => dictionary[english] !== translated);
      assert.deepEqual(differing, []);
    });
  }
});

describe('translating filled-in messages', async () => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => 'pt', setItem() {}, removeItem() {} };
  const { locale, readable, translateMessage } = (await import(new URL('public/js/i18n.js?language=pt', root).href)) as {
    locale: string; translateMessage: (message: string) => string; readable: (recipe: Recipe) => Recipe;
  };
  delete (globalThis as { localStorage?: unknown }).localStorage;

  it('reads the saved language', () => assert.equal(locale, 'pt'));

  it('translates fixed server messages exactly', () => {
    assert.equal(translateMessage('Please sign in.'), 'Inicia sessão.');
  });

  it('matches messages built with values against their template', () => {
    assert.equal(translateMessage('"Basil" is already in stock.'), '“Basil” já está disponível.');
    assert.equal(translateMessage('You’ve used all 40 AI requests for today. More tomorrow!'), 'Já usaste os 40 pedidos de IA de hoje. Há mais amanhã!');
  });

  it('shows a recipe’s stored translation, keeping the recipe itself in English', () => {
    const recipe = sampleRecipe({ translations: { 'Português (Portugal)': {
      title: 'Gelado de avelã', summary: 'Cremoso.', makes: '~750 ml', steps: ['Tritura tudo.', 'Bate 30–40 min.'], tips: ['Um pouco de vodka.'],
      ingredients: [{ name: 'Leite magro', amount: '350 ml' }, { name: 'Natas', amount: '200 ml' }, { name: 'Avelãs', amount: '1 mão-cheia' }],
    } } });
    const shown = readable(recipe);
    assert.equal(shown.title, 'Gelado de avelã');
    assert.deepEqual(shown.ingredients.map((item) => [item.amount, item.inStock]), [['350 ml', true], ['200 ml', true], ['1 mão-cheia', false]]);
    assert.equal(recipe.title, 'Ferrero-style hazelnut');
    assert.equal(readable(sampleRecipe()).title, 'Ferrero-style hazelnut');
  });

  it('leaves unknown messages untouched', () => {
    assert.equal(translateMessage('Something entirely new.'), 'Something entirely new.');
  });
});

describe('server language', () => {
  it('reads a language header, falling back to English', () => {
    assert.equal(languageCode('pt-PT'), 'pt');
    assert.equal(languageCode(['fr']), 'fr');
    assert.equal(languageCode('de'), 'en');
    assert.equal(languageCode(undefined), 'en');
  });

  it('writes the starting kitchen in the chosen language', () => {
    const profile = defaultProfile('pt');
    assert.equal(profile.language, 'Português (Portugal)');
    assert.ok(profile.appliances.some((appliance) => appliance.name === 'Forno'));
    assert.ok(profile.dishTypes.some((dish) => dish.name === 'Jantar'));
    assert.equal(defaultProfile('en').language, 'English');
  });

  it('picks a voice that speaks the language', () => {
    assert.equal(speechVoice('es'), 'ef_dora');
    assert.equal(speechVoice('en'), 'af_heart');
  });
});
