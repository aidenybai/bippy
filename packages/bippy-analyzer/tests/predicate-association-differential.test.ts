import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { booleanTermOrders, getBooleanMinterms } from "./helpers/boolean-predicates.js";
import { checkSymbolicCases, checkDifferentialCases } from "./helpers/differential-evaluator.js";

const cases = [7, 11, 13, 14].flatMap((mask) => {
  const terms = getBooleanMinterms(mask);
  return booleanTermOrders.flatMap((order) =>
    [false, true].flatMap((isRightAssociated) =>
      [false, true].map((isCached) => {
        const [firstTerm, secondTerm, thirdTerm] = order.map((index) => terms[index]);
        const expression = isRightAssociated
          ? `${firstTerm} || (${secondTerm} || ${thirdTerm})`
          : `(${firstTerm} || ${secondTerm}) || ${thirdTerm}`;
        const name = `mask=${mask}/order=${order.join("")}/right=${isRightAssociated}/cached=${isCached}`;
        return {
          name,
          mask,
          body: `const inputFirst = first; const inputSecond = second; const outer = ${expression}; const inner = ${isCached ? "outer" : expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
        };
      }),
    ),
  );
});

it.each(cases)("$name", async ({ name, body, mask }) => {
  for (let index = 0; index < 4; index++) {
    expect(
      runInNewContext(
        `"use strict"; (() => { ${body} })()`,
        { first: !!(index & 2), second: !!(index & 1) },
        { timeout: 1000 },
      ),
    ).toBe(mask & (1 << index) ? "TT" : "FF");
  }
  await checkSymbolicCases([{ name, body }]);
});

it.each([7, 11, 13, 14])("matches all concrete association pins for mask %i", (mask) =>
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
