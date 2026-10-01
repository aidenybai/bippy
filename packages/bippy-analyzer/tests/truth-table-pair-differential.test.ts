import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { getBooleanMinterms } from "./helpers/boolean-predicates.js";
import { checkSymbolicCases, checkDifferentialCases } from "./helpers/differential-evaluator.js";

const getCondition = (mask: number): string => {
  if (mask === 0) return "false";
  if (mask === 15) return "true";
  return getBooleanMinterms(mask).join(" || ");
};

const cases = Array.from({ length: 16 }, (_value, outerMask) => outerMask).flatMap((outerMask) =>
  Array.from({ length: 16 }, (_value, innerMask) => ({
    name: `outer=${outerMask}/inner=${innerMask}`,
    outerMask,
    outcomes: Array.from(
      { length: 4 },
      (_value, index) =>
        `${outerMask & (1 << index) ? "T" : "F"}${innerMask & (1 << index) ? "T" : "F"}`,
    ),
    body: `const inputFirst = first; const inputSecond = second; const outer = ${getCondition(outerMask)}; const inner = ${getCondition(innerMask)}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
  })),
);

it.each(cases)("$name", async ({ name, body, outcomes }) => {
  const native = Array.from({ length: 4 }, (_value, index) =>
    runInNewContext(
      `"use strict"; (() => { ${body} })()`,
      { first: !!(index & 2), second: !!(index & 1) },
      { timeout: 1000 },
    ),
  );
  expect(native).toEqual(outcomes);
  await checkSymbolicCases([{ name, body }]);
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
