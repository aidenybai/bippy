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
interface SetCase {
  name: string;
  body: string;
}
const controls: SetCase[] = [
  {
    name: "nonfinite and signed zero storage",
    body: `values.set([firstValue?-0:undefined,secondValue?NaN:Infinity]);`,
  },
  {
    name: "string source uses UTF16 indices",
    body: `values.set(firstValue?'😀':'1😀',secondValue?0:1);`,
  },
  {
    name: "same receiver call",
    body: `values.set.call(values,[firstValue?257:2.5],secondValue?1:2);`,
  },
  {
    name: "bound source argument",
    body: `const set=values.set.bind(values,[firstValue?257:2.5]);set(secondValue?1:2);`,
  },
  {
    name: "reflective arguments",
    body: `Reflect.apply(values.set,values,[[firstValue?257:1n],secondValue?1:2]);`,
  },
  {
    name: "length captured before mutation",
    body: `const source={length:2,get 0(){trace.push('zero');source.length=firstValue?0:1;return 257;},get 1(){trace.push('one');return secondValue?2.5:3.5;}};values.set(source);`,
  },
  {
    name: "omitted source and explicit undefined",
    body: `if(firstValue)values.set();else values.set(undefined,secondValue?0:-1);`,
  },
  {
    name: "primitive conversion",
    body: `trace.push(String(values.set([firstValue?257:-1,secondValue?2.5:3.5])));`,
  },
  { name: "fractional offsets", body: `values.set([257],firstValue?-.9:secondValue?1.9:'2');` },
  {
    name: "nullish boolean offsets",
    body: `values.set([257],firstValue?null:secondValue?true:undefined);`,
  },
  { name: "NaN offsets", body: `values.set([257],firstValue?NaN:secondValue?'invalid':false);` },
  {
    name: "negative offset before source",
    body: `values.set({get length(){trace.push('length');throw 'length';}},firstValue?-1:secondValue?-Infinity:-1.9);`,
  },
  {
    name: "infinite offset after length",
    body: `values.set({get length(){trace.push('length');if(firstValue)throw 'length';return secondValue?0:1;},get 0(){trace.push('index');return 1;}},Infinity);`,
  },
  {
    name: "offset conversion errors before source",
    body: `values.set({get length(){trace.push('length');return 1;}},firstValue?1n:Symbol('offset'));`,
  },
  {
    name: "oversized source before conversion",
    body: `values.set([1n,Symbol('element'),257,3,4],firstValue?0:secondValue?1:2);`,
  },
  {
    name: "partial writes before error",
    body: `values.set([firstValue?257:2.5,secondValue?1n:Symbol('element'),9],1);`,
  },
  {
    name: "conditional error and suffix",
    body: `values.set([257,firstValue?1n:secondValue?Symbol('element'):2.5,9]);`,
  },
  {
    name: "source argument evaluation precedes offset conversion",
    body: `values.set((trace.push('source'),[257]),(trace.push('offset'),firstValue?1n:secondValue?-1:0));`,
  },
  { name: "empty source bounds", body: `values.set([],firstValue?4:secondValue?5:0);` },
  {
    name: "nullish sources",
    body: `values.set(firstValue?null:undefined,secondValue?-1:Infinity);`,
  },
  {
    name: "primitive sources",
    body: `values.set(firstValue?'12':secondValue?17:Symbol('source'),1);`,
  },
  {
    name: "ignored iterator and live reads",
    body: `values.set({get length(){trace.push('length');return 2;},[Symbol.iterator](){trace.push('iterator');throw 'iterator';},get 0(){trace.push('zero');return firstValue?257:2.5;},get 1(){trace.push('one:'+values[0]);return secondValue?1n:9;}});`,
  },
  {
    name: "bounds before index getters",
    body: `values.set({get length(){trace.push('length');return firstValue?5:secondValue?4:3;},get 0(){trace.push('zero');throw 'zero';}},1);`,
  },
  {
    name: "length error precedence",
    body: `values.set({get length(){trace.push('length');return firstValue?1n:Symbol('length');}},secondValue?-1:Infinity);`,
  },
  {
    name: "captured length and ordered getters",
    body: `const source={get length(){trace.push('length');return 2;},get 0(){trace.push('zero');source[1]=firstValue?257:3.5;return secondValue?1n:2;},1:9};values.set(source);`,
  },
  {
    name: "primitive length coercion",
    body: `values.set({length:firstValue?'2.9':secondValue?-.9:NaN,0:257,1:3.5},1);`,
  },
  {
    name: "typed source snapshot and conversion",
    body: `const source=Float64Array.of(firstValue?257:2.5,secondValue?1e40:-1);values.set(source,1);source[0]=9;trace.push(source[0]);`,
  },
  { name: "same storage source", body: `values.set(values,firstValue?0:secondValue?1:4);` },
  {
    name: "finite optional source shape",
    body: `const source=[...(firstValue?[257]:[]),...(secondValue?[2.5]:[])];values.set(source,2);`,
  },
  {
    name: "source choices",
    body: `const source=firstValue?[257]:[2.5,3.5];values.set(source,secondValue?1:2);`,
  },
  {
    name: "guarded mutations with Boolean observations",
    body: `if(firstValue)values.set([257,2.5]);if(secondValue)values.set([3.5],1);trace.push(Boolean(firstValue)+':'+Boolean(secondValue));`,
  },
  {
    name: "abrupt getter retains prefix",
    body: `values.set({length:3,get 0(){trace.push('zero');return firstValue?257:2.5;},get 1(){trace.push('one');if(secondValue)throw 'one';return 3.5;},get 2(){trace.push('two');throw 'two';}});`,
  },
];
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  controls.map((control) => ({
    name: `${constructor}/${control.name}`,
    body: `const firstValue=first;const secondValue=second;const values=${constructor}.of(1,2,3,4);const trace=[];try{${control.body}trace.push('after');}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return Array.from(values,value=>Object.is(value,-0)?'-0':String(value)).join(',')+':'+values.length+':'+trace.join('|');`,
  })),
);
it.each(cases)("matches typed set and replay: $name", (testCase) => checkSymbolicCases([testCase]));
it.each(cases)("matches concrete typed set: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
