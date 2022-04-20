import { go, goSync, success, fail, assertGoSuccess, assertGoError, GoWrappedError } from './index';
import { assertType, Equal } from 'type-plus';

const expectToBeAround = (actual: number, expected: number, range = 10) => {
  expect(actual).toBeGreaterThanOrEqual(expected - range);
  expect(actual).toBeLessThanOrEqual(expected + range);
};

const resolveAfter = <T>(ms: number, value?: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value as T), ms));
const rejectAfter = <T>(ms: number, value?: T): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(value), ms));

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
    const res = await go(() => successFn);
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions', async () => {
    const err = new Error('Computer says no');
    const errorFn = new Promise((_res, rej) => rej(err));
    const res = await go(() => errorFn);
    expect(res).toEqual(fail(err));
  });

  it('resolves asynchronous functions which throws', async () => {
    const err = new Error('Computer says no');
    const errorFn = new Promise(() => {
      throw err;
    });
    const res = await go(() => errorFn);
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

describe('basic retry usage', () => {
  const operations = {
    successFn: () => new Promise((res) => res(2)),
    errorFn: () => new Promise((_res, rej) => rej(new Error('Computer says no'))),
  };

  it('retries the specified number of times', async () => {
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'));

    const res = await go(operations.successFn, { retries: 2 });
    expect(operations.successFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(success(2));
  });

  it('retries and resolves unsuccessful asynchronous functions with the error from last retry', async () => {
    const attempts = 3;
    jest
      .spyOn(operations, 'errorFn')
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'));

    const res = await go(operations.errorFn, { retries: 2 });
    expect(operations.errorFn).toHaveBeenCalledTimes(attempts);
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('resolves unsuccessful asynchronous functions with no retries', async () => {
    jest.spyOn(operations, 'errorFn').mockRejectedValueOnce(new Error('Computer says no'));

    const res = await go(operations.errorFn, { retries: 0 });
    expect(operations.errorFn).toHaveBeenCalledTimes(1);
    expect(res).toEqual(fail(new Error('Computer says no')));
  });
});

describe('basic timeout usage', () => {
  const operations = {
    successFn: () => resolveAfter(10, 2),
    errorFn: () => rejectAfter(10, new Error('Computer says no')),
  };

  it('resolves successful asynchronous functions within the timout limit', async () => {
    const res = await go(operations.successFn, { attemptTimeoutMs: 20 });
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions within the timout limit', async () => {
    const res = await go(operations.errorFn, { attemptTimeoutMs: 20 });
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('resolves timed out asynchronous functions', async () => {
    const res = await go(operations.successFn, { attemptTimeoutMs: 5 });
    expect(res).toEqual(fail(new Error('Operation timed out')));
  });

  it('shows difference between promise callback and promise value', async () => {
    // Promise value tries to resolve THE SAME promise every attempt
    const sleepPromise = resolveAfter(50);
    const goVal = await go(() => sleepPromise, { attemptTimeoutMs: 30, retries: 1 });
    expect(goVal).toEqual(success(undefined));

    // Promise callback tries to resolve NEW promise every attempt
    const goFn = await go(() => resolveAfter(50), { attemptTimeoutMs: 30, retries: 1 });
    expect(goFn).toEqual(fail(new Error('Operation timed out')));
  });

  it('shows that timeout 0 means 0 ms (not infinity)', async () => {
    const res = await go(operations.successFn, { attemptTimeoutMs: 0 });
    expect(res).toEqual(fail(new Error('Operation timed out')));
  });
});

describe('basic retry and timeout usage', () => {
  const operations = {
    successFn: () => resolveAfter(20, 2),
    errorFn: () => rejectAfter(20, new Error('Computer says no')),
  };

  it('resolves successful asynchronous functions', async () => {
    const res = await go(operations.successFn, { attemptTimeoutMs: 50, retries: 3 });
    expect(res).toEqual(success(2));
  });

  it('resolves unsuccessful asynchronous functions', async () => {
    const res = await go(operations.errorFn, { attemptTimeoutMs: 50, retries: 3 });
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('retries and resolves successful asynchronous functions', async () => {
    jest
      .spyOn(operations, 'successFn')
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'));

    const res = await go(operations.successFn, { attemptTimeoutMs: 100, retries: 3 });
    expect(operations.successFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(success(2));
  });

  it('retries and resolves unsuccessful asynchronous functions', async () => {
    jest
      .spyOn(operations, 'errorFn')
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'));

    const res = await go(operations.errorFn, { attemptTimeoutMs: 100, retries: 2 });
    expect(operations.errorFn).toHaveBeenCalledTimes(3);
    expect(res).toEqual(fail(new Error('Computer says no')));
  });

  it('retries and resolves unsuccessful timed out functions', async () => {
    const attempts = 3;
    jest.spyOn(operations, 'successFn');

    const res = await go(operations.successFn, { attemptTimeoutMs: 5, retries: 2 });
    expect(operations.successFn).toHaveBeenCalledTimes(attempts);
    expect(res).toEqual(fail(new Error('Operation timed out')));
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

it('has access to native error', async () => {
  const throwingFn = async () => {
    throw { message: 'an error', data: 'some data' };
  };

  const goRes = await go<never, GoWrappedError>(throwingFn);

  assertGoError(goRes);
  // The error message is the  not very useful stringified data
  expect(goRes.error).toEqual(new Error('[object Object]'));
  expect(goRes.error instanceof GoWrappedError).toBeTruthy();
  expect(goRes.error.reason).toEqual({ message: 'an error', data: 'some data' });
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

describe('delay', () => {
  it('only delays on retries', async () => {
    const goRes = await go(async () => 123, { delay: { type: 'static', delayMs: 2000 } });
    expect(goRes).toEqual(success(123));
  }, 20); // Make the test timeout smaller then the delay

  describe('random', () => {
    it('waits for a random period of time before retry', async () => {
      const now = Date.now();
      const ticks: number[] = [];

      jest.spyOn(global.Math, 'random').mockReturnValueOnce(0.5);
      jest.spyOn(global.Math, 'random').mockReturnValueOnce(1);

      await go(
        async () => {
          ticks.push(Date.now() - now);
          throw new Error();
        },
        { delay: { type: 'random', minDelayMs: 0, maxDelayMs: 100 }, retries: 2 }
      );

      expect(ticks.length).toBe(3);
      expectToBeAround(ticks[0]!, 0);
      expectToBeAround(ticks[1]!, 50);
      expectToBeAround(ticks[2]!, 150);
    });
  });

  describe('static', () => {
    it('waits for a fixed period of time before retry', async () => {
      const now = Date.now();
      const ticks: number[] = [];

      await go(
        async () => {
          ticks.push(Date.now() - now);
          throw new Error();
        },
        { delay: { type: 'static', delayMs: 50 }, retries: 2 }
      );

      expect(ticks.length).toBe(3);
      expectToBeAround(ticks[0]!, 0);
      expectToBeAround(ticks[1]!, 50);
      expectToBeAround(ticks[2]!, 100);
    });
  });
});

describe('totalTimeoutMs', () => {
  it('stops retying after the full timeout is exceeded', async () => {
    const now = Date.now();
    const ticks: number[] = [];

    await go(
      async () => {
        ticks.push(Date.now() - now);
        throw new Error();
      },
      { delay: { type: 'static', delayMs: 50 }, retries: 150, totalTimeoutMs: 150 }
    );

    expect(ticks.length).toBe(3);
    expectToBeAround(ticks[0]!, 0);
    expectToBeAround(ticks[1]!, 50);
    expectToBeAround(ticks[2]!, 100);
  });

  it('runs the go callback at least once independently of full timeout', async () => {
    const now = Date.now();
    const ticks: number[] = [];

    await go(
      async () => {
        ticks.push(Date.now() - now);
        throw new Error();
      },
      { delay: { type: 'static', delayMs: 50 }, retries: 10, totalTimeoutMs: 0 }
    );

    expect(ticks.length).toBe(1);
    expectToBeAround(ticks[0]!, 0);
  });

  it('resolves the value immediately after the timeout has exceeded', async () => {
    const now = Date.now();

    const goRes = await go(
      async () => {
        await resolveAfter(50);
      },
      { delay: { type: 'static', delayMs: 50 }, retries: 1, totalTimeoutMs: 20 }
    );

    const delta = Date.now() - now;
    expectToBeAround(delta, 20);
    expect(goRes).toEqual(fail(new Error('Full timeout exceeded')));
  });
});

describe('afterFailedAttempt', () => {
  it('calls the function after every unsuccessfull attempt', async () => {
    const afterFailedAttempt = jest.fn();

    let counter = 0;
    await go(
      async () => {
        counter++;
        throw new Error('fail' + counter);
      },
      { retries: 3, afterFailedAttempt }
    );

    expect(afterFailedAttempt).toBeCalledTimes(4);
    expect(afterFailedAttempt).toHaveBeenNthCalledWith(1, { error: new Error('fail1'), success: false });
    expect(afterFailedAttempt).toHaveBeenNthCalledWith(2, { error: new Error('fail2'), success: false });
    expect(afterFailedAttempt).toHaveBeenNthCalledWith(3, { error: new Error('fail3'), success: false });
    expect(afterFailedAttempt).toHaveBeenNthCalledWith(4, { error: new Error('fail4'), success: false });
  });

  it('triggers the callback after total timeout has been exceeded', async () => {
    const afterFailedAttempt = jest.fn();

    await go(
      async () => {
        await resolveAfter(50);
      },
      { retries: 3, totalTimeoutMs: 20, afterFailedAttempt }
    );

    expect(afterFailedAttempt).toHaveBeenCalledTimes(1);
    expect(afterFailedAttempt).toHaveBeenCalledWith({ error: new Error('Full timeout exceeded'), success: false });
  });

  it('does not call the callback after successful attempt', async () => {
    const afterFailedAttempt = jest.fn();

    await go(async () => Promise.resolve(123), { afterFailedAttempt });

    expect(afterFailedAttempt).toHaveBeenCalledTimes(0);
  });

  describe('calls only once for unsuccessfull attempt', () => {
    it('and attempt timeout', async () => {
      const afterFailedAttempt = jest.fn();

      await go(
        async () => {
          await resolveAfter(20);
        },
        { attemptTimeoutMs: 10, afterFailedAttempt }
      );
      // Make sure the attempt inside the go function above is completed
      await resolveAfter(30);

      expect(afterFailedAttempt).toHaveBeenCalledTimes(1);
      expect(afterFailedAttempt).toHaveBeenCalledWith({ error: new Error('Operation timed out'), success: false });
    });

    it('and total timeout', async () => {
      const afterFailedAttempt = jest.fn();

      await go(
        async () => {
          await resolveAfter(20);
        },
        { totalTimeoutMs: 10, afterFailedAttempt }
      );
      // Make sure the attempt inside the go function above is completed
      await resolveAfter(30);

      expect(afterFailedAttempt).toHaveBeenCalledTimes(1);
      expect(afterFailedAttempt).toHaveBeenCalledWith({ error: new Error('Full timeout exceeded'), success: false });
    });

    it('both attemp timeout and total timeout', async () => {
      const afterFailedAttempt = jest.fn();

      await go(
        async () => {
          await resolveAfter(20);
        },
        { retries: 2, attemptTimeoutMs: 10, totalTimeoutMs: 25, afterFailedAttempt }
      );
      // Make sure the attempt inside the go function above is completed
      await resolveAfter(50);

      expect(afterFailedAttempt).toHaveBeenCalledTimes(3);
      expect(afterFailedAttempt).toHaveBeenNthCalledWith(1, {
        error: new Error('Operation timed out'),
        success: false,
      });
      expect(afterFailedAttempt).toHaveBeenNthCalledWith(2, {
        error: new Error('Operation timed out'),
        success: false,
      });
      expect(afterFailedAttempt).toHaveBeenNthCalledWith(3, {
        error: new Error('Full timeout exceeded'),
        success: false,
      });
    });
  });

  it('is automatically typed', async () => {
    class CustomError extends Error {
      custom: string;

      constructor(message: string) {
        super(message);
        this.custom = '123';
      }
    }

    await go<never, CustomError>(
      async () => {
        throw new CustomError('fail');
      },
      {
        retries: 3,
        afterFailedAttempt: (goRes) => {
          expect(goRes).toEqual(success(123));

          assertGoError(goRes);
          assertType<CustomError>(goRes.error);
        },
      }
    );
  });

  it('accepts, but does not wait for async callback finish', async () => {
    const log: string[] = [];
    let counter = 0;

    await go(
      async () => {
        counter++;
        const m = 'fail' + counter;
        log.push(`go callback: ${m}`);
        throw new Error(m);
      },
      {
        retries: 1,
        afterFailedAttempt: async (goRes) => {
          log.push(`afterFailedAttempt: ${JSON.stringify(goRes)}`);

          await resolveAfter(20);

          log.push(`afterFailedAttempt (after sleep): ${JSON.stringify(goRes)}`);
        },
      }
    );

    expect(log).toEqual([
      'go callback: fail1',
      'afterFailedAttempt: {"success":false,"error":{}}',
      'go callback: fail2',
      'afterFailedAttempt: {"success":false,"error":{}}',
    ]);
    await resolveAfter(50); // We need to wait for unfinished afterFailedAttempt callbacks
    expect(log).toEqual([
      'go callback: fail1',
      'afterFailedAttempt: {"success":false,"error":{}}',
      'go callback: fail2',
      'afterFailedAttempt: {"success":false,"error":{}}',
      'afterFailedAttempt (after sleep): {"success":false,"error":{}}',
      'afterFailedAttempt (after sleep): {"success":false,"error":{}}',
    ]);
  });
});
