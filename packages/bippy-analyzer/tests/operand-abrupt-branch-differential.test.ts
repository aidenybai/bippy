import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const operators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  ">",
  "<=",
  ">=",
  "==",
  "!=",
  "===",
  "!==",
  "|",
  "&",
  "^",
  "<<",
  ">>",
  ">>>",
  "in",
  "instanceof",
  "&&",
  "||",
  "??",
  "conditional",
];
const cases: DifferentialCase[] = operators.flatMap((operator) =>
  ["undefined", "{}", "Symbol('token')"].map((token) => ({
    name: `${operator}/token=${token}`,
    body: `const firstValue=first;const secondValue=second;const token=${token};const trace=[];const left=()=>{trace.push('left');if(firstValue)throw token;return ${operator === "in" ? "'value'" : operator === "instanceof" ? "{}" : "7"};};const right=()=>{trace.push('right');if(secondValue)throw token;return ${operator === "in" ? "{value:7}" : operator === "instanceof" ? "class {}" : "2"};};try{${operator === "conditional" ? "left()?right():right()" : `left() ${operator} right()`};trace.push('after');}catch(error){trace.push('caught:'+Object.is(error,token));}return trace.join('|');`,
  })),
);

it.each(cases)("matches native abrupt operands and pinned replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete abrupt operand inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
