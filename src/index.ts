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

export interface GoAsyncOptions<E extends Error = Error> {
  retries?: number; // Number of retries to attempt if the go callback is unsuccessful.
  attemptTimeoutMs?: number; // The timeout for each attempt.
  totalTimeoutMs?: number; // The maximum timeout for all attempts and delays. No more retries are performed after this timeout.
  delay?: StaticDelayOptions | RandomDelayOptions; // Type of the delay before each attempt. There is no delay before the first request.
  onAttemptError?: (goRes: GoResultError<E>) => void; // Callback invoked after each failed attempt is completed. This callback does not fire for the last attempt or when a "totalTimeoutMs" is exceeded (these should be handled explicitly with the result of "go" call).
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

interface CancellableTimeout {
  cancel: () => void;
  promise: Promise<any>;
}
const cancellableSleep = (ms: number) => {
  let resolveFn: any;
  let timeoutId: any;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
    timeoutId = setTimeout(resolve, ms);
  });

  const cancel = () => {
    clearTimeout(timeoutId);
    resolveFn();
  };

  return {
    promise,
    cancel,
  };
};
const cancellableTimeout = (ms: number): CancellableTimeout => {
  let rejectFn: any;
  let timeoutId: any;
  const promise = new Promise((_, reject) => {
    rejectFn = reject;
    timeoutId = setTimeout(() => reject('Operation timed out'), ms);
  });

  const cancel = () => {
    clearTimeout(timeoutId);
    rejectFn();
  };

  return {
    promise,
    cancel,
  };
};

const attempt = async <T, E extends Error>(
  fn: () => Promise<T>,
  attemptTimeoutMs?: number
): Promise<GoResult<T, E>> => {
  let timeout: CancellableTimeout | null = null;

  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (attemptTimeoutMs === undefined) return success(await fn());
    else {
      timeout = cancellableTimeout(attemptTimeoutMs);
      const result = await Promise.race([fn(), timeout.promise]);
      timeout.cancel();
      return success(result);
    }
  } catch (err) {
    if (timeout?.cancel) {
      timeout.cancel();
    }
    return createGoError(err);
  }
};

export const go = async <T, E extends Error>(
  fn: () => Promise<T>,
  options?: GoAsyncOptions<E>
): Promise<GoResult<T, E>> => {
  if (!options) return attempt(fn);

  const { retries, attemptTimeoutMs, delay, totalTimeoutMs, onAttemptError } = options;

  let fullTimeoutExceededGoResult: GoResult<never, Error> | null = null;
  let totalTimeoutCancellable: CancellableTimeout | null = null;
  let fullTimeoutPromise = new Promise((_resolve) => {}); // Never resolves
  if (totalTimeoutMs !== undefined) {
    // Start a "full" timeout that will stop all retries after it is exceeded
    totalTimeoutCancellable = cancellableSleep(totalTimeoutMs);
    fullTimeoutPromise = totalTimeoutCancellable.promise.then(() => {
      const goRes = fail(new Error('Full timeout exceeded'));
      fullTimeoutExceededGoResult = goRes;
      return goRes;
    });
  }

  // Typing as "any" because TS has troubles understanding that the value can be non-null
  let delayCancellable: any;
  const makeAttempts = async () => {
    const attempts = retries ? retries + 1 : 1;
    let lastFailedAttemptResult: GoResultError<E> | null = null;
    for (let i = 0; i < attempts; i++) {
      // Return early in case the global timeout has been exceeded during after attempt wait time.
      //
      // This is guaranteed to be false for the first attempt.
      if (fullTimeoutExceededGoResult) break;
      const goRes = await attempt<T, E>(fn, attemptTimeoutMs);
      // Return early if the timeout is exceeded not to cause any side effects (such as calling "onAttemptError" function)
      if (fullTimeoutExceededGoResult) break;

      if (i !== attempts - 1 && !goRes.success && onAttemptError) goSync(() => onAttemptError(goRes));
      if (goRes.success) return goRes;

      lastFailedAttemptResult = goRes;
      if (delay) {
        switch (delay.type) {
          case 'random': {
            const { minDelayMs, maxDelayMs } = delay;
            delayCancellable = cancellableSleep(getRandomInRange(minDelayMs, maxDelayMs));
            await delayCancellable.promise;
            break;
          }
          case 'static': {
            const { delayMs } = delay;
            delayCancellable = cancellableSleep(delayMs);
            await delayCancellable.promise;
            break;
          }
        }
      }
    }

    return lastFailedAttemptResult!;
  };

  const result = await Promise.race([makeAttempts(), fullTimeoutPromise]);
  if (totalTimeoutCancellable?.cancel) totalTimeoutCancellable.cancel();
  if (delayCancellable?.cancel) delayCancellable.cancel();

  return result as Promise<GoResult<T, E>>;
};
