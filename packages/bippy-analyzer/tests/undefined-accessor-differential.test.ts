import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const cases: DifferentialCase[] = [false, true].flatMap((isInherited) =>
  ["'entry'", "Symbol.for('entry')"].flatMap((key) =>
    [false, true].flatMap((hasSelectedGetter) =>
      [false, true].map((hasSelectedSetter) => ({
        name: `inherited=${isInherited}/key=${key}/selected getter=${hasSelectedGetter}/selected setter=${hasSelectedSetter}`,
        body: `const firstValue=first;const secondValue=second;const trace=[];const owner={};const receiver=${isInherited ? "Object.create(owner)" : "owner"};receiver.marker='target';const key=${key};const getter=function(){trace.push('get:'+this.marker);return 7;};const setter=function(value){trace.push('set:'+this.marker+':'+value);};Object.defineProperty(owner,key,{get:${hasSelectedGetter ? "firstValue?undefined:getter" : "undefined"},set:${hasSelectedSetter ? "secondValue?undefined:setter" : "undefined"},enumerable:true,configurable:true});try{trace.push('read:'+String(receiver[key]));receiver[key]=9;trace.push('after');}catch(error){trace.push('caught:'+error.name);}return trace.join('|');`,
      })),
    ),
  ),
);
cases.push(
  {
    name: "getter returning undefined still runs",
    body: "let calls=0;const target={};Object.defineProperty(target,'entry',{get(){calls++;return undefined;}});return typeof target.entry+':'+calls;",
  },
  {
    name: "setter returning undefined still runs",
    body: "let calls=0;const target={};Object.defineProperty(target,'entry',{set(value){calls++;return undefined;}});const result=(target.entry=9);return result+':'+calls;",
  },
  {
    name: "getter throwing undefined is not absent",
    body: "let calls=0;const target={};Object.defineProperty(target,'entry',{get(){calls++;throw undefined;}});try{target.entry;return 'after';}catch(error){return Object.is(error,undefined)+':'+calls;}",
  },
  {
    name: "setter throwing undefined is not absent",
    body: "let calls=0;const target={};Object.defineProperty(target,'entry',{set(value){calls++;throw undefined;}});try{target.entry=9;return 'after';}catch(error){return Object.is(error,undefined)+':'+calls;}",
  },
);
it.each(cases)("matches native undefined accessors and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete undefined accessor inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
