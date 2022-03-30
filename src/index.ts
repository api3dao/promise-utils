import { AttemptOptions, retry } from '@lifeomic/attempt';

// NOTE: We use discriminated unions over "success" property
export type GoResultSuccess<T> = { data: T; success: true };
export type GoResultError<E extends Error = Error> = { error: E; success: false };
export type GoResult<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>;

export interface PromiseOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
}

export class GoWrappedError extends Error {
  constructor(public reason: unknown) {
    super('' + reason);
  }
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
  return fail(new GoWrappedError(err));
};

export const goSync = <T, E extends Error>(fn: () => T): GoResult<T, E> => {
  try {
    return success(fn());
  } catch (err) {
    return createGoError(err);
  }
};

const retryFnWrapper = async <T, E extends Error>(
  fn: Promise<T> | (() => Promise<T>),
  attemptOptions: AttemptOptions<T>
): Promise<GoResult<T, E>> => {
  if (typeof fn === 'function') {
    return retryFn(fn, attemptOptions);
  }
  return retryFn(() => fn, attemptOptions);
};

const retryFn = async <T, E extends Error>(
  fn: () => Promise<T>,
  attemptOptions: AttemptOptions<T>
): Promise<GoResult<T, E>> =>
  retry(fn, attemptOptions)
    .then(success)
    .catch((err) => createGoError(err));

export const go = async <T, E extends Error>(
  fn: Promise<T> | (() => Promise<T>),
  options?: PromiseOptions
): Promise<GoResult<T, E>> => {
  const attemptOptions: AttemptOptions<any> = {
    delay: options?.retryDelayMs || 200,
    maxAttempts: (options?.retries || 0) + 1,
    initialDelay: 0,
    minDelay: 0,
    maxDelay: 0,
    factor: 0,
    timeout: options?.timeoutMs || 0,
    jitter: false,
    handleError: null,
    handleTimeout: options?.timeoutMs
      ? async (context, options) => {
          if (context.attemptsRemaining > 0) {
            const res = await retryFnWrapper(fn, { ...options, maxAttempts: context.attemptsRemaining });

            if (res.success) {
              return res.data;
            } else {
              throw res.error;
            }
          }
          throw new Error(`Operation timed out`);
        }
      : null,
    beforeAttempt: null,
    calculateDelay: null,
  };

  // We need try/catch because `fn` might throw sync errors as well
  try {
    return retryFnWrapper(fn, attemptOptions);
  } catch (err) {
    return createGoError(err);
  }
};
