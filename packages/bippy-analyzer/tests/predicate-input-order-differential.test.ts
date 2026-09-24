import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { booleanTermOrders, getBooleanMinterms } from "./helpers/boolean-predicates.js";
import { checkSymbolicCases, checkDifferentialCases } from "./helpers/differential-evaluator.js";

const cases = [7, 11, 13, 14].flatMap((mask) => {
  const terms = getBooleanMinterms(mask);
  return booleanTermOrders.flatMap((order) =>
    [false, true].flatMap((isCaptureReversed) =>
      [false, true].map((isInputSwapped) => {
        const captures = [
          `const inputFirst = ${isInputSwapped ? "second" : "first"};`,
          `const inputSecond = ${isInputSwapped ? "first" : "second"};`,
        ];
        const expression = order.map((index) => terms[index]).join(" || ");
        const name = `mask=${mask}/order=${order.join("")}/reverse=${isCaptureReversed}/swap=${isInputSwapped}`;
        return {
          name,
          mask,
          isInputSwapped,
          body: `${(isCaptureReversed ? captures.toReversed() : captures).join(" ")} const outer = ${expression}; const inner = ${expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
        };
      }),
    ),
  );
});

it.each(cases)("$name", async ({ name, body, mask, isInputSwapped }) => {
  for (let index = 0; index < 4; index++) {
    const assignment = isInputSwapped ? ((index & 1) << 1) | ((index & 2) >> 1) : index;
    expect(
      runInNewContext(
        `"use strict"; (() => { ${body} })()`,
        { first: !!(index & 2), second: !!(index & 1) },
        { timeout: 1000 },
      ),
    ).toBe(mask & (1 << assignment) ? "TT" : "FF");
  }
  await checkSymbolicCases([{ name, body }]);
});

it.each([7, 11, 13, 14])("matches all concrete input-order pins for mask %i", (mask) =>
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
