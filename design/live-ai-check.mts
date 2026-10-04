// Live check (not a unit test): a photo scan, recipe ideas and sorting through the app's real
// composition on the real DeepSeek connection and .env settings, in a throwaway in-memory database.
// Usage: node design/live-ai-check.mts <photo.jpg>
import { readFileSync } from 'node:fs';
import { createContainer } from '../src/composition.ts';
import { loadConfig } from '../src/config.ts';
import { DeepSeekModel } from '../src/infrastructure/ai/deepseek-model.ts';
import { openDatabase } from '../src/infrastructure/db/database.ts';
import { ResponsesClient } from '../src/infrastructure/openai/responses-client.ts';
import { FakeGoogleAuth, FakeOpenAiAuth, googleIdentity, TEST_CIPHER } from '../test/fakes/fixtures.ts';

process.loadEnvFile('.env');
const config = loadConfig({ ...process.env, DB_PATH: ':memory:', ALLOWED_EMAILS: '' });
const google = new FakeGoogleAuth();
const container = createContainer({
  config,
  db: openDatabase(':memory:'),
  cipher: TEST_CIPHER,
  openaiAuth: new FakeOpenAiAuth(),
  responses: new ResponsesClient({ fetch: async () => { throw new Error('ChatGPT must not be used'); }, timeoutMs: 1000 }),
  googleAuth: google,
  deepseek: new DeepSeekModel({ apiKey: config.deepseek.apiKey!, model: config.deepseek.model, timeoutMs: config.chatgpt.timeoutMs }),
});
google.nextIdentity = googleIdentity('live-check', 'live-check@example.com');
const started = container.auth.startGoogleSignIn();
const { user } = await container.auth.completeGoogleSignIn({ params: google.callbackParams(), bindingToken: started.bindingToken });
const { deepseek } = config;
console.log(`AI: ${container.connections.view(user.id).aiProvider} ${deepseek.model} (scan ${deepseek.scanEffort}, recipes ${deepseek.recipeEffort}, sort ${deepseek.sortEffort})`);
const services = container.forUser(user.id);

async function step<T>(label: string, work: () => Promise<T>, show: (value: T) => string) {
  const started = Date.now();
  try {
    const value = await work();
    console.log(`${label} (${Date.now() - started} ms): ${show(value)}`);
  } catch (error) {
    console.log(`${label} FAILED after ${Date.now() - started} ms: ${(error as Error).message}`);
  }
}

const photo = { mimeType: 'image/jpeg' as const, data: readFileSync(process.argv[2]!) };
await step('SCAN', () => services.scan.preview([photo]), (p) => p.added.map((i) => i.name).join(', '));
for (const name of ['Leite meio-gordo', 'Natas', 'Limões', 'Tomates', 'Cenouras', 'Cebola', 'Arroz agulha', 'Ovos', 'Açúcar']) services.stock.addManual({ name });
await step('RECIPES', () => services.recipes.suggest({ kind: 'any', count: 2, maxMissing: 1 }), (rs) => rs.map((r) => `${r.title} (${r.makes}, ${r.totalMinutes} min)`).join(' | '));
await step('SORT', () => services.classification.classifyOther(), (s) => s.classified.map((i) => `${i.name}→${i.category}`).join(', '));
