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
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly delay?: StaticDelayOptions | RandomDelayOptions;
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

const attempt = async <T, E extends Error>(fn: () => Promise<T>, timeoutMs?: number): Promise<GoResult<T, E>> => {
  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (timeoutMs === undefined) return success(await fn());
    else {
      return success(await Promise.race([fn(), timeout(timeoutMs) as Promise<T>]));
    }
  } catch (err) {
    return createGoError(err);
  }
};

export const go = async <T, E extends Error>(
  predicate: Promise<T> | (() => Promise<T>),
  options?: GoAsyncOptions
): Promise<GoResult<T, E>> => {
  const fn = typeof predicate === 'function' ? predicate : () => predicate;
  if (!options) return attempt(fn);

  const { retries, timeoutMs, delay } = options;
  const attempts = retries ? retries + 1 : 1;
  let lastFailedAttemptResult: GoResultError<E> | null = null;
  for (let i = 0; i < attempts; i++) {
    const goRes = await attempt<T, E>(fn, timeoutMs);
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
