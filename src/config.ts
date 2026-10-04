import { ValidationError } from './domain/errors.ts';
import type { ReasoningEffort } from './infrastructure/openai/responses-client.ts';

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  /** Optional secret for encrypting stored tokens; otherwise a key file is created next to the DB. */
  readonly appSecret: string | undefined;
  readonly sessionDays: number;
  /**
   * Public address of this app. Required with a registered OpenAI client (its HTTPS callback is
   * PUBLIC_URL + /auth/callback); otherwise only used for the phone QR code.
   */
  readonly publicUrl: string | undefined;
  /** Honour X-Forwarded-* headers from this many proxy hops (0 = none; 1 = nginx in front). */
  readonly trustProxy: number;
  /** Verified emails allowed to sign in; empty = anyone. */
  readonly allowedEmails: readonly string[];
  /** Who receives data created before accounts existed. */
  readonly ownerEmail: string | undefined;
  /** Daily database backups kept in <data>/backups (0 = off). */
  readonly backupDays: number;
  /** "Sign in with ChatGPT" website client from OpenAI; unset = open-source loopback flow. */
  readonly openai: {
    readonly clientId: string | undefined;
    readonly clientSecret: string | undefined;
    readonly scopes: string | undefined;
  };
  readonly chatgpt: {
    /** Default model slug; empty = the first model each user's plan lists. */
    readonly model: string;
    readonly scanEffort: ReasoningEffort;
    readonly recipeEffort: ReasoningEffort;
    readonly timeoutMs: number;
  };
  /** "Sign in with Google" web client; unset = no Google sign-in. Callback: PUBLIC_URL + /auth/google/callback. */
  readonly google: {
    readonly clientId: string | undefined;
    readonly clientSecret: string | undefined;
  };
  /** DeepSeek, the alternative to each person's ChatGPT plan; unset = ChatGPT plans only. */
  readonly deepseek: {
    readonly apiKey: string | undefined;
    readonly model: string;
    /** Thinking per task: minimal = off, low, medium/high = high. */
    readonly scanEffort: ReasoningEffort;
    readonly recipeEffort: ReasoningEffort;
    readonly sortEffort: ReasoningEffort;
  };
}

export const APP_NAME = 'Pantry Scoop';

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

function effort(value: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  if (value === undefined || value === '') return fallback;
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid reasoning effort "${value}". Use one of: ${EFFORTS.join(', ')}.`);
  }
  return value as ReasoningEffort;
}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw new ValidationError(`${name} must be a positive integer.`);
  return num;
}

function positiveIntOrZero(value: string, name: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw new ValidationError(`${name} must be a whole number.`);
  return num;
}

function emailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST || '0.0.0.0',
    port: positiveInt(env.PORT, 'PORT', 3210),
    dbPath: env.DB_PATH || './data/pantry.db',
    appSecret: env.APP_SECRET || undefined,
    sessionDays: positiveInt(env.SESSION_DAYS, 'SESSION_DAYS', 30),
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined,
    trustProxy: env.TRUST_PROXY === 'true' ? 1 : env.TRUST_PROXY ? positiveIntOrZero(env.TRUST_PROXY, 'TRUST_PROXY') : 0,
    allowedEmails: emailList(env.ALLOWED_EMAILS),
    ownerEmail: env.OWNER_EMAIL ? env.OWNER_EMAIL.trim().toLowerCase() : undefined,
    backupDays: env.BACKUP_DAYS === undefined || env.BACKUP_DAYS === '' ? 7 : positiveIntOrZero(env.BACKUP_DAYS, 'BACKUP_DAYS'),
    openai: {
      clientId: env.OPENAI_CLIENT_ID || undefined,
      clientSecret: env.OPENAI_CLIENT_SECRET || undefined,
      scopes: env.OPENAI_SCOPES || undefined,
    },
    chatgpt: {
      model: env.CHATGPT_MODEL || '',
      scanEffort: effort(env.CHATGPT_SCAN_EFFORT, 'low'),
      recipeEffort: effort(env.CHATGPT_RECIPE_EFFORT, 'medium'),
      timeoutMs: positiveInt(env.CHATGPT_TIMEOUT_MS, 'CHATGPT_TIMEOUT_MS', 180_000),
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID || undefined,
      clientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    },
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY || undefined,
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      // Benchmarked on a real spice-rack photo: only high thinking read every label; recipes are
      // good from low; sorting is right with thinking off.
      scanEffort: effort(env.DEEPSEEK_SCAN_EFFORT, 'high'),
      recipeEffort: effort(env.DEEPSEEK_RECIPE_EFFORT, 'low'),
      sortEffort: effort(env.DEEPSEEK_SORT_EFFORT, 'minimal'),
    },
  };
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Where OpenAI sends the browser back after sign-in.
 * - Registered website client: PUBLIC_URL + /auth/callback (must match the registration exactly).
 * - Open-source flow: a loopback callback; only the port may vary.
 */
/** Google needs one fixed, registered HTTPS callback, so it requires PUBLIC_URL. */
export function googleRedirectUriFor(config: Pick<Config, 'publicUrl' | 'google'>): string | undefined {
  if (!config.google.clientId) return undefined;
  if (!config.google.clientSecret) throw new ValidationError('GOOGLE_CLIENT_ID needs GOOGLE_CLIENT_SECRET.');
  if (!config.publicUrl) throw new ValidationError('GOOGLE_CLIENT_ID needs PUBLIC_URL (the address registered with Google).');
  return `${config.publicUrl}/auth/google/callback`;
}

export function redirectUriFor(config: Pick<Config, 'port' | 'publicUrl' | 'openai'>): string {
  if (!config.openai.clientId) return `http://127.0.0.1:${config.port}/auth/callback`;
  if (!config.publicUrl) throw new ValidationError('OPENAI_CLIENT_ID needs PUBLIC_URL (your HTTPS address).');
  const url = new URL(config.publicUrl);
  if (url.protocol !== 'https:' && !LOCAL_HOST.test(url.hostname)) {
    throw new ValidationError('PUBLIC_URL must use https:// when OPENAI_CLIENT_ID is set.');
  }
  return `${config.publicUrl}/auth/callback`;
}
