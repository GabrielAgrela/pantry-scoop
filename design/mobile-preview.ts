// Isolated visual/interaction fixture: real HTTP routes and SQLite; scripted AI; no production data.
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/http/app.ts';
import { buildTestContainer, identity, sampleRecipe } from '../test/fakes/fixtures.ts';
import { COOKIES } from '../src/http/cookies.ts';
const ctx = buildTestContainer(Date.now);
const app = await buildApp(ctx.container, { publicDir: fileURLToPath(new URL('../public', import.meta.url)), rateLimitPerMinute: 3000 });
let profilePreview: 'slow' | 'failure' | undefined;
app.addHook('preHandler', async (request, reply) => {
  if (request.method !== 'GET' || request.url !== '/api/profile' || !profilePreview) return;
  const mode = profilePreview; profilePreview = undefined;
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 15000));
  else return reply.status(503).send({ error: 'The kitchen request could not complete.' });
});
app.get('/__preview', async (_request, reply) => reply.setCookie(COOKIES.session, pantry.session, { path: '/', httpOnly: true, sameSite: 'lax' }).redirect('/'));
for (const mode of ['slow', 'failure'] as const) app.get(`/__preview/kitchen-${mode}`, async (_request, reply) => {
  profilePreview = mode;
  return reply.setCookie(COOKIES.session, pantry.session, { path: '/', httpOnly: true, sameSite: 'lax' }).redirect('/#profile');
});
app.get('/__preview/scan', async (_request, reply) => reply.setCookie(COOKIES.session, scan.session, { path: '/', httpOnly: true, sameSite: 'lax' }).redirect('/'));
async function account(subject: string) {
  ctx.openai.nextIdentity = { ...identity(subject), name: 'Gabriel', picture: '' };
  const start = await app.inject('/auth/chatgpt/start');
  const done = await app.inject({ url: `/auth/callback?${ctx.openai.callbackParams()}`, cookies: { ps_signin: start.cookies.find((c) => c.name === 'ps_signin')!.value } });
  const session = done.cookies.find((c) => c.name === COOKIES.session)!.value;
  const user = ctx.auth.userForSession(session)!;
  ctx.container.account.dismissPlanWelcome(user.id);
  return { session, services: ctx.container.forUser(user.id) };
}
const pantry = await account('mobile-preview');
const rows = [
  { name: 'Cherry tomatoes', category: 'vegetables', notes: 'Half a punnet' },
  { name: 'Baby spinach', category: 'vegetables' }, { name: 'Lemons', category: 'fruit' },
  { name: 'Eggs', category: 'eggs', notes: 'Bottom shelf' }, { name: 'Greek yogurt', category: 'dairy' }, { name: 'Parmesan', category: 'dairy' },
];
for (const row of [...rows].reverse()) pantry.services.stock.addManual(row);
for (const name of ['Rice', 'Pasta', 'Bread', 'Oats', 'Couscous', 'Quinoa', 'Barley', 'Flour', 'Cornmeal', 'Noodles', 'Bulgur', 'Crackers', 'Buckwheat', 'Millet', 'Semolina', 'Tortillas', 'Polenta']) pantry.services.stock.addManual({ name, category: 'grains' });
pantry.services.stock.addManual({ name: 'Coconut', category: 'nuts' });
for (const name of ['Milk', 'Butter', 'Cream', 'Mozzarella']) { const item = pantry.services.stock.addManual({ name, category: 'dairy' }).ingredient; pantry.services.stock.update(item.id, { inStock: false }); }
pantry.services.profile.update({ appliances: [{ name: 'Air fryer', details: '4 L basket' }, { name: 'Ice cream maker', details: '1.2 L bowl · Mix 700–850 ml' }], servings: 2, units: 'Metric', language: 'English', preferences: 'Vegetarian, less sugar' });
const pasta = sampleRecipe({ title: 'Lemon & spinach pasta', summary: 'A bright, simple dinner made with what you have.', kind: 'main', makes: '2 servings', totalMinutes: 20, equipment: ['Hob'], ingredients: [{ name: 'Pasta', amount: '180 g', inStock: true }, { name: 'Baby spinach', amount: '2 handfuls', inStock: true }, { name: 'Lemons', amount: '1', inStock: true }], steps: ['Boil the pasta in salted water.', 'Wilt spinach, add lemon zest and toss with the pasta.'], tips: ['Save some pasta water for the sauce.'] });
const skillet = sampleRecipe({ title: 'Tomato & egg skillet', summary: 'Soft eggs nestled in a quick tomato sauce.', kind: 'main', makes: '2 servings', totalMinutes: 15, equipment: ['Hob'], ingredients: [{ name: 'Eggs', amount: '2', inStock: true }, { name: 'Cherry tomatoes', amount: '250 g', inStock: true }], steps: ['Cook tomatoes in a little olive oil.', 'Add the eggs and cover until set.'], tips: [] });
const coconut = sampleRecipe({ title: 'Coconut ice cream', kind: 'ice-cream', makes: '700 ml', ingredients: [{ name: 'Coconut', amount: '200 g', inStock: true }, { name: 'Greek yogurt', amount: '400 g', inStock: true }] });
ctx.generator.answer = [pasta, skillet, coconut];
const suggestPreview = ctx.generator.suggest.bind(ctx.generator);
ctx.generator.suggest = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 45000)); return suggestPreview(...args); };
for (let i = 0; i < 8; i++) pantry.services.recipes.save(i === 7 ? coconut : { ...pasta, title: `${pasta.title} ${i + 1}` });
pantry.services.jobs.start('recipes', { count: 3 }, async () => ({ recipes: [pasta, skillet, coconut] }));
// Reproduce an old completed scan: it must not consume space on a later pantry visit.
pantry.services.jobs.start('scan', { photos: 1 }, async () => ({ added: [], restocked: [], alreadyInStock: [] }));
const scan = await account('scan-preview');
for (const name of ['Eggs', 'Parmesan']) { const item = scan.services.stock.addManual({ name, category: name === 'Eggs' ? 'eggs' : 'dairy' }).ingredient; scan.services.stock.update(item.id, { inStock: false }); }
for (const name of ['Olive oil', 'Salt', 'Black pepper']) scan.services.stock.addManual({ name });
ctx.detector.answer = [...rows.slice(0, 3), { name: 'Greek yogurt', category: 'dairy' }, ...rows.filter((row) => ['Eggs', 'Parmesan'].includes(row.name)), ...['Olive oil', 'Salt', 'Black pepper'].map((name) => ({ name, category: 'other' }))] as typeof ctx.detector.answer;
await app.listen({ host: '127.0.0.1', port: 3211 });
console.log('Mobile preview: http://127.0.0.1:3211/__preview');
