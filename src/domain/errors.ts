/** Base class so the HTTP layer can map domain failures without knowing every subtype. */
export abstract class DomainError extends Error {
  abstract readonly kind:
    | 'validation'
    | 'not-found'
    | 'conflict'
    | 'ai-unavailable'
    | 'auth-required'
    | 'plan-required'
    | 'usage-limit';

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly kind = 'validation';
}

export class NotFoundError extends DomainError {
  readonly kind = 'not-found';
}

export class ConflictError extends DomainError {
  readonly kind = 'conflict';
}

/** The AI backend failed, timed out or answered with something unusable. */
export class AiUnavailableError extends DomainError {
  readonly kind = 'ai-unavailable';
}

/** No valid app session, or the ChatGPT connection must be re-authorised. */
export class AuthRequiredError extends DomainError {
  readonly kind = 'auth-required';
}

/** Signed in, but the user has not allowed this app to use their ChatGPT plan. */
export class PlanUsageRequiredError extends DomainError {
  readonly kind = 'plan-required';
}

/** The user's ChatGPT plan (or this app's limit in ChatGPT settings) is used up for now. */
export class UsageLimitError extends DomainError {
  readonly kind = 'usage-limit';
}
