import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet } from 'jose';
import { createContainer } from './composition.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import { DeepSeekModel } from './infrastructure/ai/deepseek-model.ts';
import { GOOGLE_JWKS_URL, GoogleOAuthClient } from './infrastructure/google/google-oauth-client.ts';
import { scheduleBackups } from './infrastructure/db/backup.ts';
import { openDatabase } from './infrastructure/db/database.ts';
import { TokenCipher } from './infrastructure/db/token-cipher.ts';
import { OPENAI_JWKS_URL, OpenAiOAuthClient } from './infrastructure/openai/openai-oauth-client.ts';
import { ResponsesClient } from './infrastructure/openai/responses-client.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();

const db = openDatabase(config.dbPath);
const container = createContainer({
  config,
  db,
  cipher: TokenCipher.fromSecretOrFile(config.appSecret, join(dirname(config.dbPath), 'secret.key')),
  openaiAuth: new OpenAiOAuthClient({
    jwks: createRemoteJWKSet(new URL(OPENAI_JWKS_URL)),
    scopes: config.openai.scopes,
    confidential:
      config.openai.clientId && config.openai.clientSecret
        ? { clientId: config.openai.clientId, clientSecret: config.openai.clientSecret }
        : undefined,
  }),
  responses: new ResponsesClient({ timeoutMs: config.chatgpt.timeoutMs }),
  googleAuth:
    config.google.clientId && config.google.clientSecret
      ? new GoogleOAuthClient({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          jwks: createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)),
        })
      : undefined,
  deepseek: config.deepseek.apiKey
    ? new DeepSeekModel({ apiKey: config.deepseek.apiKey, model: config.deepseek.model, timeoutMs: config.chatgpt.timeoutMs })
    : undefined,
  onJobError: (error) => console.error('Background job failed', error),
});

const stopBackups = scheduleBackups(db, join(dirname(config.dbPath), 'backups'), config.backupDays, (error) =>
  console.error('Database backup failed', error),
);

const app = await buildApp(container, {
  logger: true,
  trustProxy: config.trustProxy,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
});

const shutdown = async () => {
  stopBackups();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
