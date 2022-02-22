import { go, goSync, success, fail, assertGoSuccess, assertGoError } from './index';
import { assertType, Equal } from 'type-plus';

describe('basic goSync usage', () => {
  it('resolves successful synchronous functions', () => {
    const res = goSync(() => 2 + 2);
    expect(res).toEqual(success(4));
  });

  it('resolves unsuccessful synchronous functions', () => {
    const err = new Error('Computer says no');
    const res = goSync(() => {
      throw err;
    });
    expect(res).toEqual(fail(err));
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
      const [err] = goSync(() => {
        throw new CustomError('custom');
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<Error>(err);
      // Check that "err" is not assignable to CustomError
      assertType.isFalse(false as Equal<CustomError, typeof err>);
      expect(err instanceof CustomError).toBe(true);
    });

    it('can specify custom error type', () => {
      const [err] = goSync<never, CustomError>(() => {
        throw new CustomError('custom');
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<CustomError>(err);
      expect(err instanceof CustomError).toBe(true);
    });

    it('will wraps non error throw in Error class', () => {
      const [err] = goSync(() => {
        throw 'string-error';
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<Error>(err);
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('go', () => {
    it('error handling', async () => {
      const [err] = await go(() => {
        throw new CustomError('custom');
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<Error>(err);
      // Check that "err" is not assignable to CustomError
      assertType.isFalse(false as Equal<CustomError, typeof err>);
      expect(err instanceof CustomError).toBe(true);
    });

    it('can specify custom error type', async () => {
      const [err] = await go<never, CustomError>(() => {
        throw new CustomError('custom');
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<CustomError>(err);
      expect(err instanceof CustomError).toBe(true);
    });

    it('will wraps non error throw in Error class', async () => {
      const [err] = await go(() => {
        throw 'string-error';
      });
      if (!err) {
        expect(err).not.toBeNull();
        return;
      }

      assertType<Error>(err);
      expect(err instanceof Error).toBe(true);
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
});

it('assertGoSuccess works', () => {
  const res = goSync(() => 123);

  assertGoSuccess(res);

  // The "data" property should now be inferred since the success was asserted
  const data = res.data;
  expect(data).toBe(data);
});

it('assertGoError works', () => {
  const res = goSync(() => {
    throw new Error('error');
  });

  assertGoError(res);

  // The "error" property should now be inferred since the success was asserted
  const err = res.error;
  expect(err).toBe(err);
});
