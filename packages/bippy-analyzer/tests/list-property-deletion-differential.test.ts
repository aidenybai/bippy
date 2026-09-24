import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = ["[]", "new Uint8Array([1])", "new ArrayBuffer(2)"].flatMap(
  (initializer) =>
    ["'marker'", "Symbol('key')"].flatMap((key) =>
      [false, true].map((isEnumerable) => ({
        name: `${initializer}/${key}/enumerable=${isEnumerable}`,
        body: `const firstValue=first;const secondValue=second;const target=${initializer};const alias=target;const key=${key};Object.defineProperty(target,key,{value:firstValue?'A':'B',enumerable:${isEnumerable},configurable:true});const before=Object.keys(target).join(',')+':'+target[key]+':'+Object.hasOwn(target,key);const removed=delete alias[key];const after=Object.keys(target).join(',')+':'+typeof target[key]+':'+(key in target)+':'+Object.hasOwn(target,key);target[key]=secondValue?'C':'D';return before+'|'+removed+'|'+after+'|'+Object.keys(target).join(',')+':'+target[key]+':'+Object.hasOwn(target,key);`,
      })),
    ),
);
it.each(cases)("matches native named list deletion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete named list deletion inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
