import { buildApp } from '../src/http/app.ts';
import { buildTestContainer } from '../test/fakes/fixtures.ts';
import { fileURLToPath } from 'node:url';
// Dedicated new-account QA: in-memory DB, fake sign-in, no provider requests or real accounts.
const ctx = buildTestContainer(Date.now);
const app = await buildApp(ctx.container, { publicDir: fileURLToPath(new URL('../public', import.meta.url)) });
let cookie;
app.get('/qa-session', async (_req, reply) => reply.setCookie('ps_session', cookie, { httpOnly: true, sameSite: 'lax', path: '/' }).redirect('/'));
const start = await app.inject({ url: '/auth/chatgpt/start' });
const binding = start.cookies.find(c => c.name === 'ps_signin').value;
const done = await app.inject({ url: '/auth/callback?' + ctx.openai.callbackParams(), cookies: { ps_signin: binding } });
cookie = done.cookies.find(c => c.name === 'ps_session').value;
ctx.container.account.dismissPlanWelcome(ctx.auth.userForSession(cookie).id);
await app.listen({ host: '127.0.0.1', port: 3212 });
console.log('New-account QA ready on 127.0.0.1:3212; in-memory data only');
