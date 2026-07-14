export interface RetryOptions {
  attempts: number;
  delayMs: number;
  onRetry?: (error: unknown, nextAttempt: number, attempts: number) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new RangeError("attempts must be a positive integer");
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new RangeError("delayMs must be a non-negative number");
  }

  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt === options.attempts) throw error;
      options.onRetry?.(error, attempt + 1, options.attempts);
      await sleep(options.delayMs * attempt);
    }
  }
  throw new Error("retry exhausted without running the operation");
}
