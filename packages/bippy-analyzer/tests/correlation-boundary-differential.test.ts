import { it } from "vite-plus/test";
import { checkSymbolicCases, checkDifferentialCases } from "./helpers/differential-evaluator.js";

interface CorrelationExpression {
  name: string;
  getSource: (terms: string[]) => string;
}

const expressions: CorrelationExpression[] = [
  { name: "concatenation", getSource: (terms) => terms.join(" + ':' + ") },
  { name: "join", getSource: (terms) => `[${terms.join(",")}].join(':')` },
  {
    name: "template",
    getSource: (terms) => "`" + terms.map((term) => "${" + term + "}").join(":") + "`",
  },
  { name: "addition", getSource: (terms) => `String(${terms.join(" + ")})` },
];

const cases = expressions.flatMap((expression) =>
  [false, true].flatMap((isNested) =>
    Array.from({ length: 6 }, (_value, index) => {
      const repetitions = index + 1;
      const terms = ["before", ...Array.from({ length: repetitions }, () => "after")];
      return {
        name: `${expression.name}/nested=${isNested}/repetitions=${repetitions}`,
        body: `const before = first ? 1 : 2; const after = second ? 3 : ${isNested ? "before" : "4"}; return ${expression.getSource(terms)};`,
      };
    }),
  ),
);

it.each(cases)("preserves finite correlations for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);

it.each(cases)("matches all concrete pins for $name", (testCase) =>
  checkDifferentialCases(
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
);
