/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Utils/Result.ts at b618bbb.

// Direct translation of Rust's Result type, although some ownership related methods are omitted.
export interface Result<T, E> {
  /*
   * Maps a `Result<T, E>` to `Result<U, E>` by applying a function to a contained `Ok` value,
   * leaving an `Err` value untouched.
   *
   * This function can be used to compose the results of two functions.
   */
  map<U>(callback: (val: T) => U): Result<U, E>;
  /*
   * Maps a `Result<T, E>` to `Result<T, F>` by applying a function to a contained `Err` value,
   * leaving an `Ok` value untouched.
   *
   * This function can be used to pass through a successful result while handling an error.
   */
  mapErr<F>(callback: (val: E) => F): Result<T, F>;
  /*
   * Returns the provided default (if `Err`), or applies a function to the contained value
   * (if `Ok`).
   *
   * Arguments passed to {@link mapOr} are eagerly evaluated; if you are passing the result of a
   * function call, it is recommended to use {@link mapOrElse}, which is lazily evaluated.
   */
  mapOr<U>(fallback: U, callback: (val: T) => U): U;
  /*
   * Maps a `Result<T, E>` to `U` by applying fallback function default to a contained `Err` value,
   * or function `callback` to a contained `Ok` value.
   *
   * This function can be used to unpack a successful result while handling an error.
   */
  mapOrElse<U>(fallback: () => U, callback: (val: T) => U): U;
  /*
   * Calls `callback` if the result is `Ok`, otherwise returns the `Err` value of self.
   *
   * This function can be used for control flow based on Result values.
   */
  andThen<U>(callback: (val: T) => Result<U, E>): Result<U, E>;
  /*
   * Returns result if the result is `Ok`, otherwise returns the `Err` value of self.
   *
   * Arguments passed to {@link and} are eagerly evaluated; if you are passing the result of a
   * function call, it is recommended to use {@link andThen}, which is lazily evaluated.
   */
  and<U>(result: Result<U, E>): Result<U, E>;
  /*
   * Returns `result` if the result is `Err`, otherwise returns the `Ok` value of self.
   *
   * Arguments passed to {@link or} are eagerly evaluated; if you are passing the result of a
   * function call, it is recommended to use {@link orElse}, which is lazily evaluated.
   */
  or(result: Result<T, E>): Result<T, E>;
  /*
   * Calls `callback` if the result is `Err`, otherwise returns the `Ok` value of self.
   *
   * This function can be used for control flow based on result values.
   */
  orElse<F>(callback: (val: E) => Result<T, F>): Result<T, F>;
  // Returns `true` if the result is `Ok`.
  isOk(): this is OkImpl<T>;
  // Returns `true` if the result is `Err`.
  isErr(): this is ErrImpl<E>;
  // Returns the contained `Ok` value or throws.
  expect(msg: string): T;
  // Returns the contained `Err` value or throws.
  expectErr(msg: string): E;
  // Returns the contained `Ok` value.
  unwrap(): T;
  /*
   * Returns the contained `Ok` value or a provided default.
   *
   * Arguments passed to {@link unwrapOr} are eagerly evaluated; if you are passing the result of a
   * function call, it is recommended to use {@link unwrapOrElse}, which is lazily evaluated.
   */
  unwrapOr(fallback: T): T;
  // Returns the contained `Ok` value or computes it from a closure.
  unwrapOrElse(fallback: (val: E) => T): T;
  // Returns the contained `Err` value or throws.
  unwrapErr(): E;
}

export const Ok = <T>(val: T): OkImpl<T> => new OkImpl(val);

class OkImpl<T> implements Result<T, never> {
  #val: T;
  constructor(val: T) {
    this.#val = val;
  }

  map<U>(callback: (val: T) => U): Result<U, never> {
    return new OkImpl(callback(this.#val));
  }

  mapErr<F>(_callback: (val: never) => F): Result<T, F> {
    return this;
  }

  mapOr<U>(_fallback: U, callback: (val: T) => U): U {
    return callback(this.#val);
  }

  mapOrElse<U>(_fallback: () => U, callback: (val: T) => U): U {
    return callback(this.#val);
  }

  andThen<U>(callback: (val: T) => Result<U, never>): Result<U, never> {
    return callback(this.#val);
  }

  and<U>(result: Result<U, never>): Result<U, never> {
    return result;
  }

  or(_result: Result<T, never>): Result<T, never> {
    return this;
  }

  orElse<F>(_callback: (val: never) => Result<T, F>): Result<T, F> {
    return this;
  }

  isOk(): this is OkImpl<T> {
    return true;
  }

  isErr(): this is ErrImpl<never> {
    return false;
  }

  expect(_msg: string): T {
    return this.#val;
  }

  expectErr(msg: string): never {
    throw new Error(`${msg}: ${this.#val}`);
  }

  unwrap(): T {
    return this.#val;
  }

  unwrapOr(_fallback: T): T {
    return this.#val;
  }

  unwrapOrElse(_fallback: (val: never) => T): T {
    return this.#val;
  }

  unwrapErr(): never {
    if (this.#val instanceof Error) {
      throw this.#val;
    }
    throw new Error(`Can't unwrap \`Ok\` to \`Err\`: ${this.#val}`);
  }
}

export const Err = <E>(val: E): ErrImpl<E> => new ErrImpl(val);

class ErrImpl<E> implements Result<never, E> {
  #val: E;
  constructor(val: E) {
    this.#val = val;
  }

  map<U>(_callback: (val: never) => U): Result<U, E> {
    return this;
  }

  mapErr<F>(callback: (val: E) => F): Result<never, F> {
    return new ErrImpl(callback(this.#val));
  }

  mapOr<U>(fallback: U, _callback: (val: never) => U): U {
    return fallback;
  }

  mapOrElse<U>(fallback: () => U, _callback: (val: never) => U): U {
    return fallback();
  }

  andThen<U>(_callback: (val: never) => Result<U, E>): Result<U, E> {
    return this;
  }

  and<U>(_result: Result<U, E>): Result<U, E> {
    return this;
  }

  or(result: Result<never, E>): Result<never, E> {
    return result;
  }

  orElse<F>(callback: (val: E) => ErrImpl<F>): Result<never, F> {
    return callback(this.#val);
  }

  isOk(): this is OkImpl<never> {
    return false;
  }

  isErr(): this is ErrImpl<E> {
    return true;
  }

  expect(msg: string): never {
    throw new Error(`${msg}: ${this.#val}`);
  }

  expectErr(_msg: string): E {
    return this.#val;
  }

  unwrap(): never {
    if (this.#val instanceof Error) {
      throw this.#val;
    }
    throw new Error(`Can't unwrap \`Err\` to \`Ok\`: ${this.#val}`);
  }

  unwrapOr<T>(fallback: T): T {
    return fallback;
  }

  unwrapOrElse<T>(fallback: (val: E) => T): T {
    return fallback(this.#val);
  }

  unwrapErr(): E {
    return this.#val;
  }
}
