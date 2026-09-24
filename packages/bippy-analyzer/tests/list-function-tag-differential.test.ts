import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const receivers = [
  "[]",
  "new Uint8Array([1])",
  "new ArrayBuffer(2)",
  "(()=>{})",
  "(function*(){})",
  "(async()=>{})",
  "(async function*(){})",
  "(class {})",
];
const tags = [
  "undefined",
  "7",
  "''",
  "'Custom'",
  "{toString(){trace.push('unexpected');return 'bad';}}",
];
const invocations = [
  "Object.prototype.toString.call(receiver)",
  "Object.prototype.toString.bind(receiver)()",
];
const cases: DifferentialCase[] = receivers.flatMap((initializer) =>
  tags.flatMap((tag) =>
    invocations.map((invocation) => ({
      name: `${initializer}/tag=${tag}/${invocation}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const target=${initializer};const alternate=${initializer};Object.defineProperty(target,Symbol.toStringTag,{value:firstValue?${tag}:'Alternate',configurable:true});const receiver=secondValue?target:alternate;const result=${invocation};return trace.join('|')+':'+result+':'+(firstValue?'A':'B')+':'+(secondValue?'C':'D');`,
    })),
  ),
);
cases.push(
  ...receivers.map((initializer) => ({
    name: `${initializer}/live definition and deletion`,
    body: `const firstValue=first;const secondValue=second;const target=${initializer};const stringify=Object.prototype.toString.bind(target);const before=stringify()+':'+String(target[Symbol.toStringTag])+':'+(Symbol.toStringTag in target)+':'+Object.hasOwn(target,Symbol.toStringTag);Object.defineProperty(target,Symbol.toStringTag,{value:firstValue?(secondValue?'Custom':undefined):'Alternate',configurable:true});const defined=stringify()+':'+String(target[Symbol.toStringTag])+':'+(Symbol.toStringTag in target)+':'+Object.hasOwn(target,Symbol.toStringTag);const deleted=delete target[Symbol.toStringTag];return before+'|'+defined+'|'+deleted+':'+stringify()+':'+String(target[Symbol.toStringTag])+':'+(Symbol.toStringTag in target)+':'+Object.hasOwn(target,Symbol.toStringTag);`,
  })),
  {
    name: "class inherited data tag",
    body: "const firstValue=first;class Parent{}class Child extends Parent{}Parent[Symbol.toStringTag]=firstValue?'Parent':undefined;return Object.prototype.toString.call(Child)+':'+(second?'A':'B');",
  },
);
it.each(cases)("matches native list/function tags and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete list/function tag inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
