import { inspect } from "node:util";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  DifferentialMismatch,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface ConversionCase {
  name: string;
  setup: string;
  initializer?: string;
  changesPrototype?: boolean;
}
interface UpdateConversionCase extends DifferentialCase {
  label: string;
  changesPrototype: boolean;
}
const conversions: ConversionCase[] = [
  {
    name: "created inherited valueOf",
    setup: "",
    initializer:
      "Object.create({marker:'input',valueOf(){trace.push('inherited:'+this.marker);return 7n;}})",
  },
  { name: "created null prototype", setup: "", initializer: "Object.create(null)" },
  {
    name: "created inherited exotic",
    setup: "",
    initializer:
      "Object.create({marker:'input',[Symbol.toPrimitive](hint){trace.push('inherited:'+hint+':'+this.marker);return 7n;}})",
  },
  { name: "plain object defaults", setup: "" },
  {
    name: "default valueOf then custom toString",
    setup: "input.toString=()=>{trace.push('toString');return '7';};",
  },
  {
    name: "inherited valueOf",
    changesPrototype: true,
    setup:
      "Object.setPrototypeOf(input,{valueOf(){trace.push('inherited:'+this.marker);return 7n;}});",
  },
  {
    name: "null prototype has no conversion",
    changesPrototype: true,
    setup: "Object.setPrototypeOf(input,null);",
  },
  {
    name: "toString getter throws",
    setup:
      "input.valueOf=null;Object.defineProperty(input,'toString',{get(){trace.push('get:toString');throw 'lookup';}});",
  },
  {
    name: "toString returns bigint",
    setup: "input.valueOf=null;input.toString=()=>{trace.push('toString');return 7n;};",
  },
  {
    name: "valueOf number",
    setup: "input.valueOf=function(){trace.push('valueOf:'+this.marker);return firstValue?7:9;};",
  },
  {
    name: "valueOf bigint",
    setup: "input.valueOf=function(){trace.push('valueOf:'+this.marker);return firstValue?7n:9n;};",
  },
  {
    name: "selected numeric type",
    setup: "input.valueOf=function(){trace.push('valueOf');return firstValue?7n:9;};",
  },
  {
    name: "exotic hint",
    setup:
      "input[Symbol.toPrimitive]=function(hint){trace.push('exotic:'+hint+':'+this.marker);return firstValue?7n:'9';};",
  },
  {
    name: "exotic getter",
    setup:
      "Object.defineProperty(input,Symbol.toPrimitive,{get(){trace.push('get:exotic');return function(hint){trace.push('exotic:'+hint+':'+this.marker);return 7;};}});",
  },
  {
    name: "null exotic fallback",
    setup: "input[Symbol.toPrimitive]=null;input.valueOf=()=>{trace.push('valueOf');return 7;};",
  },
  {
    name: "undefined exotic fallback",
    setup:
      "input[Symbol.toPrimitive]=undefined;input.valueOf=()=>{trace.push('valueOf');return 7;};",
  },
  {
    name: "exotic returns object",
    setup:
      "input[Symbol.toPrimitive]=()=>{trace.push('exotic');return {};};input.valueOf=()=>{trace.push('unexpected');return 7;};",
  },
  {
    name: "exotic returns function",
    setup: "input[Symbol.toPrimitive]=()=>{trace.push('exotic');return ()=>7;};",
  },
  { name: "exotic noncallable", setup: "input[Symbol.toPrimitive]=firstValue?1:'bad';" },
  {
    name: "exotic getter throws",
    setup:
      "Object.defineProperty(input,Symbol.toPrimitive,{get(){trace.push('get:exotic');throw 'lookup';}});",
  },
  {
    name: "exotic call throws",
    setup: "input[Symbol.toPrimitive]=()=>{trace.push('exotic');throw 'convert';};",
  },
  {
    name: "valueOf getter",
    setup:
      "Object.defineProperty(input,'valueOf',{get(){trace.push('get:valueOf');return function(){trace.push('valueOf:'+this.marker);return 7;};}});",
  },
  {
    name: "skip noncallable valueOf",
    setup: "input.valueOf=1;input.toString=()=>{trace.push('toString');return '7';};",
  },
  {
    name: "object then toString",
    setup:
      "input.valueOf=()=>{trace.push('valueOf');return {};};input.toString=()=>{trace.push('toString');return '7';};",
  },
  {
    name: "function then toString",
    setup:
      "input.valueOf=()=>{trace.push('valueOf');return ()=>7;};input.toString=()=>{trace.push('toString');return '7';};",
  },
  {
    name: "both return objects",
    setup:
      "input.valueOf=()=>{trace.push('valueOf');return {};};input.toString=()=>{trace.push('toString');return {};};",
  },
  {
    name: "valueOf getter throws",
    setup:
      "Object.defineProperty(input,'valueOf',{get(){trace.push('get:valueOf');throw 'lookup';}});",
  },
  { name: "valueOf throws", setup: "input.valueOf=()=>{trace.push('valueOf');throw 'convert';};" },
  {
    name: "symbol result",
    setup: "input.valueOf=()=>{trace.push('valueOf');return Symbol('entry');};",
  },
  {
    name: "conversion redirects holder",
    setup: "input.valueOf=()=>{trace.push('valueOf');current=replacement;return firstValue?7n:9;};",
  },
  {
    name: "conversion replaces fallback",
    setup:
      "input.valueOf=()=>{trace.push('valueOf');input.toString=()=>{trace.push('replacement');return '7';};return {};};input.toString=()=>{trace.push('old');return '9';};",
  },
];
const cases: UpdateConversionCase[] = conversions.flatMap((conversion) =>
  ["++", "--"].flatMap((operator) =>
    [false, true].map((isPrefix) => ({
      name: `${conversion.name}/${operator}/prefix=${isPrefix}`,
      changesPrototype: conversion.changesPrototype === true,
      label: `${conversion.changesPrototype ? "known divergence: prototype mutation" : "matches native conversion"}: ${conversion.name}/${operator}/prefix=${isPrefix}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const input=${conversion.initializer ?? "{marker:'input'}"};let stored=input;const replacement={value:99};const original={get value(){trace.push('get');return stored;},set value(value){trace.push('set:'+String(this===original));stored=value;if(secondValue)throw 'setter';}};let current=original;${conversion.setup}try{const result=${isPrefix ? operator + "current.value" : "current.value" + operator};trace.push('after:'+typeof result+':'+String(result));}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return trace.join('|')+':'+typeof stored+':'+(current===replacement);`,
    })),
  ),
);
const getNativeResult = (body: string, index: number): unknown =>
  runInNewContext(
    `"use strict";(()=>{${body}})()`,
    { first: !!(index & 2), second: !!(index & 1) },
    { timeout: 1000 },
  );
const prototypeMismatchResults = [
  "get|set:true|after:number:NaN:number:false",
  "get|set:true|setter:number:false",
];
it.each(cases)("$label / symbolic and replay", async (testCase) => {
  if (!testCase.changesPrototype) return checkSymbolicCases([testCase]);
  const failure: unknown = await checkSymbolicCases([
    { name: testCase.name, body: testCase.body },
  ]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch)
    expect(failure.actual).toEqual([
      {
        name: testCase.name,
        body: testCase.body,
        expected: [
          ...new Set(
            Array.from({ length: 4 }, (_value, index) => getNativeResult(testCase.body, index)),
          ),
        ],
        actual: inspect(prototypeMismatchResults),
      },
    ]);
});
it.each(cases)("$label / concrete", (testCase) => {
  const assignments = Array.from({ length: 4 }, (_value, index) => ({
    name: `${testCase.name}/assignment=${index}`,
    body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
  }));
  return testCase.changesPrototype
    ? checkKnownDifferentialWitnesses(
        assignments.map((assignment, index) => ({
          ...assignment,
          expected: getNativeResult(testCase.body, index),
          actual: JSON.stringify(prototypeMismatchResults[index & 1]),
        })),
      )
    : checkDifferentialCases(assignments);
});
