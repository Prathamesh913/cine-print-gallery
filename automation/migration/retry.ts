export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    readonly lastError: unknown,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    attemptsMade = attempt;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        break;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.2)));
      const delayMs = exponential + jitter;
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw new RetryExhaustedError(
    `Operation failed after ${attemptsMade} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    lastError,
  );
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
