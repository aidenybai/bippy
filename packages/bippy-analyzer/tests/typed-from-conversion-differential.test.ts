import { inspect } from "node:util";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  DifferentialMismatch,
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
  "const describe=value=>Object.is(value,-0)?'-0':String(value);return Array.from(result,describe).join(',')+':'+result.byteLength+':'+ArrayBuffer.isView(result)+':'+trace.join('|');";
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  [
    {
      name: "primitive iterable",
      body: `const result=${constructor}.from([firstValue?257:-129,secondValue?2.5:3.5,-0,NaN,Infinity,-Infinity,0.1,1e40,1e-46,'0xff','-0','invalid',true,false,null,undefined]);${observe}`,
    },
    {
      name: "mapped primitive iterable",
      body: `const receiver={marker:'receiver'};const result=${constructor}.from([firstValue?257:-129,secondValue?2.5:3.5],function(value,index){trace.push(this.marker+':'+arguments.length+':'+index);return value;},receiver);${observe}`,
    },
    {
      name: "array-like live conversion",
      body: `const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');return firstValue?'257.9':'-129';},get 1(){trace.push('1');return secondValue?2.5:3.5;}};const result=${constructor}.from(source,(value,index)=>{trace.push('map'+index);return value;});${observe}`,
    },
    {
      name: "optional iterable",
      body: `const source=[0.1];if(firstValue)source.push(257);if(secondValue)source.push(-0);const result=${constructor}.from(source,(value,index)=>{trace.push(String(index));return value;});${observe}`,
    },
    {
      name: "iterable snapshot before mapping",
      body: `const source=[firstValue?257:-129,secondValue?2.5:3.5];const result=${constructor}.from(source,(value,index)=>{trace.push(String(index));if(index===0){source[1]=9;source.push(10);}return value;});${observe}`,
    },
    {
      name: "mapper abrupt prefix",
      body: `const result=${constructor}.from([1,2,3],(value,index)=>{trace.push(String(index));if(index===(firstValue?0:1)&&secondValue)throw undefined;return value;});${observe}`,
    },
    {
      name: "iterable conversion stops mapping",
      body: `const result=${constructor}.from([firstValue?1n:257,2],(value,index)=>{trace.push(String(index));if(index===1&&secondValue)throw 'later';return value;});${observe}`,
    },
    {
      name: "array-like conversion stops reads",
      body: `const source={length:2,get 0(){trace.push('0');return firstValue?1n:257;},get 1(){trace.push('1');if(secondValue)throw 'later';return 2;}};const result=${constructor}.from(source);${observe}`,
    },
    {
      name: "mapper symbol conversion",
      body: `const result=${constructor}.from([1,2],(value,index)=>{trace.push(String(index));if(index===0&&firstValue)return Symbol('token');if(index===1&&secondValue)throw 'later';return value;});${observe}`,
    },
    {
      name: "mapped array-like conversion",
      body: `const source={length:2,get 0(){trace.push('get0');return 1;},get 1(){trace.push('get1');return 2;}};const result=${constructor}.from(source,(value,index)=>{trace.push('map'+index);return index===0&&firstValue?(secondValue?1n:Symbol('token')):value;});${observe}`,
    },
    {
      name: "draining precedes conversion",
      body: `function* source(){trace.push('yield0');yield firstValue?1n:257;trace.push('yield1');if(secondValue)throw 'drain';yield 2;}const result=${constructor}.from(source(),(value,index)=>{trace.push('map'+index);return value;});${observe}`,
    },
    {
      name: "successful draining precedes conversion",
      body: `function* source(){trace.push('yield0');yield firstValue?1n:257;trace.push('yield1');yield secondValue?2:3;}const result=${constructor}.from(source(),(value,index)=>{trace.push('map'+index);return value;});${observe}`,
    },
    {
      name: "optional mapper closure and receiver",
      body: `const source=[257];if(firstValue)source.push(2.5);const receiver={count:0};const make=()=>{let count=0;return {mapper:function(value){count++;this.count++;return value;},read:()=>count};};const state=make();const result=${constructor}.from(source,state.mapper,receiver);if(secondValue)receiver.count+=10;trace.push(state.read()+':'+receiver.count);${observe}`,
    },
    ...["iterable", "array-like"].map((sourceKind) => ({
      name: `${sourceKind} conversion retains independent closure scopes`,
      body: `let reads=0;const receiver={count:0};const make=()=>{let count=0;return {mapper:function(value,index){count++;this.count++;if(index===1&&secondValue)throw 'later';return value;},read:()=>count};};const state=make();const source=${sourceKind === "iterable" ? "[firstValue?1n:257,2]" : "{length:2,get 0(){reads++;return firstValue?1n:257;},get 1(){reads++;return 2;}}"};let outcome;try{outcome=${constructor}.from(source,state.mapper,receiver).join(',');}catch(error){outcome=typeof error==='string'?error:error.name;}return state.read()+':'+reads+':'+receiver.count+':'+outcome;`,
    })),
    {
      name: "first conversion error wins",
      body: `const result=${constructor}.from([firstValue?1n:Symbol('first'),secondValue?Symbol('second'):1n],(value,index)=>{trace.push(String(index));return value;});${observe}`,
    },
  ].map((testCase) => ({
    name: `${constructor}/${testCase.name}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];try{${testCase.body}}catch(error){return (error===undefined?'undefined':typeof error==='string'?error:error.name+':'+error.message)+':'+trace.join('|');}`,
  })),
);
const hasDrainGap = (testCase: DifferentialCase): boolean =>
  testCase.name.endsWith("/draining precedes conversion");
it.each(cases.filter((testCase) => !hasDrainGap(testCase)))(
  "matches typed from conversion and replay: $name",
  (testCase) => checkSymbolicCases([testCase]),
);
it.each(cases.filter(hasDrainGap))(
  "known precision gap: generator drain completion before conversion: $name",
  async (testCase) => {
    const nativeSuccess: unknown = runInNewContext(
      `(()=>{${testCase.body}})()`,
      { first: false, second: false },
      { timeout: 1000 },
    );
    const nativeError: unknown = runInNewContext(
      `(()=>{${testCase.body}})()`,
      { first: true, second: false },
      { timeout: 1000 },
    );
    let observed: unknown;
    try {
      await checkSymbolicCases([testCase]);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(DifferentialMismatch);
    if (!(observed instanceof DifferentialMismatch))
      throw new Error("Expected generator drain precision gap");
    expect(observed.actual).toHaveLength(1);
    expect(observed.actual[0].expected).toEqual([
      nativeSuccess,
      "drain:yield0|yield1",
      nativeError,
    ]);
    expect(observed.actual[0].actual).toBe(inspect([nativeError, nativeSuccess]));
  },
);
it.each(cases)("matches concrete typed from conversion: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
