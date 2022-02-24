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

export const go = async <T, E extends Error>(fn: Promise<T> | (() => Promise<T>)): Promise<GoResult<T, E>> => {
  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (typeof fn === 'function') {
      return fn()
        .then(success)
        .catch((err) => createGoError(err));
    }
    return fn.then(success).catch((err) => createGoError(err));
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
