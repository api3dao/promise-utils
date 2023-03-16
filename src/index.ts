// NOTE: We use discriminated unions over "success" property
export type GoResultSuccess<T> = { data: T; success: true; error: undefined };
export type GoResultError<E extends Error = Error> = { data: undefined; error: E; success: false };
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
  attemptTimeoutMs?: number | number[]; // The timeout for each attempt. Can provide an array for different timeouts for each attempt. If the array is shorter than the number of retries, the last value is used for all remaining attempts, if the length of the array is longer than the number of retries, the extra values are ignored.
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
  return { success: true, data: value, error: undefined };
};

// We allow the consumer to type which error is returned. The "err" parameter has weaker type ("Error") to accommodate
// for a generic error thrown by the go functions.
export const fail = <E extends Error>(err: Error): GoResultError<E> => {
  return { success: false, data: undefined, error: err as E };
};

const createGoError = <E extends Error>(err: unknown): GoResultError<E> => {
  if (err instanceof Error) return fail(err);
  return fail(new GoWrappedError(err));
};

export const goSync = <T, E extends Error>(fn: () => T): GoResult<T, E> => {
  try {
    return success(fn());
  } catch (err) {
    return createGoError(err) as GoResultError<E>;
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
  fn: () => T,
  attemptTimeoutMs?: number
): Promise<GoResult<Awaited<T>, E>> => {
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
    return createGoError(err) as GoResultError<E>;
  }
};

export const go = async <T, E extends Error>(
  fn: () => T,
  options?: GoAsyncOptions<E>
): Promise<GoResult<Awaited<T>, E>> => {
  if (!options) return attempt(fn);

  const { retries, attemptTimeoutMs, delay, totalTimeoutMs, onAttemptError } = options;

  let fullTimeoutExceeded = false;
  let totalTimeoutCancellable: CancellableTimeout | null = null;
  let fullTimeoutPromise = new Promise((_resolve) => {}); // Never resolves
  if (totalTimeoutMs !== undefined) {
    // Start a "full" timeout that will stop all retries after it is exceeded
    totalTimeoutCancellable = cancellableSleep(totalTimeoutMs);
    fullTimeoutPromise = totalTimeoutCancellable.promise.then(() => {
      fullTimeoutExceeded = true;
      return fail(new Error('Full timeout exceeded'));
    });
  }

  // Typing as "any" because TS has troubles understanding that the value can be non-null
  let delayCancellable: any;
  const makeAttempts = async () => {
    const attempts = retries ? retries + 1 : 1;
    let lastFailedAttemptResult: GoResultError<E> | null = null;
    for (let i = 0; i < attempts; i++) {
      // if array of timeouts is provided, use the timeout at the current index,
      // or the last one if the index is out of bounds
      // if a single timeout is provided, use it for all attempts
      let currentAttemptTimeoutMs: number | undefined;
      if (Array.isArray(attemptTimeoutMs)) {
        currentAttemptTimeoutMs = attemptTimeoutMs[i] || attemptTimeoutMs.at(-1);
      } else {
        currentAttemptTimeoutMs = attemptTimeoutMs;
      }
      // Return early in case the global timeout has been exceeded during after attempt wait time.
      //
      // This is guaranteed to be false for the first attempt.
      if (fullTimeoutExceeded) break;
      const goRes = await attempt<T, E>(fn, currentAttemptTimeoutMs);
      // Return early if the timeout is exceeded not to cause any side effects (such as calling "onAttemptError" function)
      if (fullTimeoutExceeded) break;

      if (i !== attempts - 1 && !goRes.success && onAttemptError) goSync(() => onAttemptError(goRes));
      if (goRes.success) return goRes;

      lastFailedAttemptResult = goRes;
      if (delay && i !== attempts - 1) {
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

  return result as Promise<GoResult<Awaited<T>, E>>;
};
