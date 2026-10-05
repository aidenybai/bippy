import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  DifferentialMismatch,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ConstructCase extends DifferentialCase {
  hasOpaqueMessage?: boolean;
}

const targets = [
  "function Target(...values){trace.push('body');this.value=values.join(',');}",
  "const Target=class{constructor(...values){trace.push('body');this.value=values.join(',');}};",
  "function Original(...values){trace.push('body');this.value=values.join(',');}const Target=Original.bind({value:'wrong'},'bound');",
];
const cases: ConstructCase[] = targets.flatMap((target) =>
  ["", ",Target", ",undefined", ",()=>0"].map((newTarget) => ({
    name: `${target}/${newTarget || "omitted newTarget"}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];${target}const source={get length(){trace.push('length');return firstValue?2:1;},get 0(){trace.push('0');Object.defineProperty(source,'length',{value:0});return 'A';},get 1(){trace.push('1');return secondValue?'B':'C';},[Symbol.iterator](){throw 'iterator';}};try{const result=Reflect.construct(Target,(trace.push('argument'),source)${newTarget});return result.value+':'+trace.join('|');}catch(error){return error.name+':'+trace.join('|');}`,
  })),
);
cases.push(
  ...[
    "undefined",
    "null",
    "1",
    "Symbol('target')",
    "{}",
    "[]",
    "()=>0",
    "async()=>0",
    "function*(){}",
    "({method(){}}).method",
    "Math.max",
    "Symbol",
    "BigInt",
    "new Proxy({}, {construct(){trace.push('trap');return {};}})",
    "new Proxy(()=>0, {construct(){trace.push('trap');return {};}})",
  ].flatMap((target) =>
    ["Target", "()=>0"].map((newTarget) => ({
      name: `target validation ${target}/newTarget ${newTarget}`,
      body: `const trace=[];const Target=function(){};const source={get length(){trace.push('length');throw 'length';}};try{Reflect.construct(${target},(trace.push('argument'),source),${newTarget});trace.push('accepted');}catch(error){trace.push(error.name);}return trace.join('|');`,
    })),
  ),
  ...["", ",undefined", ",null", ",true", ",0", ",'abc'", ",Symbol('list')", ",2n"].map(
    (argument) => ({
      name: `invalid argument list ${argument || "omitted"}`,
      body: `const trace=[];function Target(){trace.push('body');}try{Reflect.construct(Target${argument});return 'accepted:'+trace.join('|');}catch(error){return error.name+':'+error.message+':'+trace.join('|');}`,
    }),
  ),
  ...["undefined", "'2.9'", "-1", "NaN", "Symbol('length')", "1n", "null"].map((length) => ({
    name: `array-like length ${length}`,
    body: `const trace=[];function Target(...values){trace.push('body');this.value=values.join(',');}const source={get length(){trace.push('length');return ${length};},get 0(){trace.push('0');return 'A';},get 1(){trace.push('1');return 'B';}};try{return Reflect.construct(Target,source).value+':'+trace.join('|');}catch(error){return error.name+':'+error.message+':'+trace.join('|');}`,
  })),
  ...["length", "0"].flatMap((key) =>
    ["'token'", "undefined"].flatMap((error) =>
      [false, true].map((isForeign) => ({
        name: `throwing ${key}/${error}/foreign=${isForeign}`,
        body: `const firstValue=first;const trace=[];function Target(){trace.push('target');}function Other(){trace.push('other');}const source={get length(){trace.push('length');${key === "length" ? `throw ${error};` : "return 2;"}},get 0(){trace.push('0');${key === "0" ? `throw ${error};` : "return 'A';"}},get 1(){trace.push('1');return 'B';}};try{Reflect.construct(Target,source,${isForeign ? "Other" : "Target"});return 'accepted:'+trace.join('|');}catch(error){return String(error)+':'+trace.join('|');}`,
      })),
    ),
  ),
);
cases.push(
  {
    name: "selected targets validate before array-like reads",
    body: "const firstValue=first;const secondValue=second;const trace=[];function Target(value){trace.push('body');this.value=value;}const selected=firstValue?Target:()=>0;const newTarget=secondValue?selected:()=>0;const source={get length(){trace.push('length');return 1;},get 0(){trace.push('0');return 'value';}};try{const result=Reflect.construct(selected,source,newTarget);return result.value+':'+trace.join('|');}catch(error){return error.name+':'+trace.join('|');}",
  },
  {
    name: "inherited argument getters retain the source receiver",
    body: "const trace=[];function Target(...values){trace.push('body');this.value=values.join(',');}const prototype={get length(){trace.push('length:'+(this===source));return 2;},get 0(){trace.push('0:'+(this===source));return first?'A':'B';},get 1(){trace.push('1:'+(this===source));return second?'C':'D';}};const source=Object.create(prototype);return Reflect.construct(Target,source).value+':'+trace.join('|');",
  },
  {
    name: "argument acquisition precedes live prototype selection",
    body: "const firstValue=first;const trace=[];function Target(value){trace.push('body');this.value=value;}Target.prototype={marker:'old'};const source={get length(){trace.push('length');return 1;},get 0(){trace.push('0');Target.prototype={marker:firstValue?'new A':'new B'};return 'value';}};const result=Reflect.construct(Target,source);return result.value+':'+result.marker+':'+trace.join('|');",
  },
);
cases.push(
  ...["", "undefined", "()=>0"].map((argument) => ({
    name: `missing arguments preserve constructor validation priority: ${argument || "none"}`,
    hasOpaqueMessage: argument === "()=>0",
    body: `try{Reflect.construct(${argument});return 'accepted';}catch(error){return error.name+':'+error.message;}`,
  })),
);
it.each(cases.filter((testCase) => !testCase.hasOpaqueMessage))(
  "matches native Reflect.construct acquisition and replay: $name",
  (testCase) => checkSymbolicCases([testCase]),
);
it.each(cases.filter((testCase) => testCase.hasOpaqueMessage))(
  "known precision gap: constructor source in error message: $name",
  async (testCase) => {
    const expected = "TypeError:()=>0 is not a constructor";
    expect(runInNewContext(`(()=>{${testCase.body}})()`, {}, { timeout: 1000 })).toBe(expected);
    let observed: unknown;
    try {
      await checkSymbolicCases([testCase]);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(DifferentialMismatch);
    if (!(observed instanceof DifferentialMismatch))
      throw new Error("Expected recorded message precision gap");
    expect(observed.actual).toEqual([
      { ...testCase, expected: Array(4).fill(expected), actual: "<string: + on dynamic values>" },
    ]);
  },
);
it.each(cases.filter((testCase) => testCase.hasOpaqueMessage))(
  "known precision gap: concrete constructor source in error message: $name",
  (testCase) =>
    checkKnownDifferentialWitnesses(
      Array.from({ length: 4 }, (_value, index) => ({
        name: `${testCase.name}/${index}`,
        body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
        expected: "TypeError:()=>0 is not a constructor",
        actual: "<string: + on dynamic values>",
      })),
    ),
);
it.each(cases.filter((testCase) => !testCase.hasOpaqueMessage))(
  "matches concrete Reflect.construct acquisition: $name",
  (testCase) =>
    checkDifferentialCases(
      Array.from({ length: 4 }, (_value, index) => ({
        name: `${testCase.name}/${index}`,
        body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
      })),
    ),
);
