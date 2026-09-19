import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

interface BooleanEncoding {
  name: string;
  getSource: (left: string, right: string) => string;
}

const encodings: BooleanEncoding[] = [
  { name: "and", getSource: (left, right) => `${left} && ${right}` },
  { name: "and-conditional", getSource: (left, right) => `${left} ? ${right} : false` },
  { name: "and-demorgan", getSource: (left, right) => `!(!${left} || !${right})` },
  { name: "or", getSource: (left, right) => `${left} || ${right}` },
  { name: "or-conditional", getSource: (left, right) => `${left} ? true : ${right}` },
  { name: "or-demorgan", getSource: (left, right) => `!(!${left} && !${right})` },
];

const cases = encodings.flatMap((encoding) =>
  ["ambient", "locals", "parameters", "properties"].flatMap((storage) =>
    [false, true].map((isCached) => {
      const condition = encoding.getSource(
        storage === "ambient" ? "first" : storage === "properties" ? "inputs.left" : "left",
        storage === "ambient" ? "second" : storage === "properties" ? "inputs.right" : "right",
      );
      const read = isCached ? "condition" : `(${condition})`;
      const consume = `${isCached ? `const condition = ${condition};` : ""} if (${read}) return 'early'; if (!${read}) return 'late'; return 'impossible';`;
      const body =
        storage === "parameters"
          ? `const run = (left, right) => { ${consume} }; return run(first, second);`
          : storage === "locals"
            ? `const left = first; const right = second; ${consume}`
            : storage === "properties"
              ? `const inputs = { left: first, right: second }; ${consume}`
              : consume;
      const name = `${encoding.name}/${storage}/cached=${isCached}`;
      const isKnown =
        (storage === "ambient" && !isCached) ||
        (isCached && (encoding.name === "and" || encoding.name === "and-conditional"));
      return { name, body, isKnown, label: `${isKnown ? "known precision gap: " : ""}${name}` };
    }),
  ),
);

it.each(cases)("$label", async ({ name, body, isKnown }) => {
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const testCase = {
    name,
    body,
    expected: ["late", "early"],
    actual: "[ 'early', 'late', 'impossible' ]",
  };
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(cases)("matches input provenance pins $name", (testCase) =>
  checkDifferentialCases(
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
);
