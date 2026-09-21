import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { getObjectProperty } from "../src/evaluate/values.js";
import {
  evaluateCases,
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  DifferentialMismatch,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ConstructorMismatch {
  expected: string;
  actual: string;
  symbolic: string;
}
interface ConstructorCase extends DifferentialCase {
  mismatch?: ConstructorMismatch;
}

const targets = [
  "Math.abs",
  "Math.max",
  "JSON.parse",
  "JSON.stringify",
  "Object.keys",
  "Object.create",
  "Array.of",
  "Array.from",
  "Reflect.apply",
  "Reflect.construct",
  "Symbol.for",
  "BigInt.asIntN",
  "Date.UTC",
  "Number.isFinite",
  "parseInt",
  "encodeURIComponent",
  "Math",
  "JSON",
  "Reflect",
  "undefined",
  "null",
  "0",
  "1n",
  "'text'",
  "false",
  "Symbol('target')",
  "{}",
  "[]",
];
const cases: ConstructorCase[] = targets.flatMap((target) =>
  [false, true].map((isAliased) => ({
    name: `${target}/${isAliased ? "alias" : "direct"}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];${isAliased ? `const Target=${target};` : ""}const value={[Symbol.toPrimitive](){trace.push('coerce');return 3;},toString(){trace.push('string');return '3';},valueOf(){trace.push('number');return 3;}};const getArgument=()=>{trace.push('argument');if(firstValue)throw secondValue?'token':undefined;return value;};const getSecond=()=>{trace.push('second');return 1;};try{new (${isAliased ? "Target" : target})(getArgument(),getSecond());trace.push('after');}catch(error){trace.push(typeof error==='object'?error.name:String(error));}return trace.join('|');`,
  })),
);
for (const target of ["()=>0", "Math.max", "{}", "[]"])
  cases.push({
    name: `nonconstructor proxy target ${target}`,
    body: `const trace=[];const Target=new Proxy(${target},{construct(){trace.push('trap');return {};}});try{new Target((trace.push('argument'),0));trace.push('after');}catch(error){trace.push(error.name);}return trace.join('|');`,
  });
cases.push(
  {
    name: "callee lookup precedes arguments and validation",
    body: "const firstValue=first;const secondValue=second;const trace=[];const holder={get target(){trace.push('target');if(firstValue)throw secondValue?'target':undefined;return Math.max;}};try{new holder.target((trace.push('argument'),1));trace.push('after');}catch(error){trace.push(typeof error==='object'?error.name:String(error));}return trace.join('|');",
  },
  {
    name: "selected ordinary and intrinsic constructor eligibility",
    body: "const firstValue=first;const secondValue=second;const trace=[];function Valid(value){trace.push('body');this.value=value;}const Target=firstValue?Valid:Math.max;try{const result=new Target((trace.push('argument'),secondValue?'A':'B'));return result.value+':'+trace.join('|');}catch(error){return error.name+':'+trace.join('|');}",
  },
  {
    name: "adding a prototype does not make an intrinsic constructible",
    mismatch: {
      expected: "argument|TypeError",
      actual: "prototype|argument|TypeError",
      symbolic: "[ 'prototype|argument|TypeError' ]",
    },
    body: "const trace=[];Object.defineProperty(Math.max,'prototype',{get(){trace.push('prototype');throw 'prototype';}});try{new Math.max((trace.push('argument'),1));trace.push('after');}catch(error){trace.push(error.name);}return trace.join('|');",
  },
  {
    name: "nonconstructor proxy does not look up a construct trap",
    body: "const trace=[];const Target=new Proxy(()=>0,{get construct(){trace.push('trap getter');throw 'trap';}});try{new Target((trace.push('argument'),1));trace.push('after');}catch(error){trace.push(error.name);}return trace.join('|');",
  },
);
cases.push(
  ...[
    "new Object().toString()",
    "new Array(1,2).join(',')",
    "new Date(0).toISOString()",
    "new Map([['key','value']]).get('key')",
    "String(new Set([1]).has(1))",
    "String(new Uint8Array([1])[0])",
    "String(new RegExp('a').test('cat'))",
    "new Error('message').message",
  ].map((expression) => ({
    name: `constructible control ${expression}`,
    body: `return ${expression};`,
  })),
);
for (const target of ["Symbol", "function Original(){}"])
  cases.push({
    name: `constructible proxy ${target}`,
    body: `const trace=[];const Target=new Proxy(${target},{construct(target,args){trace.push('trap');return {value:args[0]};}});const result=new Target(first?'A':'B');return result.value+':'+trace.join('|');`,
  });
cases.push({
  name: "constructible control String(new Uint8Array([257])[0])",
  body: "return String(new Uint8Array([257])[0]);",
});
cases.push({
  name: "added data prototype does not change eligibility",
  body: "Object.defineProperty(Math.max,'prototype',{value:{}});try{new Math.max();return 'after';}catch(error){return error.name;}",
});
it.each(cases.filter((testCase) => testCase.mismatch))(
  "known divergence: constructor boundary: $name",
  async (testCase) => {
    const mismatch = testCase.mismatch;
    if (!mismatch) throw new Error("Expected recorded mismatch");
    expect(runInNewContext(`(()=>{${testCase.body}})()`, {}, { timeout: 1000 })).toBe(
      mismatch.expected,
    );
    let observed: unknown;
    try {
      await checkSymbolicCases([testCase]);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(DifferentialMismatch);
    if (!(observed instanceof DifferentialMismatch))
      throw new Error("Expected recorded constructor-boundary divergence");
    expect(observed.actual).toEqual([
      {
        ...testCase,
        expected: [mismatch.expected],
        actual: mismatch.symbolic,
      },
    ]);
  },
);
it.each(cases.filter((testCase) => testCase.mismatch))(
  "known divergence: concrete constructor boundary: $name",
  (testCase) => {
    const mismatch = testCase.mismatch;
    if (!mismatch) throw new Error("Expected recorded mismatch");
    return checkKnownDifferentialWitnesses(
      Array.from({ length: 4 }, (_value, index) => ({
        name: `${testCase.name}/${index}`,
        body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
        expected: mismatch.expected,
        actual: JSON.stringify(mismatch.actual),
      })),
    );
  },
);
it.each(cases.filter((testCase) => !testCase.mismatch))(
  "matches constructor eligibility and replay: $name",
  (testCase) => checkSymbolicCases([testCase]),
);
it.each(cases.filter((testCase) => !testCase.mismatch))(
  "matches concrete constructor eligibility: $name",
  (testCase) =>
    checkDifferentialCases(
      Array.from({ length: 4 }, (_value, index) => ({
        name: `${testCase.name}/${index}`,
        body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
      })),
    ),
);
it.each(["Math.max", "null", "new Proxy(()=>0,{construct(){return {};}})"])(
  "keeps constructor validation messages and stacks opaque: %s",
  async (target) => {
    const [error] = await evaluateCases([
      {
        name: "opaque constructor error",
        body: `try{new (${target})();return 'after';}catch(error){return error;}`,
      },
    ]);
    if (error.kind !== "object") throw new Error("Expected modeled constructor error");
    expect(getObjectProperty(error, "name")).toMatchObject({
      kind: "primitive",
      value: "TypeError",
    });
    for (const key of ["message", "stack"])
      expect(getObjectProperty(error, key)).toMatchObject({
        kind: "unknown-primitive",
        primitiveType: "string",
      });
  },
);
