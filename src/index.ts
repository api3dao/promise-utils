// NOTE: We use discriminated unions over "success" property which simplifies the usage
export type GoResultSuccessArray<T> = [null, T];
export type GoResultSuccessObject<T> = { data: T; success: true };
export type GoResultSuccess<T> = GoResultSuccessArray<T> & GoResultSuccessObject<T>;

export type GoResultErrorArray<E extends Error = Error> = [E, null];
export type GoResultErrorObject<E extends Error = Error> = { error: E; success: false };
export type GoResultError<E extends Error = Error> = [E, null] & { error: E; success: false };

export type GoResult<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>;

export const success = <T>(value: T): GoResultSuccess<T> => {
  const result: any = [null, value];
  result.data = value;
  return result;
};

export const fail = <E extends Error>(err: Error): GoResultError<E> => {
  const result: any = [err, null];
  result.error = err;
  return result;
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
  if (result.success) {
    throw result.data;
  }
}

// NOTE: This needs to be written using 'function' syntax (cannot be arrow function)
// See: https://github.com/microsoft/TypeScript/issues/34523#issuecomment-542978853
export function assertGoError<E extends Error>(result: GoResult<any, E>): asserts result is GoResultError<E> {
  if (result.success) {
    throw result.data;
  }
}
