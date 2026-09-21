import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const lengths = [
  "0",
  "3",
  "3.8",
  "-3.8",
  "NaN",
  "Infinity",
  "-Infinity",
  "'4'",
  "2n",
  "Symbol('length')",
  "{valueOf(){trace.push('unexpected length');return 4;}}",
  "undefined",
];
const names = [
  "'custom'",
  "7",
  "undefined",
  "{toString(){trace.push('unexpected name');return 'wrong';}}",
];
const cases: DifferentialCase[] = lengths.flatMap((length) =>
  names.map((name) => ({
    name: `length=${length}/name=${name}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const target=function(...values){trace.push('call:'+this.marker+':'+values.join(','));return 'called';};Object.defineProperty(target,'length',{get(){trace.push('length:'+(this===target)+':'+arguments.length);return firstValue?${length}:6;},configurable:true});Object.defineProperty(target,'name',{get(){trace.push('name:'+(this===target)+':'+arguments.length);return secondValue?${name}:'plain';},configurable:true});trace.push('defined');const bound=target.bind({marker:'owner'},'a');trace.push('bound:'+bound.length+':'+bound.name);const rebound=bound.bind({marker:'wrong'},'b');trace.push('rebound:'+rebound.length+':'+rebound.name);Object.defineProperty(target,'length',{value:99});Object.defineProperty(target,'name',{value:'later'});trace.push('again:'+bound.length+':'+bound.name);trace.push(rebound('c'));return trace.join('|');`,
  })),
);
cases.push(
  ...["length", "name"].flatMap((field) =>
    ["'token'", "undefined"].map((error) => ({
      name: `throwing ${field}/${error}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const target=()=>0;Object.defineProperty(target,'length',{get(){trace.push('length');${field === "length" ? `if(firstValue)throw ${error};` : ""}return 3;}});Object.defineProperty(target,'name',{get(){trace.push('name');${field === "name" ? `if(firstValue)throw ${error};` : ""}return secondValue?'custom':'other';}});try{const bound=target.bind(null,1);trace.push('after:'+bound.length+':'+bound.name);}catch(error){trace.push('caught:'+typeof error+':'+String(error));}return trace.join('|');`,
    })),
  ),
);
cases.push(
  ...["()=>0", "function named(){}", "async()=>0", "function*(){}"].map((initializer) => ({
    name: `${initializer}/metadata descriptors and identity`,
    body: `const firstValue=first;const target=(${initializer});Object.defineProperty(target,'length',{get(){return firstValue?3:4;}});Object.defineProperty(target,'name',{get(){return second?'A':'B';}});const bound=target.bind();const alias=bound;const another=target.bind();const length=Object.getOwnPropertyDescriptor(bound,'length');const name=Object.getOwnPropertyDescriptor(bound,'name');return length.value+':'+name.value+':'+length.writable+':'+length.enumerable+':'+length.configurable+':'+name.writable+':'+name.enumerable+':'+name.configurable+':'+Object.hasOwn(bound,'prototype')+':'+(bound===alias)+':'+(bound===another);`,
  })),
  ...["Symbol('name')", "2n", "true", "null"].map((name) => ({
    name: `non-string name ${name}`,
    body: `const firstValue=first;const target=()=>0;Object.defineProperty(target,'length',{get(){return firstValue?5:0;}});Object.defineProperty(target,'name',{get(){return second?${name}:'known';}});const bound=target.bind(null,1);return bound.length+':'+bound.name;`,
  })),
  {
    name: "length getter replaces name before lookup",
    body: "const firstValue=first;const secondValue=second;const trace=[];const target=()=>0;Object.defineProperty(target,'name',{get(){trace.push('old name');return 'old';},configurable:true});Object.defineProperty(target,'length',{get(){trace.push('length');Object.defineProperty(target,'name',{get(){trace.push('new name');return secondValue?'new':'other';},configurable:true});return firstValue?3:4;}});const bound=target.bind(null,1);return trace.join('|')+':'+bound.length+':'+bound.name;",
  },
  {
    name: "name getter cannot change captured length",
    body: "const firstValue=first;const trace=[];const target=()=>0;Object.defineProperty(target,'length',{get(){trace.push('length');return firstValue?3:4;},configurable:true});Object.defineProperty(target,'name',{get(){trace.push('name');Object.defineProperty(target,'length',{value:99});return second?'name':'other';}});const bound=target.bind(null,1);return trace.join('|')+':'+bound.length+':'+bound.name+':'+target.length;",
  },
  {
    name: "argument acquisition precedes metadata getters",
    body: "const firstValue=first;const secondValue=second;const source=[firstValue?'A':'B'];const trace=[];const target=(...values)=>values.join(',');Object.defineProperty(target,'length',{get(){trace.push('length');source[0]='changed';source.push('extra');return 4;}});Object.defineProperty(target,'name',{get(){trace.push('name');return 'target';}});const bound=target.bind(null,...source);return trace.join('|')+':'+bound(secondValue?'C':'D')+':'+source.join(',');",
  },
  {
    name: "opaque metadata keeps known output types and getter effects",
    body: "const trace=[];const target=()=>0;Object.defineProperty(target,'length',{get(){trace.push('length');return first;}});Object.defineProperty(target,'name',{get(){trace.push('name');return second;}});const bound=target.bind(null,1);return typeof bound.length+':'+typeof bound.name+':'+trace.join('|');",
  },
);
cases.push({
  name: "named target identity inside a bound invocation",
  body: "const target=function self(){return self===target;};const bound=target.bind(null);return bound()+':'+(bound===target)+':'+(bound===bound.bind(null));",
});
cases.push(
  {
    name: "bound invocation uses original self length",
    body: "const target=function self(first,second,third){return self.length;};const bound=target.bind(null,1);return bound()+':'+bound.length;",
  },
  {
    name: "bound invocation uses original self properties and prototype",
    body: "const target=function self(){return self.name+':'+self.extra+':'+(self.prototype===target.prototype);};target.extra=first?'A':'B';const bound=target.bind(null);return bound()+':'+bound.name;",
  },
  {
    name: "rebound invocation reads live original metadata",
    body: "const firstValue=first;const secondValue=second;const trace=[];const target=function self(first,second,third){return self.length+':'+self.name+':'+(self===target);};const bound=target.bind(null,1);const rebound=bound.bind({},2);Object.defineProperty(target,'length',{get(){trace.push('length:'+(this===target));return firstValue?4:5;}});Object.defineProperty(target,'name',{get(){trace.push('name:'+(this===target));return secondValue?'live A':'live B';}});const result=rebound();return result+':'+trace.join('|')+':'+bound.length+':'+rebound.length+':'+bound.name+':'+rebound.name;",
  },
  {
    name: "bound invocation propagates live original getter throws",
    body: "const firstValue=first;const secondValue=second;const trace=[];const target=function self(){const value=self.length;trace.push('body');return value;};const bound=target.bind(null);Object.defineProperty(target,'length',{get(){trace.push('get');if(firstValue)throw secondValue?undefined:'token';return 6;}});try{return bound()+':'+trace.join('|');}catch(error){return String(error)+':'+trace.join('|');}",
  },
);
it.each(cases)("matches native binding metadata and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete binding metadata inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
