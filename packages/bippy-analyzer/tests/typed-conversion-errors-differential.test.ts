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
const sourceCases: DifferentialCase[] = constructors.flatMap((constructor) =>
  [
    { name: "constructor", expression: `new ${constructor}(source)` },
    { name: "of", expression: `${constructor}.of(...source)` },
    { name: "reflect construct", expression: `Reflect.construct(${constructor},[source])` },
    { name: "of apply", expression: `${constructor}.of.apply(${constructor},source)` },
  ].flatMap((operation) =>
    [
      {
        name: "selected primitive errors",
        source: `const source=[firstValue?1n:257,secondValue?Symbol('token'):2.5];`,
      },
      {
        name: "first conversion error wins",
        source: `const source=[firstValue?Symbol('first'):1n,secondValue?1n:Symbol('second')];`,
      },
      {
        name: "source evaluation precedes conversion",
        source: `const getSecond=()=>{trace.push('second');if(secondValue)throw 'argument';return -0;};const source=[(trace.push('first'),firstValue?1n:0.1),getSecond()];`,
      },
      {
        name: "failure precedes later object coercion",
        source: `const source=[firstValue?Symbol('first'):1n,{[Symbol.toPrimitive](){trace.push('coerce');throw 'coerce';}},secondValue?2:3];`,
      },
      {
        name: "optional failing elements",
        source: `const source=[257];if(firstValue)source.push(1n);if(secondValue)source.push(Symbol('token'));`,
      },
    ].map((testCase) => ({
      name: `${constructor}/${operation.name}/${testCase.name}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];try{${testCase.source}const result=${operation.expression};return Array.from(result,value=>Object.is(value,-0)?'-0':String(value)).join(',')+':'+result.byteLength+':'+ArrayBuffer.isView(result)+':'+trace.join('|');}catch(error){return (typeof error==='string'?error:error.name+':'+error.message)+':'+trace.join('|');}`,
    })),
  ),
);
const cases: DifferentialCase[] = [
  ...sourceCases,
  ...constructors.flatMap((constructor) =>
    [
      {
        name: "direct of argument completion",
        body: `const getLast=()=>{trace.push('last');if(secondValue)throw 'argument';return -0;};const result=${constructor}.of((trace.push('first'),firstValue?1n:257),getLast());return result.join(',')+':'+trace.join('|');`,
      },
      {
        name: "constructor ignored argument completion",
        body: `const getOffset=()=>{trace.push('offset');if(secondValue)throw 'argument';return 0;};const result=new ${constructor}([(trace.push('source'),firstValue?1n:257)],getOffset());return result.join(',')+':'+trace.join('|');`,
      },
      {
        name: "reflect acquisition before conversion",
        body: `const args={length:2,get 0(){trace.push('source');return [firstValue?1n:257];},get 1(){trace.push('offset');if(secondValue)throw 'argument';return 0;}};const result=Reflect.construct(${constructor},args);return result.join(',')+':'+trace.join('|');`,
      },
      {
        name: "apply acquisition before conversion",
        body: `const args={length:2,get 0(){trace.push('first');return firstValue?1n:257;},get 1(){trace.push('last');if(secondValue)throw 'argument';return -0;}};const result=${constructor}.of.apply(${constructor},args);return result.join(',')+':'+trace.join('|');`,
      },
    ].map((testCase) => ({
      name: `${constructor}/${testCase.name}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];try{${testCase.body}}catch(error){return (typeof error==='string'?error:error.name+':'+error.message)+':'+trace.join('|');}`,
    })),
  ),
];
it.each(cases)("matches typed conversion errors and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete typed conversion errors: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
