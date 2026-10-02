import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyRequest } from 'fastify';

export const COOKIES = {
  /** App session (random token; only its hash is stored). */
  session: 'ps_session',
  /** Binds a pending sign-in to the browser that started it. */
  signIn: 'ps_signin',
  /** Issued ChatGPT client ID last used in this browser, so sign-in reuses the registration. */
  account: 'ps_account',
} as const;

export function cookieOptions(request: FastifyRequest, maxAgeSeconds: number): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: maxAgeSeconds,
  };
}

export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
