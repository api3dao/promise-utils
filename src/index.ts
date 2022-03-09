import { AttemptOptions, retry, AttemptContext } from '@lifeomic/attempt';
const DEFAULT_RETRY_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;

// NOTE: We use discriminated unions over "success" property
export type GoResultSuccess<T> = { data: T; success: true };
export type GoResultError<E extends Error = Error> = { error: E; success: false };
export type GoResult<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>;

export interface PromiseOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
}

// NOTE: This needs to be written using 'function' syntax (cannot be arrow function)
// See: https://github.com/microsoft/TypeScript/issues/34523#issuecomment-542978853
export function assertGoSuccess<T>(result: GoResult<T>): asserts result is GoResultSuccess<T> {
  if (!result.success) {
    throw result.error;
  }
}

// NOTE: This needs to be written using 'function' syntax (cannot be arrow function)
// See: https://github.com/microsoft/TypeScript/issues/34523#issuecomment-542978853
export function assertGoError<E extends Error>(result: GoResult<any, E>): asserts result is GoResultError<E> {
  if (result.success) {
    throw new Error('Assertion failed. Expected error, but no error was thrown');
  }
}

export const success = <T>(value: T): GoResultSuccess<T> => {
  return { success: true, data: value };
};

// We allow the consumer to type which error is returned. The "err" parameter has weaker type ("Error") to accommodate
// for a generic error thrown by the go functions.
export const fail = <E extends Error>(err: Error): GoResultError<E> => {
  return { success: false, error: err as E };
};

const createGoError = <E extends Error>(err: unknown): GoResultError<E> => {
  if (err instanceof Error) return fail(err);
  return fail(new Error('' + err));
};

export const goSync = <T, E extends Error>(fn: () => T): GoResult<T, E> => {
  try {
    return success(fn());
  } catch (err) {
    return createGoError(err);
  }
};

export const go = async <T, E extends Error>(
  fn: Promise<T> | (() => Promise<T>),
  options?: PromiseOptions
): Promise<GoResult<T, E>> => {
  const attemptOptions: AttemptOptions<any> = {
    delay: options?.retryDelayMs || 200,
    maxAttempts: options?.retries || 1,
    initialDelay: 0,
    minDelay: 0,
    maxDelay: 0,
    factor: 0,
    timeout: options?.timeoutMs || 0,
    jitter: false,
    handleError: null,
    handleTimeout: options?.timeoutMs
      ? (context: AttemptContext, options: AttemptOptions<any>) => {
          if (context.attemptsRemaining > 0) {
            return go(fn, {
              timeoutMs: options?.timeout,
              retries: context.attemptsRemaining,
            });
          }
          throw new Error(`Operation timed out after final retry`);
        }
      : null,
    beforeAttempt: null,
    calculateDelay: null,
  };

  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (typeof fn === 'function') {
      return retry(fn, attemptOptions)
        .then(success)
        .catch((err) => {
          return createGoError(err);
        });
    }
    return retry(() => fn, attemptOptions)
      .then(success)
      .catch((err) => {
        return createGoError(err);
      });
  } catch (err) {
    return createGoError(err);
  }
};

export const retryGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) =>
  go(fn, { retries: DEFAULT_RETRIES, ...options });

export const timeoutGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) =>
  go(fn, { timeoutMs: DEFAULT_RETRY_TIMEOUT_MS, ...options });

export const retryTimeoutGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) => {
  return go(fn, { retries: 3, timeoutMs: DEFAULT_RETRY_TIMEOUT_MS, ...options });
};
