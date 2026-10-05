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
  "ArrayBuffer",
];
const pairs = [
  ["undefined", "null"],
  ["true", "false"],
  ["2.9", "-0.9"],
  ["-1.9", "0.9"],
  ["NaN", "-0"],
  ["' 2.9 '", "'nonsense'"],
  ["'0x3'", "'-0.9'"],
  ["'-1.9'", "'Infinity'"],
  ["Infinity", "-Infinity"],
  ["9007199254740992", "-9007199254740992"],
  ["1n", "0n"],
  ["Symbol('length')", "2"],
  ["'12'", "3.99"],
];
const cases: DifferentialCase[] = constructors.flatMap((constructor) => {
  const observe =
    constructor === "ArrayBuffer"
      ? "result.byteLength+':'+ArrayBuffer.isView(result)"
      : "result.length+':'+result.byteLength+':'+Array.from(result).join(',')";
  return [
    ...pairs.map(([positive, negative]) => ({
      name: `${constructor}/${positive}/${negative}`,
      body: `const result=new ${constructor}((trace.push('length'),firstValue?${positive}:${negative}));if(secondValue)trace.push('tail');return ${observe}+':'+trace.join('|');`,
    })),
    {
      name: `${constructor}/reflect acquisition`,
      body: `const args={length:1,get 0(){trace.push('argument');if(secondValue)throw 'argument';return firstValue?1n:'2.9';}};const result=Reflect.construct(${constructor},args);return ${observe}+':'+trace.join('|');`,
    },
    {
      name: `${constructor}/omitted length`,
      body: `const result=firstValue?new ${constructor}():new ${constructor}(undefined);if(secondValue)trace.push('tail');return ${observe}+':'+trace.join('|');`,
    },
    ...(constructor === "ArrayBuffer"
      ? []
      : [
          {
            name: `${constructor}/ignored arguments still evaluate`,
            body: `const getOffset=()=>{trace.push('offset');if(secondValue)throw 'argument';return {[Symbol.toPrimitive](){trace.push('coerce');throw 'coerce';}};};const result=new ${constructor}((trace.push('length'),firstValue?1n:'2.9'),getOffset(),(trace.push('end'),Symbol('ignored')));return ${observe}+':'+trace.join('|');`,
          },
        ]),
  ].map((testCase) => ({
    ...testCase,
    body: `const firstValue=first;const secondValue=second;const trace=[];try{${testCase.body}}catch(error){return (typeof error==='string'?error:error.name+':'+error.message)+':'+trace.join('|');}`,
  }));
});
it.each(cases)("matches binary length coercion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete binary length coercion: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
