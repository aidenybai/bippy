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
  "const describe=value=>Object.is(value,-0)?'-0':String(value);return Array.from(result,describe).join(',')+':'+result.length+':'+result.byteLength+':'+ArrayBuffer.isView(result);";
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  [
    {
      name: "integer wrapping",
      body: `const source=[firstValue?-129:128,-1,256,257,65535,65536,2147483648,4294967295,secondValue?4294967296:-4294967297];const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "fractional rounding",
      body: `const source=[firstValue?0.5:-0.5,1.5,2.5,3.5,254.5,secondValue?255.5:-1.5];const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "floating boundaries",
      body: `const source=[-0,NaN,Infinity,-Infinity,firstValue?0.1:1/3,secondValue?1e40:1e-46];const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "primitive numeric conversion",
      body: `const source=[firstValue?'257.9':'-1',secondValue?null:undefined,false,true,'0xff',' 2.5 ','invalid','-0'];const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "correlated element choices",
      body: `const choice=firstValue?257:-129;const source=[choice,choice,secondValue?2.5:3.5];const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "selected source lists",
      body: `const source=firstValue?[257,-129]:[2.5,3.5];const result=new ${constructor}(source);source[0]=secondValue?8:9;${observe}`,
    },
    {
      name: "typed source copying",
      body: `const source=new Float64Array([firstValue?257.9:-129,secondValue?0.1:65537]);const result=new ${constructor}(source);source[0]=9;${observe}`,
    },
    {
      name: "guarded source length",
      body: `const source=[0];if(firstValue)source.push(257);if(secondValue)source.push(-1);const result=new ${constructor}(source);${observe}`,
    },
    {
      name: "reflective construction",
      body: `const source=[firstValue?257:-1,secondValue?2.5:3.5];const result=Reflect.construct(${constructor},[source],${constructor});${observe}`,
    },
    {
      name: "argument completion before conversion",
      body: `const trace=[];const getValue=()=>{trace.push('second');if(secondValue)throw undefined;return -1;};try{const result=new ${constructor}([(trace.push('first'),firstValue?257:0.1),getValue()]);return Array.from(result,value=>Object.is(value,-0)?'-0':String(value)).join(',')+':'+trace.join('|');}catch(error){return String(error)+':'+trace.join('|');}`,
    },
  ].map((testCase) => ({
    name: `${constructor}/${testCase.name}`,
    body: `const firstValue=first;const secondValue=second;${testCase.body}`,
  })),
);
it.each(cases)("matches typed constructor conversion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete typed constructor conversion: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
