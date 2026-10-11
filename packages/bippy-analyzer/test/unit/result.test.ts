/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/__tests__/Result-test.ts at b618bbb.

import { describe, expect, it } from "vite-plus/test";
import { Err, Ok } from "../../src/react-compiler/utils/result.js";
import type { Result } from "../../src/react-compiler/utils/result.js";

const addMax10 = (a: number, b: number): Result<number, string> => {
  const sum = a + b;
  return sum > 10 ? Err(`${sum} is too high`) : Ok(sum);
};

class CustomDummyError extends Error {}

describe("Result", () => {
  it(".map", () => {
    expect(addMax10(1, 1).map((sum) => sum * 2)).toEqual(Ok(4));
    expect(addMax10(10, 10).map((sum) => sum * 2)).toEqual(Err("20 is too high"));
  });

  it(".isOk", () => {
    expect(addMax10(1, 1).isOk()).toBeTruthy();
    expect(addMax10(10, 10).isOk()).toBeFalsy();
  });

  it(".isErr", () => {
    expect(addMax10(1, 1).isErr()).toBeFalsy();
    expect(addMax10(10, 10).isErr()).toBeTruthy();
  });

  it(".unwrap", () => {
    expect(addMax10(1, 1).unwrap()).toEqual(2);
    expect(() => addMax10(10, 10).unwrap()).toThrowErrorMatchingInlineSnapshot(
      `[Error: Can't unwrap \`Err\` to \`Ok\`: 20 is too high]`,
    );
    expect(() => Err(new CustomDummyError("oops")).unwrap()).toThrowErrorMatchingInlineSnapshot(
      `[Error: oops]`,
    );
  });

  it(".unwrapErr", () => {
    expect(() => addMax10(1, 1).unwrapErr()).toThrowErrorMatchingInlineSnapshot(
      `[Error: Can't unwrap \`Ok\` to \`Err\`: 2]`,
    );
    expect(addMax10(10, 10).unwrapErr()).toEqual("20 is too high");
    expect(() => Ok(new CustomDummyError("oops")).unwrapErr()).toThrowErrorMatchingInlineSnapshot(
      `[Error: oops]`,
    );
  });
});
