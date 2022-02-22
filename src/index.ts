// NOTE: We use discriminated unions over "success" property which simplifies the usage
export type GoResultSuccessArray<T> = [null, T];
export type GoResultSuccessObject<T> = { data: T; success: true };
export type GoResultSuccess<T> = GoResultSuccessArray<T> & GoResultSuccessObject<T>;

export type GoResultErrorArray<E = Error> = [E, null];
export type GoResultErrorObject<E = Error> = { error: E; success: false };
export type GoResultError<E = Error> = [E, null] & { error: E; success: false };

export type GoResult<T, E = Error> = GoResultSuccess<T> | GoResultError<E>;

export const success = <T>(value: T): GoResultSuccess<T> => {
  const result: any = [null, value];
  result.data = value;
  return result;
};

export const fail = <E = Error>(err: E): GoResultError<E> => {
  const result: any = [err, null];
  result.error = err;
  return result;
};

export const goSync = <T>(fn: () => T): GoResult<T> => {
  try {
    return success(fn());
  } catch (err) {
    if (err instanceof Error) return fail(err);
    return fail(new Error('' + err));
  }
};

export const go = async <T>(fn: Promise<T> | (() => Promise<T>)): Promise<GoResult<T>> => {
  // We need try/catch because `fn` might throw sync errors as well
  try {
    if (typeof fn === 'function') {
      return fn()
        .then(success)
        .catch(fail);
    }
    return fn.then(success).catch(fail);
  } catch (err) {
    if (err instanceof Error) return fail(err);
    return fail(new Error('' + err));
  }
};