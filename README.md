# promise-utils [![ContinuousBuild](https://github.com/api3dao/promise-utils/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/api3dao/promise-utils/actions/workflows/main.yml)

> A simple package for a functional and typesafe error handling

## Installation

To install this package run either:

`yarn add @api3/promise-utils`

or if you use npm

`npm install @api3/promise-utils --save`

## Usage

The API is small and well focused on the error handling problem. The main functions of this package are `go` and
`goSync` functions. They accept a function to execute. If the function executes without an error, a success response
with the data is returned, otherwise error response is returned.

<!-- NOTE: Keep in sync with the "documentation snippets are valid" test -->

```ts
// Imagine an async function for fetching API data
const goFetchData = await go(() => fetchData('users'));
// The "goFetchData" value is either: {success: true, data: ...} or {success: false, error: ...}
if (goFetchData.success) {
  const data = goFetchData.data
  ...
}
```

or:

```ts
// Imagine an async function for fetching API data
const goFetchData = await go(() => fetchData('users'));
// The "goFetchData" value is either: {success: true, data: ...} or {success: false, error: ...}
if (!goFetchData.success) {
  const error = goFetchData.error
  ...
}
```

and similarly for synchronous functions:

```ts
const someData = ...
// Imagine a synchronous function for parsing data
const goParseData = await goSync(() => parseData(someData));
// The goParseData value is either: {success: true, data: ...} or {success: false, error: ...}
if (goParseData.success) {
  const data = goParseData.data
  ...
}
```

The return value from the promise utils functions works very well with Typescript inference. When you check the the
`success` property, typescript will infer the correct response type.

## API

The full `promise-utils` API consists of the following functions:

- `go(asyncFn)` - Executes the `asyncFn` an returns a response of type `GoResult`
- `goSync(fn)` - Executes the `fn` an returns a response of type `GoResult`
- `assertGoSuccess(goRes)` - Verifies that the `goRes` is a success response (`GoResultSuccess` type) and throws
  otherwise.
- `assertGoError(goRes)` - Verifies that the `goRes` is an error response (`GoResultError` type) and throws otherwise.
- `success(value)` - Creates a successful result value, specifically `{success: true, data: value}`
- `fail(error)` - Creates an error result, specifically `{success: false, error: error}`

and the following Typescript types:

- `GoResult<T> = { data: T; success: true }`
- `GoResultSuccess<E extends Error = Error> = { error: E; success: false }`
- `GoResultError<T, E extends Error = Error> = GoResultSuccess<T> | GoResultError<E>`

Take a look at the [implementation](https://github.com/api3dao/promise-utils/blob/main/src/index.ts) and
[tests](https://github.com/api3dao/promise-utils/blob/main/src/index.test.ts) for detailed examples and usage.

## Motivation

### Verbosity and interoperability of try-catch pattern

```ts
// Verbose try catch
try {
  const data = await someAsyncCall();
  ...
} catch (e) {
  // The "e" is "unknown" because any value can be thrown in Javascript so casting is needed
  return logError((e as MyError).reason);
}

// Compare it to simpler version using go
const goRes = await go<MyData, MyError>(someAsyncCall);
if (!goRes.success) return logError(goRes.error.reason);
// At this point TypeScript infers that the error was handled and "goRes" must be a success response
const data = goRes.data;
...
```

Also, think about what happens when you want to handle multiple "can fail" operations in a single function call. You can
either:

1. Have them in a same try catch block - but then it's difficult to differentiate between what error has been thrown.
   Also this usually leads to a lot of code inside a try block and the catch clause acts more like "catch anything".
2. Use nested try catch blocks - but this hurts readability and forces you into
   [callback hell pattern](http://callbackhell.com/).

### Consistent throwing of an `Error` instance

Javascript supports throwing any expression, not just `Error` instances. This is also a reason why Typescript infers the
error as `unknown` or `any` (see:
[useUnknownInCatchVariables](https://www.typescriptlang.org/tsconfig#useUnknownInCatchVariables)).

The error response from `go` and `goSync` always return an instance of the `Error` class. Of course, throwing custom
errors (derived from `Error`) is supported.

## Limitations

There is a limitation when using class functions due to how javascript
[this](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this) works.

```ts
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
// However, seeing the line above it may be tempting to rewrite it to
const resFails = goSync(myClass.get); // This doesn't work
```

The problem is that the `this` keyword is determined by how a function is called and in the second example, the `this`
insode the `get` function is `undefined` which makes the `this._get()` throw an error.
