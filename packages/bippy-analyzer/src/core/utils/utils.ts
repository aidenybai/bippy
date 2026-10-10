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

export const getOrInsertDefault = <U, V>(map: Map<U, V>, key: U, defaultValue: V): V => {
  if (!map.has(key)) map.set(key, defaultValue);
  return map.get(key)!;
};
