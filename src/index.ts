import { AttemptOptions, sleep, retry, AttemptContext } from '@lifeomic/attempt';

// NOTE: We use discriminated unions over "success" property
export type GoResultSuccess<T> = { data: T; success: true };
export type GoResultError<E extends Error = Error> = { error: E; success: false };
export type GoResult<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>;

export const success = <T>(value: T): GoResultSuccess<T> => {
  return { success: true, data: value };
};

// We allow the consumer to type which error is returned. The "err" parameter has weaker type ("Error") to accommodate
// for a generic error thrown by the go functions.
export const fail = <E extends Error>(err: Error): GoResultError<E> => {
  return { success: false, error: err as E };
};

export const goSync = <T, E extends Error>(fn: () => T): GoResult<T, E> => {
  try {
    return success(fn());
  } catch (err) {
    return createGoError(err);
  }
};

const createGoError = <E extends Error>(err: unknown): GoResultError<E> => {
  if (err instanceof Error) return fail(err);
  return fail(new Error('' + err));
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
            return new Promise<T>(() =>
              go(fn, {
                timeoutMs: options?.timeout,
                retries: context.attemptsRemaining,
              })
            );
          }
          throw new Error(`Operation timed out after final retry`);
        }
      : null,
    beforeAttempt: null,
    calculateDelay: null,
  };

  function retryFn(fn: () => Promise<T>, attemptOptions: AttemptOptions<any>): Promise<any> {
    return retry((_context) => fn(), attemptOptions)
      .then(success)
      .catch((err) => {
        return createGoError(err);
      });
  }
  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (typeof fn === 'function') {
      return retryFn(fn, attemptOptions);
    }
    return retryFn(() => fn, attemptOptions);
  } catch (err) {
    return createGoError(err);
  }
};

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

export interface PromiseOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
}

export interface RetryOptions extends PromiseOptions {
  readonly retries: number;
}

export async function retryOperation<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  // We may want to use some of these options in the future
  const attemptOptions: AttemptOptions<any> = {
    delay: options.retryDelayMs || 0,
    maxAttempts: options.retries + 1,
    initialDelay: 0,
    minDelay: 0,
    maxDelay: 0,
    factor: 0,
    timeout: options.timeoutMs || 0,
    jitter: false,
    handleError: null,
    handleTimeout: null,
    beforeAttempt: null,
    calculateDelay: null,
  };
  return retry((_context) => operation(), attemptOptions);
}

export interface ContinuousRetryOptions {
  readonly delay?: number;
}

export function promiseTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  let mutableTimeoutId: NodeJS.Timeout;
  const timeout = new Promise((_res, reject) => {
    mutableTimeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out in ${ms} ms.`));
    }, ms);
  });

  const wrappedPromise = promise.finally(() => {
    if (mutableTimeoutId) {
      clearTimeout(mutableTimeoutId);
    }
  });

  return Promise.race([wrappedPromise, timeout]) as Promise<T>;
}

export function retryOnTimeout<T>(maxTimeoutMs: number, operation: () => Promise<T>, options?: ContinuousRetryOptions) {
  const promise = new Promise<T>((resolve, reject) => {
    function run(): Promise<any> {
      // If the promise is successful, resolve it and bubble the result up
      return operation()
        .then(resolve)
        .catch((reason: any) => {
          // Only if the error is a timeout error, do we retry the promise
          if (reason instanceof Error && reason.message.includes('Operation timed out')) {
            // Delay the new attempt slightly
            return sleep(options?.delay || 0)
              .then(run)
              .then(resolve)
              .catch(reject);
          }

          // If the error is NOT a timeout error, then we reject immediately
          return reject(reason);
        });
    }

    return run();
  });

  return promiseTimeout(maxTimeoutMs, promise);
}

export const retryGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) =>
  go(fn, { retries: 3, ...options });

export const timeoutGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) =>
  go(fn, { timeoutMs: 10_000, ...options });

export const retryTimeoutGo = <T>(fn: Promise<T> | (() => Promise<T>), options?: PromiseOptions) => {
  return go(fn, { retries: 3, timeoutMs: 10_000, ...options });
};
