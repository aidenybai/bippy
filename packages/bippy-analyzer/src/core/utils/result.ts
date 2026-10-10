/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Utils/Result.ts at b618bbb.

// Direct translation of Rust's Result type, trimmed to the methods the pipeline uses.
export interface Result<T, E> {
  /*
   * Maps a `Result<T, E>` to `Result<U, E>` by applying a function to a contained `Ok` value,
   * leaving an `Err` value untouched.
   */
  map<U>(callback: (val: T) => U): Result<U, E>;
  isOk(): this is OkImpl<T>;
  isErr(): this is ErrImpl<E>;
  // Returns the contained `Ok` value or throws.
  unwrap(): T;
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

  isOk(): this is OkImpl<T> {
    return true;
  }

  isErr(): this is ErrImpl<never> {
    return false;
  }

  unwrap(): T {
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

  isOk(): this is OkImpl<never> {
    return false;
  }

  isErr(): this is ErrImpl<E> {
    return true;
  }

  unwrap(): never {
    if (this.#val instanceof Error) {
      throw this.#val;
    }
    throw new Error(`Can't unwrap \`Err\` to \`Ok\`: ${this.#val}`);
  }

  unwrapErr(): E {
    return this.#val;
  }
}
