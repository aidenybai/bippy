import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const consumers = [
  { name: "keys", body: "return Object.keys(target).join(',');" },
  { name: "values", body: "return Object.values(target).join(',');" },
  {
    name: "entries",
    body: "return Object.entries(target).map((entry)=>entry.join('=')).join(',');",
  },
  {
    name: "for-in",
    body: "const keys=[];for(const key in target)keys.push(key);return keys.join(',');",
  },
];
const cases: DifferentialCase[] = ["[1]", "new Uint8Array([1])", "new ArrayBuffer(2)"].flatMap(
  (initializer) =>
    consumers.map((consumer) => ({
      name: `${initializer}/${consumer.name}`,
      body: `const firstValue=first;const secondValue=second;const target=${initializer};Object.defineProperty(target,'shown',{value:firstValue?'A':'B',enumerable:true});Object.defineProperty(target,'hidden',{value:'hidden'});target[Symbol('secret')]='secret';const result=(()=>{${consumer.body}})();return result+':'+(secondValue?'C':'D');`,
    })),
);
it.each(cases)("matches native list enumeration and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete list enumeration inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
