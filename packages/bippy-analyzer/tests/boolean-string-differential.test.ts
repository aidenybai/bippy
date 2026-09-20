import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const expressions = [
  "String(firstValue)",
  "'value:'+firstValue",
  "firstValue+':value'",
  "[firstValue,secondValue].join(':')",
  "`${firstValue}:${secondValue}`",
  "String(firstValue)+':'+String(firstValue)",
  "String(firstValue)+':'+String(!firstValue)",
  "[firstValue,secondValue,firstValue,secondValue].join(':')",
];
const cases: DifferentialCase[] = ["!!first", "Boolean(first)", "!first"].flatMap((source) =>
  expressions.map((expression) => ({
    name: `${source}/${expression}`,
    body: `const firstValue=${source};const secondValue=!!second;return ${expression};`,
  })),
);
it.each(cases)("matches native Boolean text and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete Boolean text inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
