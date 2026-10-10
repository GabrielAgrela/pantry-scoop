import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { bodyObject, idParam } from '../params.ts';
import { PANTRY_BASICS, pantryBasicsSelection } from '../../domain/pantry-basics.ts';
import { createDraft, normalizeName } from '../../domain/ingredient.ts';
import { LANGUAGE_HEADER, languageCode, starterText } from '../../domain/language.ts';

export function ingredientRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => ({ ingredients: servicesOf(request).stock.list(), categories: servicesOf(request).stock.categories() }));

    app.get('/basics', async (request) => {
      const { stock, profile } = servicesOf(request);
      const language = languageCode(request.headers[LANGUAGE_HEADER]);
      const existing = new Map(stock.list().map(item => [normalizeName(item.name), item]));
      const saved = profile.get().pantryBasics;
      // `id` is the stable English name that is saved and sent back; `name` is shown and stocked.
      return { basics: PANTRY_BASICS.map(item => {
        const name = starterText(item.name, language);
        const known = existing.get(normalizeName(name)) ?? existing.get(normalizeName(item.name));
        return { ...item, id: item.name, name, selected: known?.inStock ?? (saved === undefined || saved.includes(item.name)) };
      }) };
    });

    app.post('/basics', async (request) => {
      const selected = pantryBasicsSelection(bodyObject(request.body).selected);
      const { stock, profile } = servicesOf(request);
      const language = languageCode(request.headers[LANGUAGE_HEADER]);
      // Stock and setup progress commit together, including on retries or a restarted setup.
      return stock.transaction(() => {
        const existing = new Map(stock.list().map(item => [normalizeName(item.name), item]));
        for (const item of PANTRY_BASICS) {
          const name = starterText(item.name, language);
          const known = existing.get(normalizeName(name)) ?? existing.get(normalizeName(item.name));
          if (selected.includes(item.name)) {
            if (known) { if (!known.inStock) stock.update(known.id, { inStock: true }); }
            else stock.addIfMissing(createDraft({ ...item, name }, 'manual'));
          } else if (known?.inStock) stock.update(known.id, { inStock: false });
        }
        return { profile: profile.update({ pantryBasics: selected, setupStep: 1 }), ingredients: stock.list() };
      });
    });

    app.post('/classify-other', async (request) => {
      const { classification, ai } = servicesOf(request);
      return ai.act(() => classification.classifyOther());
    });

    app.post('/', async (request, reply) => {
      const body = bodyObject(request.body);
      const { ingredient, status } = servicesOf(request).stock.addManual({ name: body.name, category: body.category, notes: body.notes });
      reply.status(status === 'created' ? 201 : 200);
      return { ingredient, status };
    });

    app.patch('/:id', async (request) => {
      const body = bodyObject(request.body);
      const { name, category, notes, inStock } = body;
      return { ingredient: servicesOf(request).stock.update(idParam(request.params), { name, category, notes, inStock }) };
    });

    app.delete('/:id', async (request, reply) => {
      servicesOf(request).stock.remove(idParam(request.params));
      return reply.status(204).send();
    });
  };
}
