import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

interface PredicateEncoding {
  name: string;
  expression: string;
}

const encodings: PredicateEncoding[] = [
  {
    name: "three-minterm-nand",
    expression:
      "(!inputFirst && !inputSecond) || (!inputFirst && inputSecond) || (inputFirst && !inputSecond)",
  },
  { name: "de-morgan-nand", expression: "!inputFirst || !inputSecond" },
  { name: "negated-and", expression: "!(inputFirst && inputSecond)" },
  { name: "ternary-nand", expression: "inputFirst ? !inputSecond : true" },
];

const cases = encodings.flatMap((encoding) =>
  [false, true].map((isCached) => ({
    name: `${encoding.name}/cached=${isCached}`,
    label: `${encoding.name === "three-minterm-nand" && !isCached ? "known precision gap: " : ""}${encoding.name}/cached=${isCached}`,
    isKnown: encoding.name === "three-minterm-nand" && !isCached,
    body: `const inputFirst = first; const inputSecond = second; const outer = ${encoding.expression}; const inner = ${isCached ? "outer" : encoding.expression}; if (outer) { if (inner) return 'TT'; return 'TF'; } if (inner) return 'FT'; return 'FF';`,
  })),
);

it.each(cases)("$label", async ({ name, body, isKnown }) => {
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const witness = { name, body, expected: ["TT", "FF"], actual: "[ 'TT', 'TF', 'FT', 'FF' ]" };
  const failure: unknown = await checkSymbolicCases([witness]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([witness]);
});

it("matches all 32 concrete normal-form pins", () =>
  checkDifferentialCases(
    cases.flatMap((testCase) =>
      [false, true].flatMap((first) =>
        [false, true].map((second) => ({
          name: `${testCase.name}/first=${first}/second=${second}`,
          body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
        })),
      ),
    ),
  ));
