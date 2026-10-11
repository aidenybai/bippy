/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Utils/utils.ts at b618bbb.

/*
 * Trigger an exhaustivess check in TypeScript and throw at runtime.
 *
 * Example:
 *
 * ```ts
 * enum ErrorCode = {
 *    E0001 = "E0001",
 *    E0002 = "E0002"
 * }
 *
 * switch (code) {
 *    case ErrorCode.E0001:
 *      // ...
 *    default:
 *      assertExhaustive(code, "Unhandled error code");
 * }
 * ```
 */
export const assertExhaustive: (_: never, errorMsg: string) => never = (_, errorMsg) => {
  throw new Error(errorMsg);
};

// Modifies @param array in place, retaining only the items where the predicate returns true.
export const retainWhere = <T>(
  array: Array<T>,
  predicate: (item: T, index: number) => boolean,
): void => {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < array.length; readIndex++) {
    const item = array[readIndex]!;
    if (predicate(item, readIndex) === true) {
      array[writeIndex++] = item;
    }
  }
  array.length = writeIndex;
};

export const getOrInsertWith = <U, V>(map: Map<U, V>, key: U, makeDefault: () => V): V => {
  const existing = map.get(key);
  if (existing !== undefined || map.has(key)) {
    return existing as V;
  }
  const defaultValue = makeDefault();
  map.set(key, defaultValue);
  return defaultValue;
};

export const getOrInsertDefault = <U, V>(map: Map<U, V>, key: U, defaultValue: V): V => {
  const existing = map.get(key);
  if (existing !== undefined || map.has(key)) {
    return existing as V;
  }
  map.set(key, defaultValue);
  return defaultValue;
};

/**
 * @returns `true` if `a` is a superset of `b`.
 */
export const Set_isSuperset = <T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): boolean => {
  for (const value of setB) {
    if (!setA.has(value)) {
      return false;
    }
  }
  return true;
};

export const Iterable_some = <T>(
  iterable: Iterable<T>,
  predicate: (item: T) => boolean,
): boolean => {
  for (const item of iterable) {
    if (predicate(item)) {
      return true;
    }
  }
  return false;
};

export const hasOwnProperty = <T>(object: T, key: string | number | symbol): key is keyof T =>
  Object.prototype.hasOwnProperty.call(object, key);
