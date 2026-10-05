// The demo kitchen: the real HTTP app over an in-memory database, with fake sign-in and scripted AI.
// Nothing here talks to ChatGPT or touches real accounts. AI answers wait on `world.wait`, which the
// capture script points at its virtual clock so loading states last the same on every run.
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../../src/http/app.ts';
import { buildTestContainer, sampleRecipe } from '../../../test/fakes/fixtures.ts';

export async function createWorld({ port = 3290 } = {}) {
  const ctx = buildTestContainer(Date.now);
  ctx.openai.nextIdentity = { ...ctx.openai.nextIdentity, name: 'Maya', email: 'maya@pantry.scoop' };
  const app = await buildApp(ctx.container, { publicDir: fileURLToPath(new URL('../../../public', import.meta.url)) });
  let cookie;
  app.get('/demo-session', async (_req, reply) => reply.setCookie('ps_session', cookie, { httpOnly: true, sameSite: 'lax', path: '/' }).redirect('/'));
  const start = await app.inject({ url: '/auth/chatgpt/start' });
  const binding = start.cookies.find((c) => c.name === 'ps_signin').value;
  const done = await app.inject({ url: '/auth/callback?' + ctx.openai.callbackParams(), cookies: { ps_signin: binding } });
  cookie = done.cookies.find((c) => c.name === 'ps_session').value;
  const user = ctx.auth.userForSession(cookie);
  ctx.container.account.dismissPlanWelcome(user.id);
  const services = ctx.container.forUser(user.id);

  const world = { app, ctx, services, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

  // A lived-in pantry. Lemons ran out (the scan brings them back); three strays wait in Other.
  const pantry = [
    { name: 'Avocados', category: 'fruit', notes: 'Two ripe ones' },
    { name: 'Baby spinach', category: 'vegetables', notes: 'Half a bag' },
    { name: 'Carrots', category: 'vegetables' },
    { name: 'Lemons', category: 'fruit' },
    { name: 'Free-range eggs', category: 'eggs', notes: 'Bottom shelf' },
    { name: 'Parmesan', category: 'dairy' },
    { name: 'Greek yogurt', category: 'dairy' },
    { name: 'Spaghetti', category: 'grains' },
    { name: 'Arborio rice', category: 'grains' },
    { name: 'Sea salt', category: 'herbs-spices' },
    { name: 'Olive oil', category: 'condiments', notes: 'Extra virgin' },
    { name: 'Honey', category: 'sweetener' },
    { name: 'Chickpeas', category: 'other', notes: 'Two tins' },
    { name: 'Dark chocolate', category: 'other', notes: '70% cocoa' },
    { name: 'Popcorn kernels', category: 'other' },
  ];
  for (const item of pantry) services.stock.addManual(item);
  const byName = (name) => services.stock.list().find((item) => item.name === name);
  services.stock.update(byName('Lemons').id, { inStock: false });

  // What the "photo" (public/assets/pantry-editorial.webp) actually shows.
  const detect = ctx.detector.detect.bind(ctx.detector);
  ctx.detector.answer = [
    { name: 'Vine tomatoes', category: 'vegetables', notes: 'On the vine' },
    { name: 'Garlic', category: 'vegetables', notes: 'One bulb' },
    { name: 'Lemons', category: 'fruit' },
    { name: 'Fresh basil', category: 'herbs-spices', notes: 'Big bunch' },
    { name: 'Sourdough bread', category: 'grains', notes: 'Fresh loaf' },
    { name: 'Green olives', category: 'condiments' },
    { name: 'Olive oil', category: 'condiments' },
    { name: 'Sea salt', category: 'herbs-spices' },
  ];
  ctx.detector.detect = async (...args) => { await world.wait(world.scanMs ?? 0); return detect(...args); };

  // "Sort with ChatGPT" finds real shelves for the strays.
  ctx.classifier.answer = undefined;
  const classify = ctx.classifier.classify.bind(ctx.classifier);
  ctx.classifier.classify = async (ingredients) => {
    await world.wait(world.classifyMs ?? 1400);
    const shelf = { Chickpeas: 'legumes', 'Dark chocolate': 'chocolate', 'Popcorn kernels': 'snacks' };
    ctx.classifier.answer = ingredients.map(({ id, name }) => ({ id, category: shelf[name] ?? 'other' }));
    return classify(ingredients);
  };

  ctx.generator.answer = [
    sampleRecipe({
      title: 'Lemon & basil spaghetti', difficulty: 'easy', creativity: 'familiar', kind: 'Dinner',
      summary: 'Silky, zesty and ready in 20 minutes. Burst tomatoes, garlic and a snowfall of parmesan.',
      makes: '2 servings', totalMinutes: 20, equipment: ['Hob'],
      ingredients: [
        { name: 'Spaghetti', amount: '180 g', inStock: true },
        { name: 'Vine tomatoes', amount: '200 g, halved', inStock: true },
        { name: 'Garlic', amount: '2 cloves, sliced', inStock: true },
        { name: 'Lemons', amount: '1, zest and juice', inStock: true },
        { name: 'Fresh basil', amount: '1 big handful', inStock: true },
        { name: 'Parmesan', amount: '30 g, grated', inStock: true },
        { name: 'Olive oil', amount: '2 tbsp', inStock: true },
        { name: 'Sea salt', amount: 'to taste', inStock: true },
      ],
      steps: [
        'Boil the spaghetti in well-salted water until al dente. Keep a mug of the pasta water.',
        'Warm the olive oil, add the garlic and tomatoes and cook until the tomatoes burst, about 4 minutes.',
        'Toss in the pasta with the lemon zest, parmesan and a splash of pasta water until glossy.',
        'Finish with lemon juice and torn basil. Twirl into bowls and enjoy!',
      ],
      tips: ['Save a mug of pasta water: it makes the sauce silky.', 'Tear the basil at the very end so it stays bright.'],
      estimate: { kcalMin: 520, kcalMax: 610, sugarGramsMin: 6, sugarGramsMax: 9, portions: 2, proteinGrams: 19, carbsGrams: 82, fatGrams: 17, fibreGrams: 6, saltGrams: 1.1 },
    }),
    sampleRecipe({
      title: 'Burst tomato toasts', difficulty: 'easy', creativity: 'creative', kind: 'Snack',
      summary: 'Crunchy sourdough, jammy tomatoes and a garlicky rub. Happiness on toast.',
      makes: '4 toasts', totalMinutes: 15, equipment: ['Oven'],
      ingredients: [
        { name: 'Sourdough bread', amount: '4 slices', inStock: true },
        { name: 'Vine tomatoes', amount: '250 g', inStock: true },
        { name: 'Garlic', amount: '1 clove', inStock: true },
        { name: 'Olive oil', amount: '2 tbsp', inStock: true },
        { name: 'Green olives', amount: 'a handful', inStock: true },
      ],
      steps: ['Roast the tomatoes with oil at 220 °C for 10 minutes.', 'Toast the bread, rub with garlic and pile on the tomatoes and olives.'],
      tips: ['A drizzle of honey on top is a lovely surprise.'],
      estimate: { kcalMin: 380, kcalMax: 450, sugarGramsMin: 7, sugarGramsMax: 10, portions: 2, proteinGrams: 11, carbsGrams: 52, fatGrams: 14, fibreGrams: 5, saltGrams: 1.4 },
    }),
    sampleRecipe({
      title: 'Olive oil & lemon ice cream', difficulty: 'medium', creativity: 'adventurous', kind: 'Ice cream',
      summary: 'Fruity olive oil, bright lemon and a silky scoop. Grown-up gelato vibes.',
      makes: '~750 ml', totalMinutes: 45, equipment: ['Blender', 'Freezer'],
      ingredients: [
        { name: 'Greek yogurt', amount: '400 g', inStock: true },
        { name: 'Olive oil', amount: '60 ml', inStock: true },
        { name: 'Lemons', amount: '2, zest and juice', inStock: true },
        { name: 'Honey', amount: '90 g', inStock: true },
        { name: 'Double cream', amount: '200 ml', inStock: false },
      ],
      steps: ['Blend everything until smooth.', 'Freeze for 4 hours, stirring every 45 minutes.'],
      tips: ['A spoonful of vodka keeps it scoopable straight from the freezer.'],
    }),
  ];
  const suggest = ctx.generator.suggest.bind(ctx.generator);
  ctx.generator.suggest = async (...args) => { await world.wait(world.recipeMs ?? 3000); return suggest(...args); };

  // A couple of keepers already in the recipe box.
  services.recipes.save(sampleRecipe({ title: 'Spinach & feta omelette', difficulty: 'easy', creativity: 'familiar', kind: 'Breakfast', makes: '1 serving', totalMinutes: 10, summary: 'Fluffy, green and ready in ten.', equipment: ['Hob'] }));
  services.recipes.save(sampleRecipe({ title: 'Honey oat cookies', difficulty: 'easy', creativity: 'creative', kind: 'Baking', makes: '12 cookies', totalMinutes: 25, summary: 'Chewy middles, golden edges.', equipment: ['Oven'] }));

  await app.listen({ host: '127.0.0.1', port });
  world.origin = `http://127.0.0.1:${port}`;
  world.sessionUrl = `${world.origin}/demo-session`;
  return world;
}
