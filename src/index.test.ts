import { go, goSync, success, fail, assertGoSuccess, assertGoError, retryGo, retryTimeoutGo, timeoutGo } from './index';
import { assertType, Equal } from 'type-plus';

describe('basic goSync usage', () => {
  it('resolves successful synchronous functions', () => {
    const res = goSync(() => 2 + 2);
    expect(res).toEqual(success(4));
    expect(res).toEqual({ success: true, data: 4 });
  });

  it('resolves unsuccessful synchronous functions', () => {
    const err = new Error('Computer says no');
    const res = goSync(() => {
      throw err;
    });
    expect(res).toEqual(fail(err));
    expect(res).toEqual({ success: false, error: err });
  });
});

describe('basic go usage', () => {
  it('resolves successful asynchronous functions', async () => {
    const successFn = new Promise((res) => res(2));
    const res = await go(successFn);
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions', async () => {
    const err = new Error('Computer says no');
    const errorFn = new Promise((_res, rej) => rej(err));
    const res = await go(errorFn);
    expect(res).toEqual(fail(err));
  });

  it('resolves asynchronous functions which throws', async () => {
    const err = new Error('Computer says no');
    const errorFn = new Promise(() => {
      throw err;
    });
    const res = await go(errorFn);
    expect(res).toEqual(fail(err));
  });

  it('resolves on sync errors as well', async () => {
    const obj = {} as any;
    const res = await go(() => obj.nonExistingFunction());
    expect(res).toEqual(fail(new TypeError('obj.nonExistingFunction is not a function')));
  });

  // NOTE: This is not an issue of promise utils library since the error is thrown before the value is passed as an
  // argument to the go function
  it('throws on sync usage without callback', async () => {
    const obj = {} as any;
    expect(() => go(obj.nonExistingFunction())).toThrow(new TypeError('obj.nonExistingFunction is not a function'));
  });

  it('accepts a sync function if the return type is never', async () => {
    const err = new Error('asd');
    const res = await go(() => {
      throw err;
    });
    expect(res).toEqual(fail(err));
  });
});

describe('basic retryGo usage', () => {
  const operations = {
    successFn: () => new Promise((res) => res(2)),
    errorFn: () => new Promise((_res, rej) => rej(new Error('Computer says no'))),
  };

  it('retries the specified number of times', async () => {
    const retries = 3;
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'));

    const res = await retryGo(operations.successFn, { retries });
    expect(operations.successFn).toHaveBeenCalledTimes(retries);
    expect(res).toEqual(success(2));
  });

  it('retries and resolves after timing out', async () => {
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 2'))
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 1'));

    const res = await retryGo(operations.successFn, { retries: 3 });
    expect(operations.successFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions with no retries', async () => {
    jest.spyOn(operations, 'errorFn').mockRejectedValueOnce(new Error('Operation timed out after final retry'));

    const res = await retryGo(operations.errorFn, { retries: 0 });
    expect(operations.errorFn).toHaveBeenCalledTimes(1);
    expect(res).toEqual(fail(new Error('Operation timed out after final retry')));
  });

  it('retries and resolves unsuccessful asynchronous functions', async () => {
    jest
      .spyOn(operations, 'errorFn')
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 1'))
      .mockRejectedValueOnce(new Error('Operation timed out after final retry'));

    const res = await retryGo(operations.errorFn, { retries: 2 });
    expect(operations.errorFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(fail(new Error('Computer says no')));
  });
});

describe('basic timeoutGo usage', () => {
  const operations = {
    successFn: () =>
      new Promise((res) =>
        setTimeout(() => {
          res(2);
        }, 10)
      ),
    errorFn: () => new Promise((_res, rej) => setTimeout(() => rej(new Error('Computer says no')), 10)),
  };

  it('resolves successful asynchronous functions within the timout limit', async () => {
    const res = await timeoutGo(operations.successFn, { timeoutMs: 20 });
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions within the timout limit', async () => {
    const res = await timeoutGo(operations.errorFn, { timeoutMs: 20 });
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('resolves timed out asynchoronous functions', async () => {
    const res = await timeoutGo(operations.successFn, { timeoutMs: 5 });
    expect(res).toEqual(fail(new Error('Operation timed out after final retry')));
  });
});

describe('basic retryTimeoutGo usage', () => {
  const operations = {
    successFn: () =>
      new Promise((res) =>
        setTimeout(() => {
          res(2);
        }, 20)
      ),
    errorFn: () => new Promise((_res, rej) => setTimeout(() => rej(new Error('Computer says no')), 20)),
  };

  it('resolves successful asynchronous functions', async () => {
    const res = await retryTimeoutGo(operations.successFn, { timeoutMs: 50, retries: 3 });
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions', async () => {
    const res = await retryTimeoutGo(operations.errorFn, { timeoutMs: 50, retries: 3 });
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('retries and resolves successful asynchronous functions', async () => {
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 1'))
      .mockRejectedValueOnce(new Error('Operation timed out after final retry'));

    const res = await retryTimeoutGo(operations.successFn, { timeoutMs: 100, retries: 3 });
    expect(operations.successFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(success(2));
  });

  it('retries and resolves unsuccessful asynchronous functions', async () => {
    jest
      .spyOn(operations, 'errorFn')
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 1'))
      .mockRejectedValueOnce(new Error('Operation timed out after final retry'));

    const res = await retryTimeoutGo(operations.errorFn, { timeoutMs: 100, retries: 2 });
    expect(operations.errorFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('retries and resolves unsuccessful timed out asynchronous functions', async () => {
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 2'))
      .mockRejectedValueOnce(new Error('Operation timed out, retries left: 1'))
      .mockRejectedValueOnce(new Error('Operation timed out after final retry'));

    const res = await retryTimeoutGo(operations.successFn, { timeoutMs: 100, retries: 2 });
    expect(operations.successFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(fail(new Error('Operation timed out after final retry')));
  });

  it('retries and resolves unsuccessful timed out functions', async () => {
    const res = await retryTimeoutGo(
      () =>
        new Promise((res) =>
          setTimeout(() => {
            res(2);
          }, 200)
        ),
      { timeoutMs: 50, retries: 3 }
    );
    expect(res).toEqual(fail(new Error('Operation timed out after final retry')));
  });
});

describe('custom error type', () => {
  class CustomError extends Error {
    custom: string;

    constructor(message: string) {
      super(message);
      this.custom = '123';
    }
  }

  describe('goSync', () => {
    it('error handling', () => {
      const goRes = goSync(() => {
        throw new CustomError('custom');
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<Error>(err);
      // Check that "err" is not assignable to CustomError
      assertType.isFalse(false as Equal<CustomError, typeof err>);
      expect(err instanceof CustomError).toBe(true);
    });

    it('can specify custom error type', () => {
      const goRes = goSync<never, CustomError>(() => {
        throw new CustomError('custom');
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<CustomError>(err);
      expect(err instanceof CustomError).toBe(true);
    });

    it('will wraps non error throw in Error class', () => {
      const goRes = goSync(() => {
        throw 'string-error';
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<Error>(err);
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('go', () => {
    it('error handling', async () => {
      const goRes = await go(() => {
        throw new CustomError('custom');
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<Error>(err);
      // Check that "err" is not assignable to CustomError
      assertType.isFalse(false as Equal<CustomError, typeof err>);
      expect(err instanceof CustomError).toBe(true);
    });

    it('can specify custom error type', async () => {
      const goRes = await go<never, CustomError>(() => {
        throw new CustomError('custom');
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<CustomError>(err);
      expect(err instanceof CustomError).toBe(true);
    });

    it('will wraps non error throw in Error class', async () => {
      const goRes = await go(() => {
        throw 'string-error';
      });
      assertGoError(goRes);
      const err = goRes.error;

      assertType<Error>(err);
      expect(err instanceof Error).toBe(true);
    });
  });
});

describe('the "this" limitation', () => {
  class Test {
    constructor() {}
    sync() {
      return this._sync();
    }
    _sync() {
      return '123';
    }

    async() {
      return this._async();
    }
    _async() {
      return Promise.resolve('123');
    }
  }

  // The error message for when reading a property of undefined has changed between major node versions
  const expectReadPropertyOfUndefined = (res: unknown, prop: string) => {
    if (process.version.startsWith('v16')) {
      expect(res).toEqual(fail(new TypeError(`Cannot read properties of undefined (reading '${prop}')`)));
    } else {
      expect(res).toEqual(fail(new TypeError(`Cannot read property '${prop}' of undefined`)));
    }
  };

  it('fails for sync version', () => {
    const test = new Test();

    const res = goSync(test.sync);

    expectReadPropertyOfUndefined(res, '_sync');
  });

  it('fails for async version', async () => {
    const test = new Test();

    const res = await go(test.async);

    expectReadPropertyOfUndefined(res, '_async');
  });
});

describe('assertGoSuccess', () => {
  it('works for success', () => {
    const res = goSync(() => 123);

    assertGoSuccess(res);

    // The "data" property should now be inferred since the success was asserted
    const data = res.data;
    expect(data).toBe(data);
  });

  it('works for failure (rethrows the go error)', () => {
    const res = goSync(() => {
      throw new Error('my bad');
    });

    expect(() => assertGoSuccess(res)).toThrow('my bad');
  });
});

describe('assertGoError', () => {
  it('works for success', () => {
    const res = goSync(() => 123);

    expect(() => assertGoError(res)).toThrow('Assertion failed. Expected error, but no error was thrown');
  });

  it('works for failure', () => {
    const res = goSync(() => {
      throw new Error('error');
    });

    assertGoError(res);

    // The "error" property should now be inferred since the success was asserted
    const err = res.error;
    expect(err).toBe(err);
  });
});

// NOTE: Keep in sync with README
describe('documentation snippets are valid', () => {
  const fetchData = (_path: string) => {
    if (_path.startsWith('throw')) return Promise.reject('unexpected error');
    return Promise.resolve('some data');
  };

  it('success usage', async () => {
    const goFetchData = await go(() => fetchData('users'));
    if (goFetchData.success) {
      const data = goFetchData.data;

      assertType<string>(data);
      expect(data).toBe('some data');
    }
  });

  it('error usage', async () => {
    const goFetchData = await go(() => fetchData('throw'));
    if (!goFetchData.success) {
      const error = goFetchData.error;

      expect(error).toEqual(new Error('unexpected error'));
    }
  });

  it('sync usage', () => {
    const someData = { key: 123 };
    const parseData = (rawData: typeof someData) => ({ ...rawData, parsed: true });
    const goParseData = goSync(() => parseData(someData));
    if (goParseData.success) {
      const data = goParseData.data;

      expect(data.parsed).toBe(true);
    }
  });

  it('shows limitation', () => {
    class MyClass {
      constructor() {}
      get() {
        return this._get();
      }
      _get() {
        return '123';
      }
    }

    const myClass = new MyClass();
    const resWorks = goSync(() => myClass.get()); // This works
    assertGoSuccess(resWorks);
    const resFails = goSync(myClass.get); // This doesn't work
    assertGoError(resFails);
  });

  it('verbosity of try catch', async () => {
    class MyError extends Error {
      reason: string;
      constructor(m: string) {
        super(m);
        this.reason = m;
      }
    }
    const someAsyncCall = () => Promise.reject(new MyError('custom error'));
    const logError = (mess: string) => expect(mess).toEqual(expect.any(String));

    // Verbose try catch
    try {
      const data = await someAsyncCall();
      assertType<never>(data); // The function above should throw
    } catch (e) {
      return logError((e as MyError).reason);
    }

    // Compare it to simpler version using go
    type MyData = never;
    const goRes = await go<MyData, MyError>(someAsyncCall);
    if (!goRes.success) return logError(goRes.error.reason);
    // At this point TypeScript infers that the error was handled and goRes must be a success response
    const data = goRes.data;
    assertType<MyData>(data);
  });
});
