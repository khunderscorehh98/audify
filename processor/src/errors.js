/**
 * Actions logs are public, so errors carry a fixed, safe message. Never put a
 * filename, URL or email in one. Patch 3 §5 sorts them into two kinds.
 */
export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.retryable = false;
  }
}

export class RetryableError extends Error {
  constructor(message) {
    super(message);
    this.retryable = true;
  }
}

/** Anything unexpected is assumed temporary; attempts cap the retries. */
export const toFailure = (error) => ({
  error: error instanceof PermanentError || error instanceof RetryableError ? error.message : 'Unexpected processing error',
  retryable: error instanceof PermanentError ? false : true,
});
