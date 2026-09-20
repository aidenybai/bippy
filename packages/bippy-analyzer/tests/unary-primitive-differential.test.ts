import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const operands = [
  "undefined",
  "null",
  "true",
  "false",
  "''",
  "' '",
  "'1'",
  "'-0'",
  "'12.5'",
  "'0x10'",
  "'0b10'",
  "'0o10'",
  "'nope'",
  "'Infinity'",
  "'-Infinity'",
  "0",
  "-0",
  "NaN",
  "Infinity",
  "1n",
  "-2n",
  "Symbol('entry')",
];
const cases: DifferentialCase[] = operands.flatMap((operand) =>
  ["+", "-", "~"].map((operator) => ({
    name: `${operator} ${operand}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const getOperand=()=>{trace.push('operand');return firstValue?(${operand}):2;};try{const value=${operator} getOperand();trace.push(typeof value+':'+(Object.is(value,-0)?'-0':String(value)));}catch(error){trace.push(error.name+':'+error.message);}return trace.join('|')+':'+(secondValue?'right':'left');`,
  })),
);
it.each(cases)("matches native unary primitives and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete unary primitive inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
