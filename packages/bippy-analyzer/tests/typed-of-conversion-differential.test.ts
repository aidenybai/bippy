import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const constructors = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
];
const observe =
  "const describe=value=>Object.is(value,-0)?'-0':String(value);return Array.from(result,describe).join(',')+':'+result.length+':'+result.byteLength+':'+ArrayBuffer.isView(result)+':'+trace.join('|');";
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  [
    {
      name: "direct primitive conversion",
      body: `const result=${constructor}.of(firstValue?257:-129,secondValue?2.5:3.5,NaN,4294967295,65537);${observe}`,
    },
    {
      name: "spread scalar boundaries",
      body: `const result=${constructor}.of(...[-0,NaN,Infinity,-Infinity,firstValue?0.1:1/3,secondValue?1e40:1e-46,'0xff','-0','invalid',true,false,null,undefined]);${observe}`,
    },
    {
      name: "apply copies converted storage",
      body: `const source=[firstValue?257:-129,secondValue?2.5:3.5];const result=${constructor}.of.apply(${constructor},source);source[0]=8;source.push(9);${observe}`,
    },
    {
      name: "reflect apply ordered live arguments",
      body: `const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');source[1]=secondValue?0.1:257;return firstValue?2.5:3.5;},1:0,[Symbol.iterator](){trace.push('iterator');throw 'iterator';}};const result=Reflect.apply(${constructor}.of,${constructor},source);${observe}`,
    },
    {
      name: "call with the intrinsic receiver",
      body: `const result=${constructor}.of.call(${constructor},firstValue?'257.9':'-1',secondValue?null:undefined);${observe}`,
    },
    {
      name: "bound leading arguments",
      body: `const create=${constructor}.of.bind(${constructor},firstValue?257:-129);const result=create(secondValue?2.5:3.5);${observe}`,
    },
    {
      name: "guarded spread length",
      body: `const source=[2.5];if(firstValue)source.push(257);if(secondValue)source.push(-0);const result=${constructor}.of(...source);${observe}`,
    },
    {
      name: "argument completion before conversion",
      body: `const getSecond=()=>{trace.push('second');if(secondValue)throw undefined;return -1;};try{const result=${constructor}.of((trace.push('first'),firstValue?257:0.1),getSecond());${observe}}catch(error){return String(error)+':'+trace.join('|');}`,
    },
    { name: "empty", body: `const result=${constructor}.of();${observe}` },
  ].map((testCase) => ({
    name: `${constructor}/${testCase.name}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];${testCase.body}`,
  })),
);
it.each(cases)("matches typed of conversion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete typed of conversion: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
