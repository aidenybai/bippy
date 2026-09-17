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
    [false, true].flatMap((isCaptureReversed) =>
      [false, true].map((isInputSwapped) => {
        const captures = [
          `const inputFirst = ${isInputSwapped ? "second" : "first"};`,
          `const inputSecond = ${isInputSwapped ? "first" : "second"};`,
        ];
        const expression = order.map((index) => terms[index]).join(" || ");
        const name = `mask=${mask}/order=${order.join("")}/reverse=${isCaptureReversed}/swap=${isInputSwapped}`;
        const isKnown = knownLeftAssociatedOrders.get(mask)?.has(order.join("")) ?? false;
        return {
          name,
          label: `${isKnown ? "known precision gap: " : ""}${name}`,
          isKnown,
          mask,
          isInputSwapped,
          body: `${(isCaptureReversed ? captures.toReversed() : captures).join(" ")} const outer = ${expression}; const inner = ${expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
        };
      }),
    ),
  );
});

it.each(cases)("$label", async ({ name, body, mask, isInputSwapped, isKnown }) => {
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
