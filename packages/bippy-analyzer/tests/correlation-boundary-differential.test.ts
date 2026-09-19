import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

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
      const name = `${expression.name}/nested=${isNested}/repetitions=${repetitions}`;
      const limit = expression.name === "addition" ? (isNested ? 3 : 6) : isNested ? 2 : 4;
      const isKnown = repetitions === limit && (expression.name !== "addition" || isNested);
      const expected = [false, true].flatMap((first) =>
        [false, true].map((second) => {
          const before = first ? 1 : 2;
          const after = second ? 3 : isNested ? before : 4;
          const values = [before, ...Array.from({ length: repetitions }, () => after)];
          return expression.name === "addition"
            ? String(values.reduce((total, value) => total + value, 0))
            : values.join(":");
        }),
      );
      return {
        name,
        label: `${isKnown ? "known precision gap: " : ""}${name}`,
        isKnown,
        isSymbolic: repetitions <= limit,
        expected,
        actual:
          expression.name === "addition"
            ? "<string: String(<any: + on dynamic values>)>"
            : expression.name === "concatenation"
              ? "<any: + on dynamic values>"
              : "<string: + on dynamic values>",
        body: `const before = first ? 1 : 2; const after = second ? 3 : ${isNested ? "before" : "4"}; return ${expression.getSource(terms)};`,
      };
    }),
  ),
);

it.each(cases.filter((testCase) => testCase.isSymbolic))(
  "$label",
  async ({ name, body, expected, actual, isKnown }) => {
    if (!isKnown) return checkSymbolicCases([{ name, body }]);
    const testCase = { name, body, expected, actual };
    const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DifferentialMismatch);
    if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
  },
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
