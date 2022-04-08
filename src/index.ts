// NOTE: We use discriminated unions over "success" property
export type GoResultSuccess<T> = { data: T; success: true };
export type GoResultError<E extends Error = Error> = { error: E; success: false };
export type GoResult<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>;

export interface StaticDelayOptions {
  type: 'static';
  delayMs: number;
}

export interface RandomDelayOptions {
  type: 'random';
  minDelayMs: number;
  maxDelayMs: number;
}

export interface GoAsyncOptions {
  retries?: number; // Number of retries to attempt if the go callback is unsuccessful.
  attemptTimeoutMs?: number; // The timeout for each attempt.
  totalTimeoutMs?: number; // The maximum timeout for all attempts and delays. No more retries are performed after this timeout.
  delay?: StaticDelayOptions | RandomDelayOptions; // Type of the delay before each attempt. There is no delay before the first request.
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

const getRandomInRange = (min: number, max: number) => {
  return Math.random() * (max - min) + min;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject('Operation timed out'), ms));

const attempt = async <T, E extends Error>(
  fn: () => Promise<T>,
  attemptTimeoutMs?: number
): Promise<GoResult<T, E>> => {
  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (attemptTimeoutMs === undefined) return success(await fn());
    else {
      return success(await Promise.race([fn(), timeout(attemptTimeoutMs) as Promise<T>]));
    }
  } catch (err) {
    return createGoError(err);
  }
};

export const go = async <T, E extends Error>(
  fn: () => Promise<T>,
  options?: GoAsyncOptions
): Promise<GoResult<T, E>> => {
  if (!options) return attempt(fn);

  const { retries, attemptTimeoutMs, delay, totalTimeoutMs } = options;

  let fullTimeoutExceeded = false;
  let fullTimeoutPromise = new Promise((_resolve) => {}); // Never resolves
  if (totalTimeoutMs !== undefined) {
    // Start a "full" timeout that will stop all retries after it is exceeded
    fullTimeoutPromise = sleep(totalTimeoutMs).then(() => {
      fullTimeoutExceeded = true;
      return fail(new Error('Full timeout exceeded'));
    });
  }

  const makeAttempts = async () => {
    const attempts = retries ? retries + 1 : 1;
    let lastFailedAttemptResult: GoResultError<E> | null = null;
    for (let i = 0; i < attempts; i++) {
      // This is guaranteed to be false for the first attempt
      if (fullTimeoutExceeded) break;

      const goRes = await attempt<T, E>(fn, attemptTimeoutMs);
      if (goRes.success) return goRes;

      lastFailedAttemptResult = goRes;
      if (delay) {
        switch (delay.type) {
          case 'random': {
            const { minDelayMs, maxDelayMs } = delay;
            await sleep(getRandomInRange(minDelayMs, maxDelayMs));
            break;
          }
          case 'static': {
            const { delayMs } = delay;
            await sleep(delayMs);
            break;
          }
        }
      }
    }

    return lastFailedAttemptResult!;
  };

  return Promise.race([makeAttempts(), fullTimeoutPromise]) as Promise<GoResult<T, E>>;
};
