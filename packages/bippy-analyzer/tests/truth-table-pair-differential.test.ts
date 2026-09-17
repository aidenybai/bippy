import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { getBooleanMinterms } from "./helpers/boolean-predicates.js";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

const getCondition = (mask: number): string => {
  if (mask === 0) return "false";
  if (mask === 15) return "true";
  return getBooleanMinterms(mask).join(" || ");
};

const nonconstantMasks = Array.from({ length: 14 }, (_value, index) => index + 1);
const fullExpansionRows = [
  [],
  [7, 11],
  [7, 11, 14],
  [7, 11, 14],
  [14],
  [7, 11, 14],
  [7, 11, 14],
  nonconstantMasks,
  [],
  [7, 11, 14],
  [7, 11, 14],
  nonconstantMasks,
  [7, 11, 14],
  [6, 7, 10, 11, 14],
  nonconstantMasks,
  [],
];
const partialExpansionPairs = new Set(["1:14", "4:11", "8:7"]);

const cases = Array.from({ length: 16 }, (_value, outerMask) => outerMask).flatMap((outerMask) =>
  Array.from({ length: 16 }, (_value, innerMask) => ({
    name: `outer=${outerMask}/inner=${innerMask}`,
    outerMask,
    actual: fullExpansionRows[outerMask]?.includes(innerMask)
      ? "[ 'TT', 'TF', 'FT', 'FF' ]"
      : partialExpansionPairs.has(`${outerMask}:${innerMask}`)
        ? "[ 'TF', 'FT', 'FF' ]"
        : undefined,
    outcomes: Array.from(
      { length: 4 },
      (_value, index) =>
        `${outerMask & (1 << index) ? "T" : "F"}${innerMask & (1 << index) ? "T" : "F"}`,
    ),
    body: `const inputFirst = first; const inputSecond = second; const outer = ${getCondition(outerMask)}; const inner = ${getCondition(innerMask)}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
  })),
);

it.each(
  cases.map((testCase) => ({
    ...testCase,
    label: `${testCase.actual === undefined ? "" : "known precision gap: "}${testCase.name}`,
  })),
)("$label", async ({ name, body, outcomes, actual }) => {
  const native = Array.from({ length: 4 }, (_value, index) =>
    runInNewContext(
      `"use strict"; (() => { ${body} })()`,
      { first: !!(index & 2), second: !!(index & 1) },
      { timeout: 1000 },
    ),
  );
  expect(native).toEqual(outcomes);
  if (actual === undefined) {
    await checkSymbolicCases([{ name, body }]);
  } else {
    const witness = { name, body, expected: [...new Set(outcomes)], actual };
    const failure: unknown = await checkSymbolicCases([witness]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DifferentialMismatch);
    if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([witness]);
  }
});

it.each(Array.from({ length: 16 }, (_value, index) => index))(
  "matches all concrete truth-table pins for outer mask %i",
  (outerMask) =>
    checkDifferentialCases(
      cases
        .filter((testCase) => testCase.outerMask === outerMask)
        .flatMap((testCase) =>
          Array.from({ length: 4 }, (_value, index) => ({
            name: `${testCase.name}/assignment=${index}`,
            body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
          })),
        ),
    ),
);
