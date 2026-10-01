import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const invocations = [
  "Object.prototype.toString.call(target)",
  "Object.prototype.toString.apply(target,[])",
  "Object.prototype.toString.bind(target)()",
];
const receivers = [
  "undefined",
  "null",
  "false",
  "1",
  "1n",
  "Symbol('entry')",
  "'x'",
  "[]",
  "(()=>{})",
  "({})",
  "new Map()",
  "new Set()",
  "Promise.resolve()",
  "new Error()",
  "new Date(0)",
  "/x/",
  "new Uint8Array([1])",
  "Object(1)",
];
it.each(
  receivers.flatMap((receiver) =>
    invocations.map((invocation) => ({
      name: `${receiver}/${invocation}`,
      body: `const target=${receiver};return ${invocation};`,
    })),
  ),
)("preserves native default object tag: $name", (testCase) => checkDifferentialCases([testCase]));
const cases: DifferentialCase[] = [
  "({})",
  "new Map()",
  "new Set()",
  "Promise.resolve()",
  "new Error()",
].flatMap((receiver) =>
  ["undefined", "7", "'Custom'"].map((tag) => ({
    name: `${receiver}/tag=${tag}`,
    body: `const firstValue=first;const target=${receiver};Object.defineProperty(target,Symbol.toStringTag,{value:firstValue?${tag}:'Alternate',configurable:true});return Object.prototype.toString.call(target)+':'+(second?'A':'B');`,
  })),
);
it.each(cases)("matches native own tag and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete own tag inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
