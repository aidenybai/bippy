import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [
  "(first,second)=>0",
  "function target(first,second){}",
  "async(first,second)=>0",
  "function* target(first,second){}",
].flatMap((initializer) =>
  ["length", "name"].flatMap((key) =>
    [false, true].map((conditional) => ({
      name: `${initializer}/${key}/${conditional ? "guarded" : "definite"} deletion`,
      body: `const firstValue=first;const secondValue=second;const target=(${initializer});const alias=target;${conditional ? "if(firstValue)" : ""}delete alias.${key};const bound=target.bind(null,secondValue?1:2);return Object.hasOwn(target,'${key}')+':'+target.${key}+':'+bound.length+':'+bound.name;`,
    })),
  ),
);
cases.push(
  ...[
    "(first,second)=>0",
    "function target(first,second){}",
    "async(first,second)=>0",
    "function* target(first,second){}",
  ].flatMap((initializer) =>
    ["length", "name"].map((key) => ({
      name: `${initializer}/${key}/reflection after deletion`,
      body: `const target=(${initializer});delete target.${key};return Object.getOwnPropertyNames(target).join('|')+':'+(Object.getOwnPropertyDescriptor(target,'${key}')===undefined)+':'+target.propertyIsEnumerable('${key}')+':'+('${key}' in target);`,
    })),
  ),
  ...["length", "name"].flatMap((key) =>
    ["delete", "replace", "assign"].map((action) => ({
      name: `accessor ${key}/${action}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const target=(first,second)=>0;Object.defineProperty(target,'${key}',{get(){trace.push('get');return ${key === "length" ? "4" : "'custom'"};},configurable:true});delete target.${key};${action === "replace" ? `Object.defineProperty(target,'${key}',{get(){trace.push('replacement');return ${key === "length" ? "firstValue?3:5" : "firstValue?'A':'B'"};},configurable:true});` : action === "assign" ? `Object.defineProperty(target,'${key}',{value:${key === "length" ? "firstValue?3:5" : "firstValue?'A':'B'"},writable:true,enumerable:true,configurable:true});` : ""}const bound=target.bind(null,secondValue?1:2);return Object.hasOwn(target,'${key}')+':'+bound.length+':'+bound.name+':'+trace.join('|');`,
    })),
  ),
  ...["length", "name"].map((key) => ({
    name: `deleted bound ${key} before rebinding`,
    body: `const target=function named(first,second,third){return this.label+':'+first+':'+second;};const bound=target.bind({label:'owner'},'a');delete bound.${key};const rebound=bound.bind({label:'wrong'},first?'b':'c');return Object.hasOwn(bound,'${key}')+':'+bound.${key}+':'+rebound.length+':'+rebound.name+':'+rebound();`,
  })),
);
cases.push(
  ...["length", "name"].map((key) => ({
    name: `recreated ${key} retains new insertion order`,
    body: `const target=function named(first,second){};delete target.${key};Object.defineProperty(target,'${key}',{value:${key === "length" ? "3" : "'renamed'"},enumerable:true,writable:true,configurable:true});return Object.getOwnPropertyNames(target).join('|')+':'+target.propertyIsEnumerable('${key}')+':'+target.bind(null,1).length+':'+target.bind(null,1).name;`,
  })),
  {
    name: "independent guarded deletions retain aliases and snapshots",
    body: "const target=function named(first,second){};const alias=target;const original=target.bind(null);if(first)delete target.length;if(second)delete alias.name;const bound=target.bind(null,1);return Object.hasOwn(alias,'length')+':'+Object.hasOwn(target,'name')+':'+target.length+':'+alias.name+':'+bound.length+':'+bound.name+':'+original.length+':'+original.name;",
  },
);
it.each(cases)("matches native metadata deletion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete metadata deletion: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
