import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const cases: DifferentialCase[] = [
  {
    name: "Array/getter acquisition",
    body: "const trace=[]; const source={get [Symbol.iterator](){trace.push('iterator');return undefined;},get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},get 1(){trace.push('1');return 2;}}; const result=Array.from(source,(value,index)=>{trace.push('map:'+index);return value;});return trace.join('|')+'#'+Array.from(result).join(',');",
  },
  {
    name: "Array/live array-like index reads",
    body: "const trace=[];const source={0:1,1:2,length:2};const result=Array.from(source,(value,index)=>{trace.push(index+':'+value);if(index===0){source[1]=9;source[2]=3;source.length=3;}return value;});return trace.join('|')+'#'+Array.from(result).join(',');",
  },
  {
    name: "Array/throw stops later index reads",
    body: "const trace=[];const source={length:2,get 0(){trace.push('0');return 1;},get 1(){trace.push('1');return 2;}};try{Array.from(source,()=>{trace.push('map');throw new Error('stop');});}catch(error){trace.push(error.name+':'+error.message);}return trace.join('|');",
  },
  {
    name: "Array/BigInt length",
    body: "try{const result=Array.from({length:1n});return 'accepted:'+result.length;}catch(error){return error.name+':'+error.message;}",
  },
  {
    name: "Array/primitive source",
    body: "const result=Array.from(5);return typeof result+':'+result.length;",
  },
  {
    name: "Array/invalid iterator",
    body: "try{const result=Array.from({length:1,0:7,[Symbol.iterator]:5});return 'accepted:'+result.length;}catch(error){return error.name+':'+error.message;}",
  },
  {
    name: "Uint8Array/getter acquisition",
    body: "const trace=[]; const source={get [Symbol.iterator](){trace.push('iterator');return undefined;},get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},get 1(){trace.push('1');return 2;}}; const result=Uint8Array.from(source,(value,index)=>{trace.push('map:'+index);return value;});return trace.join('|')+'#'+Array.from(result).join(',');",
  },
  {
    name: "Uint8Array/live array-like index reads",
    body: "const trace=[];const source={0:1,1:2,length:2};const result=Uint8Array.from(source,(value,index)=>{trace.push(index+':'+value);if(index===0){source[1]=9;source[2]=3;source.length=3;}return value;});return trace.join('|')+'#'+Array.from(result).join(',');",
  },
  {
    name: "Uint8Array/throw stops later index reads",
    body: "const trace=[];const source={length:2,get 0(){trace.push('0');return 1;},get 1(){trace.push('1');return 2;}};try{Uint8Array.from(source,()=>{trace.push('map');throw new Error('stop');});}catch(error){trace.push(error.name+':'+error.message);}return trace.join('|');",
  },
  {
    name: "Uint8Array/BigInt length",
    body: "try{const result=Uint8Array.from({length:1n});return 'accepted:'+result.length;}catch(error){return error.name+':'+error.message;}",
  },
  {
    name: "Uint8Array/primitive source",
    body: "const result=Uint8Array.from(5);return typeof result+':'+result.length;",
  },
  {
    name: "Uint8Array/invalid iterator",
    body: "try{const result=Uint8Array.from({length:1,0:7,[Symbol.iterator]:5});return 'accepted:'+result.length;}catch(error){return error.name+':'+error.message;}",
  },
  {
    name: "Array/guarded mapping/source[1] = firstValue ? 7 : 8; source.length = secondValue ? 0 : 4;",
    body: "const firstValue=first;const secondValue=second;const trace=[];const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},1:2};let result;try{result=Array.from(source,(value,index)=>{trace.push('map:'+index+':'+value);if(index===0){source[1] = firstValue ? 7 : 8; source.length = secondValue ? 0 : 4;}return value;});result=Array.from(result).join(',');}catch(error){result=error.name+':'+error.message;}return trace.join('|')+'#'+result;",
  },
  {
    name: "Array/guarded mapping/if(firstValue) throw new Error('stop'); source[1] = secondValue ? 7 : 8;",
    body: "const firstValue=first;const secondValue=second;const trace=[];const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},1:2};let result;try{result=Array.from(source,(value,index)=>{trace.push('map:'+index+':'+value);if(index===0){if(firstValue) throw new Error('stop'); source[1] = secondValue ? 7 : 8;}return value;});result=Array.from(result).join(',');}catch(error){result=error.name+':'+error.message;}return trace.join('|')+'#'+result;",
  },
  {
    name: "Uint8Array/guarded mapping/source[1] = firstValue ? 7 : 8; source.length = secondValue ? 0 : 4;",
    body: "const firstValue=first;const secondValue=second;const trace=[];const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},1:2};let result;try{result=Uint8Array.from(source,(value,index)=>{trace.push('map:'+index+':'+value);if(index===0){source[1] = firstValue ? 7 : 8; source.length = secondValue ? 0 : 4;}return value;});result=Array.from(result).join(',');}catch(error){result=error.name+':'+error.message;}return trace.join('|')+'#'+result;",
  },
  {
    name: "Uint8Array/guarded mapping/if(firstValue) throw new Error('stop'); source[1] = secondValue ? 7 : 8;",
    body: "const firstValue=first;const secondValue=second;const trace=[];const source={get length(){trace.push('length');return 2;},get 0(){trace.push('0');return 1;},1:2};let result;try{result=Uint8Array.from(source,(value,index)=>{trace.push('map:'+index+':'+value);if(index===0){if(firstValue) throw new Error('stop'); source[1] = secondValue ? 7 : 8;}return value;});result=Array.from(result).join(',');}catch(error){result=error.name+':'+error.message;}return trace.join('|')+'#'+result;",
  },
];
for (const constructor of ["Array", "Uint8Array"]) {
  cases.push(
    {
      name: `${constructor}/acquires a getter-provided iterator once`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const source={get [Symbol.iterator](){trace.push('iterator');return function(){trace.push('acquire');return [firstValue?1:2,secondValue?3:4].values();};}};const result=${constructor}.from(source,(value,index)=>{trace.push('map:'+index);return value;});return trace.join('|')+'#'+Array.from(result).join(',');`,
    },
    {
      name: `${constructor}/selects iterator or array-like acquisition`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const source={get [Symbol.iterator](){trace.push('iterator');return firstValue?undefined:function(){trace.push('acquire');return [7,8].values();};},get length(){trace.push('length');return 1;},get 0(){trace.push('0');return secondValue?2:3;}};const result=${constructor}.from(source,(value,index)=>{trace.push('map:'+index);return value;});return trace.join('|')+'#'+Array.from(result).join(',');`,
    },
    {
      name: `${constructor}/iterator lookup throw prevents length and mapper calls`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const source={get [Symbol.iterator](){trace.push('iterator');if(firstValue)throw new Error('iterator');return undefined;},get length(){trace.push('length');return 1;},get 0(){trace.push('0');return secondValue?2:3;}};let result;try{result=Array.from(${constructor}.from(source,(value)=>{trace.push('map');return value;})).join(',');}catch(error){result=error.name+':'+error.message;}return trace.join('|')+'#'+result;`,
    },
  );
  cases.push({
    name: `${constructor}/writable length stays fixed during mapping`,
    body: `const firstValue=first;const secondValue=second;const trace=[];let length=2;const source={get length(){trace.push('length');return length;},set length(value){trace.push('resize:'+value);length=value;},get 0(){trace.push('0');return 1;},1:2};const result=${constructor}.from(source,(value,index)=>{trace.push('map:'+index+':'+value);if(index===0){source[1]=firstValue?7:8;source.length=secondValue?0:4;}return value;});return trace.join('|')+'#'+Array.from(result).join(',');`,
  });
}

it.each(cases)("matches native array-like from and pinned replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete array-like from inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: testCase.name + "/assignment=" + index,
      body: "const first=" + !!(index & 2) + ";const second=" + !!(index & 1) + ";" + testCase.body,
    })),
  ),
);
