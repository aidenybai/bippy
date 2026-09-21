import { expect, it } from "vite-plus/test";
import { getIntrinsicConstructionError } from "../src/evaluate/errors.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { getObjectProperty, primitiveValue } from "../src/evaluate/values.js";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [];
for (const constructor of ["Symbol", "BigInt"]) {
  for (const invocation of [
    'new Target((trace.push("argument"),value))',
    'Reflect.construct(Target,[(trace.push("argument"),value)])',
    "Reflect.construct(Target,source)",
    "Reflect.construct(Target,source,Other)",
  ]) {
    cases.push({
      name: `${constructor}/${invocation}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const Target=${constructor};function Other(){trace.push('other');}const value={ [Symbol.toPrimitive](hint){trace.push('coerce:'+hint);throw 'coercion';},valueOf(){trace.push('valueOf');throw 'valueOf';},toString(){trace.push('toString');throw 'toString';}};const source={get length(){trace.push('length');return firstValue?2:1;},get 0(){trace.push('0');return value;},get 1(){trace.push('1');if(secondValue)throw 'index';return value;},[Symbol.iterator](){trace.push('iterator');throw 'iterator';}};try{${invocation};trace.push('after');return trace.join('|');}catch(error){return (typeof error==='object'?error.name+':'+error.message:String(error))+':'+trace.join('|');}`,
    });
  }
  for (const key of ["length", "0"])
    for (const payload of ["'token'", "undefined"]) {
      cases.push({
        name: `${constructor}/throw ${key}/${payload}`,
        body: `const trace=[];const source={get length(){trace.push('length');${key === "length" ? `throw ${payload};` : "return 1;"}},get 0(){trace.push('0');throw ${payload};}};try{Reflect.construct(${constructor},source);trace.push('after');}catch(error){trace.push(String(error));}return trace.join('|');`,
      });
    }
  for (const newTarget of [
    "Other",
    "Symbol",
    "BigInt",
    "new Proxy(Other,{get(target,key){trace.push('get:'+String(key));throw 'prototype';}})",
  ]) {
    cases.push({
      name: `${constructor}/valid newTarget ${newTarget}`,
      body: `const trace=[];function Other(){trace.push('other');}const source={get length(){trace.push('length');return 0;}};try{Reflect.construct(${constructor},source,${newTarget});trace.push('after');return trace.join('|');}catch(error){return error.name+':'+error.message+':'+trace.join('|');}`,
    });
  }
  for (const payload of ["'token'", "undefined"]) {
    cases.push({
      name: `${constructor}/argument throw ${payload}`,
      body: `const firstValue=first;const trace=[];const getArgument=()=>{trace.push('argument');if(firstValue)throw ${payload};return {toString(){trace.push('coerce');return '1';}};};try{new ${constructor}(getArgument());trace.push('after');return trace.join('|');}catch(error){return (typeof error==='object'?error.name+':'+error.message:String(error))+':'+trace.join('|');}`,
    });
  }
  cases.push({
    name: `${constructor}/invalid newTarget before acquisition`,
    body: `const trace=[];const source={get length(){trace.push('length');throw 'length';}};try{Reflect.construct(${constructor},source,()=>0);trace.push('after');}catch(error){trace.push(error.name);}return trace.join('|');`,
  });
  cases.push({
    name: `${constructor}/renamed intrinsic`,
    body: `Object.defineProperty(${constructor},'name',{value:first?'RenamedA':'RenamedB'});try{new ${constructor}();return 'after';}catch(error){return error.name+':'+error.message;}`,
  });
}
cases.push({
  name: "selected intrinsic targets preserve error choices",
  body: "const firstValue=first;const secondValue=second;const trace=[];const Target=firstValue?Symbol:BigInt;const source={get length(){trace.push('length');if(secondValue)throw 'length';return 0;}};try{Reflect.construct(Target,source);return 'after';}catch(error){return (typeof error==='object'?error.name+':'+error.message:String(error))+':'+trace.join('|');}",
});
for (const constructor of ["Symbol", "BigInt"]) {
  cases.push({
    name: `${constructor}/error branding`,
    body: `try{new ${constructor}();return 'after';}catch(error){return (error instanceof TypeError)+':'+(error instanceof Error)+':'+typeof error.stack;}`,
  });
  cases.push({
    name: `${constructor}/invalid argument list before body`,
    body: `try{Reflect.construct(${constructor},null);return 'after';}catch(error){return error.name+':'+error.message;}`,
  });
  cases.push({
    name: `shadowed ${constructor} remains constructible`,
    body: `const ${constructor}=class{constructor(value){this.value=value;}};return new ${constructor}(first?'A':'B').value;`,
  });
}
it.each(["Symbol", "BigInt"])("keeps intrinsic constructor error stacks opaque: %s", (name) => {
  const result = getIntrinsicConstructionError(name, null);
  if (!result) throw new Error("Expected intrinsic construction failure");
  expect(getThrowCertainty(result)).toBe("always");
  const error = getCaughtValue(result, null);
  if (error.kind !== "object") throw new Error("Expected modeled error");
  expect(getObjectProperty(error, "name")).toEqual(primitiveValue("TypeError"));
  expect(getObjectProperty(error, "message")).toEqual(
    primitiveValue(`${name} is not a constructor`),
  );
  expect(getObjectProperty(error, "stack")).toMatchObject({
    kind: "unknown-primitive",
    primitiveType: "string",
  });
});
it("does not reject other intrinsic construction bodies", () => {
  for (const name of [
    "Object",
    "Array",
    "Number",
    "String",
    "Boolean",
    "Date",
    "Error",
    "Promise",
    "Map",
    "Set",
  ])
    expect(getIntrinsicConstructionError(name, null)).toBeNull();
});
it.each(cases)("matches intrinsic construction errors and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete intrinsic construction errors: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
