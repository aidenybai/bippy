import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { booleanTermOrders, getBooleanMinterms } from "./helpers/boolean-predicates.js";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

const allReversals = Array.from({ length: 8 }, (_value, index) => index);
const knownReversals = new Map<number, number[][]>([
  [
    7,
    [
      [0, 1, 6, 7],
      [4, 5, 6, 7],
      [0, 1, 4, 5],
    ],
  ],
  [11, [[2, 3, 6, 7], allReversals, [0, 1, 4, 5]]],
  [13, [[0, 1, 4, 5], allReversals, [2, 3, 6, 7]]],
  [
    14,
    [
      [0, 1, 4, 5],
      [1, 3, 5, 7],
      [0, 3, 4, 7],
    ],
  ],
]);
const cases = [7, 11, 13, 14].flatMap((mask) =>
  booleanTermOrders.flatMap((order) =>
    Array.from({ length: 8 }, (_value, reversedTerms) => {
      const terms = getBooleanMinterms(mask, reversedTerms);
      const expression = order.map((index) => terms[index]).join(" || ");
      const name = `mask=${mask}/order=${order.join("")}/reversed=${reversedTerms}`;
      const lastTerm = order.at(-1);
      const isKnown =
        lastTerm !== undefined &&
        (knownReversals.get(mask)?.[lastTerm]?.includes(reversedTerms) ?? false);
      return {
        name,
        label: `${isKnown ? "known precision gap: " : ""}${name}`,
        isKnown,
        mask,
        body: `const inputFirst = first; const inputSecond = second; const outer = ${expression}; const inner = ${expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
      };
    }),
  ),
);

it.each(cases)("$label", async ({ name, body, mask, isKnown }) => {
  for (let index = 0; index < 4; index++) {
    expect(
      runInNewContext(
        `"use strict"; (() => { ${body} })()`,
        { first: !!(index & 2), second: !!(index & 1) },
        { timeout: 1000 },
      ),
    ).toBe(mask & (1 << index) ? "TT" : "FF");
  }
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const witness = {
    name,
    body,
    expected: mask === 14 ? ["FF", "TT"] : ["TT", "FF"],
    actual: "[ 'TT', 'TF', 'FT', 'FF' ]",
  };
  const failure: unknown = await checkSymbolicCases([witness]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([witness]);
});

it.each([7, 11, 13, 14])("matches all concrete factor-order pins for mask %i", (mask) =>
  checkDifferentialCases(
    cases
      .filter((testCase) => testCase.mask === mask)
      .flatMap((testCase) =>
        Array.from({ length: 4 }, (_value, index) => ({
          name: `${testCase.name}/assignment=${index}`,
          body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
        })),
      ),
  ),
);
