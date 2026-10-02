import { ValidationError } from '../domain/errors.ts';

export function idParam(params: unknown): number {
  const id = Number((params as { id?: unknown }).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError('Invalid id.');
  return id;
}

export function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}
