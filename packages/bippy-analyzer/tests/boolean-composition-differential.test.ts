import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

interface BooleanConsumer {
  name: string;
  getSource: (condition: string) => string;
  getExpected: (condition: boolean) => string;
  actual: string;
}

interface BooleanCondition {
  source: string;
  getValue: (first: boolean, second: boolean) => boolean;
  hasConjunctionGap?: boolean;
}

const consumers: BooleanConsumer[] = [
  {
    name: "retest",
    getSource: (condition) =>
      `let value = 0; if (${condition}) value = 1; if (${condition}) value += 2; return String(value);`,
    getExpected: (condition) => (condition ? "3" : "0"),
    actual: "[ '3', '2', '1', '0' ]",
  },
  {
    name: "complement",
    getSource: (condition) =>
      `if (${condition}) return 'early'; if (!(${condition})) return 'late'; return 'impossible';`,
    getExpected: (condition) => (condition ? "early" : "late"),
    actual: "[ 'early', 'late', 'impossible' ]",
  },
  {
    name: "encoded",
    getSource: (condition) =>
      `const value = (${condition}) ? 1 : 2; return String(value + ((${condition}) ? 4 : 8));`,
    getExpected: (condition) => (condition ? "5" : "10"),
    actual: "[ '5', '9', '6', '10' ]",
  },
];

const conditions: BooleanCondition[] = [
  { source: "first", getValue: (first) => first },
  { source: "!first", getValue: (first) => !first },
  { source: "second", getValue: (_first, second) => second },
  { source: "!second", getValue: (_first, second) => !second },
  {
    source: "first && second",
    getValue: (first, second) => first && second,
    hasConjunctionGap: true,
  },
  { source: "first || second", getValue: (first, second) => first || second },
  { source: "!(first && second)", getValue: (first, second) => !(first && second) },
  { source: "!(first || second)", getValue: (first, second) => !(first || second) },
  {
    source: "!first && second",
    getValue: (first, second) => !first && second,
    hasConjunctionGap: true,
  },
  {
    source: "first && !second",
    getValue: (first, second) => first && !second,
    hasConjunctionGap: true,
  },
  { source: "!first || second", getValue: (first, second) => !first || second },
  { source: "first || !second", getValue: (first, second) => first || !second },
  { source: "first === second", getValue: (first, second) => first === second },
  { source: "first !== second", getValue: (first, second) => first !== second },
];

it.each(conditions)("matches a single decision for $source", (condition) =>
  checkSymbolicCases([
    {
      name: `single-decision/${condition.source}`,
      body: `if (${condition.source}) return 'early'; return 'late';`,
    },
  ]),
);

const cases = consumers.flatMap((consumer) =>
  conditions.flatMap((condition) =>
    [false, true].map((isCached) => {
      const name = `${consumer.name}/${condition.source}/cached=${isCached}`;
      const isKnown =
        !isCached || (consumer.name === "complement" && condition.hasConjunctionGap === true);
      return {
        name,
        label: `${isKnown ? "known precision gap: " : ""}${name}`,
        isKnown,
        expected: [
          ...new Set(
            [false, true].flatMap((first) =>
              [false, true].map((second) =>
                consumer.getExpected(condition.getValue(first, second)),
              ),
            ),
          ),
        ],
        actual: consumer.actual,
        body: isCached
          ? `const condition = ${condition.source}; ${consumer.getSource("condition")}`
          : consumer.getSource(condition.source),
      };
    }),
  ),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isKnown }) => {
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const testCase = { name, body, expected, actual };
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(cases)("matches boolean composition pins $name", (testCase) =>
  checkDifferentialCases(
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
);
