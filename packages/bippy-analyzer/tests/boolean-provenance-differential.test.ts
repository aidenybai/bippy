import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkGuardedCases,
  checkDifferentialCases,
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
      return { name: `${encoding.name}/${storage}/cached=${isCached}`, body };
    }),
  ),
);

it.each(cases)("preserves boolean provenance: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
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
