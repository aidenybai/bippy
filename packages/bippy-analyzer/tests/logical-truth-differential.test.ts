import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const operands = [
  "true",
  "false",
  "0",
  "-0",
  "NaN",
  "1",
  "''",
  "'text'",
  "null",
  "undefined",
  "0n",
  "1n",
  "({})",
  "[]",
  "(() => false)",
  "Symbol('value')",
  "/value/",
  "new Date(0)",
];
const cases: DifferentialCase[] = ["&&", "||"].flatMap((operator) =>
  operands.map((operand) => ({
    name: `${operator}/${operand}`,
    body: `const flag = !!first; const result = flag ${operator} ${operand}; return typeof result + ':' + (result ? 'truthy' : 'falsy');`,
  })),
);
it.each(cases)("matches native logical truth and replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches every concrete logical-truth input for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
