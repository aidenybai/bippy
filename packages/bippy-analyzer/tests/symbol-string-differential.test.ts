import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const sources = [
  "firstValue?Symbol('token'):Symbol()",
  "Symbol(firstValue?'':undefined)",
  "Symbol.for(firstValue?'Symbol.iterator':'#identity')",
  "firstValue?Symbol.iterator:Symbol.toPrimitive",
  "Symbol.for(firstValue?'':'token')",
  "Symbol(firstValue?'line\\nbreak':'😀')",
];
const calls = [
  "String(value)",
  "String.call(null,value)",
  "String.apply(null,[value])",
  "Reflect.apply(String,null,[value])",
  "String.bind(null,value)()",
];
const cases: DifferentialCase[] = sources.flatMap((source) =>
  calls.map((call) => ({
    name: `${source}/${call}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const value=${source};if(secondValue)Symbol.prototype.toString=()=>{trace.push('hook');throw 'hook';};return ${call}+':'+trace.join('|');`,
  })),
);
cases.push(
  ...["Symbol", "Symbol.for"].map((constructor) => ({
    name: `${constructor}/guarded identity`,
    body: `const firstValue=first;const secondValue=second;const description=firstValue?'Symbol.iterator':'#identity';const left=${constructor}(description);const right=${constructor}(description);const selected=secondValue?left:right;return (left===right)+':'+(selected===left)+':'+String(left);`,
  })),
);
it.each(cases)("matches explicit symbol strings and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete explicit symbol strings: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
