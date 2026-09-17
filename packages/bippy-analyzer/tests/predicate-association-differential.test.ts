import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  booleanTermOrders,
  getBooleanMinterms,
  knownLeftAssociatedOrders,
} from "./helpers/boolean-predicates.js";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

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
        const isKnown =
          !isRightAssociated &&
          !isCached &&
          (knownLeftAssociatedOrders.get(mask)?.has(order.join("")) ?? false);
        return {
          name,
          label: `${isKnown ? "known precision gap: " : ""}${name}`,
          isKnown,
          mask,
          body: `const inputFirst = first; const inputSecond = second; const outer = ${expression}; const inner = ${isCached ? "outer" : expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
        };
      }),
    ),
  );
});

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
