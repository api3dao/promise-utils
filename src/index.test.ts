import { go, goSync, success, fail } from './index';

describe('goSync', () => {
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

describe('go', () => {
  it('resolves successful asynchronous functions', async () => {
    const successFn = new Promise(res => res(2));
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
});
