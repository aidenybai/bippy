import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const initializers = [
  "(()=>{})",
  "(function targetFunction(){})",
  "(async()=>{})",
  "(function*(){})",
];
const cases: DifferentialCase[] = initializers.flatMap((initializer) =>
  ["'entry'", "Symbol.toStringTag"].flatMap((key) =>
    ["normal", "absent", "throw", "undefined"].flatMap((getter) =>
      ["normal", "absent", "throw"].map((setter) => ({
        name: `${initializer}/${key}/get=${getter}/set=${setter}`,
        body: `const firstValue=first;const secondValue=second;const trace=[];const target=${initializer};target.marker='target';const key=${key};let stored=firstValue?3:7;const getter=function(){trace.push('get:'+this.marker+':'+arguments.length);${getter === "throw" ? "if(firstValue)throw 'getter';" : ""}return ${getter === "undefined" ? "undefined" : "stored"};};const setter=function(value){trace.push('set:'+this.marker+':'+arguments.length+':'+value);${setter === "throw" ? "if(secondValue)throw 'setter';" : ""}stored=value;};Object.defineProperty(target,key,{get:${getter === "absent" ? "firstValue?undefined:getter" : "getter"},set:${setter === "absent" ? "secondValue?undefined:setter" : "setter"},configurable:true});trace.push('defined');try{trace.push('read:'+String(target[key]));const assigned=(target[key]=9);trace.push('assigned:'+assigned);trace.push('read:'+String(target[key]));}catch(error){trace.push(typeof error==='string'?error:error.name);}return trace.join('|')+':'+stored;`,
      })),
    ),
  ),
);
cases.push(
  ...initializers.flatMap((initializer) => [
    {
      name: `${initializer}/tag getter effects`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const target=${initializer};target.marker=secondValue?'A':'B';Object.defineProperty(target,Symbol.toStringTag,{get(){trace.push('get:'+this.marker+':'+arguments.length);return firstValue?'Custom':7;},configurable:true});trace.push('defined');trace.push(Object.prototype.toString.call(target));trace.push(Object.prototype.toString.bind(target)());return trace.join('|');`,
    },
    {
      name: `${initializer}/getter throws undefined`,
      body: `const target=${initializer};let calls=0;Object.defineProperty(target,'entry',{get(){calls++;throw undefined;}});try{target.entry;return 'after';}catch(error){return Object.is(error,undefined)+':'+calls;}`,
    },
    {
      name: `${initializer}/setter throws undefined`,
      body: `const target=${initializer};let calls=0;Object.defineProperty(target,'entry',{set(value){calls++;throw undefined;}});try{target.entry=9;return 'after';}catch(error){return Object.is(error,undefined)+':'+calls;}`,
    },
    {
      name: `${initializer}/inherited read receiver`,
      body: `const firstValue=first;const target=${initializer};target.marker='owner';Object.defineProperty(target,'entry',{get(){return this.marker+':'+arguments.length+':'+(firstValue?'A':'B');}});const receiver=Object.create(target);receiver.marker=second?'child':'other';return receiver.entry;`,
    },
  ]),
  ...initializers.slice(0, 2).flatMap((initializer) =>
    ["'entry'", "'name'", "'length'", "Symbol.toStringTag"].map((key) => ({
      name: `${initializer}/${key}/descriptor and replacement`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const target=${initializer};const key=${key};const getter=function(){trace.push('get');return firstValue?'A':'B';};const setter=function(value){trace.push('set');};Object.defineProperty(target,key,{get:getter,set:setter,enumerable:true,configurable:true});const descriptor=Object.getOwnPropertyDescriptor(target,key);trace.push('descriptor:'+(descriptor.get===getter)+':'+(descriptor.set===setter)+':'+('value' in descriptor)+':'+descriptor.enumerable+':'+descriptor.configurable);trace.push('read:'+target[key]);Object.defineProperty(target,key,{value:secondValue?'data':'other',writable:true,enumerable:true,configurable:true});trace.push('data:'+target[key]);Object.defineProperty(target,key,{get(){trace.push('later');return firstValue?'laterA':'laterB';},set:undefined,enumerable:true,configurable:true});trace.push('read:'+target[key]);return trace.join('|');`,
    })),
  ),
);
cases.push(
  ...initializers.map((initializer) => ({
    name: `${initializer}/accessor receiver identity`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const target=${initializer};Object.defineProperty(target,'entry',{get(){trace.push('get:'+(this===target)+':'+arguments.length);return firstValue?1:2;},set(value){trace.push('set:'+(this===target)+':'+arguments.length+':'+value);},configurable:true});target.entry=secondValue?3:4;const result=target.entry;return result+':'+trace.join('|');`,
  })),
);
const prototypeCases = cases.filter((testCase) =>
  testCase.name.endsWith("/inherited read receiver"),
);
const supportedCases = cases.filter((testCase) => !prototypeCases.includes(testCase));
const getConcreteCases = (testCase: DifferentialCase) =>
  Array.from({ length: 4 }, (_value, index) => ({
    name: `${testCase.name}/assignment=${index}`,
    body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
  }));
it.each(prototypeCases)(
  "known precision gap: function prototype symbolic read: $name",
  async (testCase) => {
    const expected = [false, true].flatMap((first) =>
      [false, true].map((second) =>
        runInNewContext(`(()=>{${testCase.body}})()`, { first, second }, { timeout: 1000 }),
      ),
    );
    expect(expected).toEqual(["other:0:B", "child:0:B", "other:0:A", "child:0:A"]);
    await expect(checkSymbolicCases([testCase])).rejects.toMatchObject({
      name: "AssertionError",
      actual: "static render did not resolve to a component tree",
      expected: null,
    });
  },
);
it.each(prototypeCases)(
  "known precision gap: function prototype concrete read: $name",
  (testCase) =>
    checkKnownDifferentialWitnesses(
      getConcreteCases(testCase).map((concreteCase, index) => ({
        ...concreteCase,
        expected: `${index & 1 ? "child" : "other"}:0:${index & 2 ? "A" : "B"}`,
        actual: `unknown(Object.create with function ${testCase.name.startsWith("(function targetFunction") ? "targetFunction" : "target"})`,
      })),
    ),
);
it.each(supportedCases)("matches native function accessor effects and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(supportedCases)("matches all concrete function accessor inputs: $name", (testCase) =>
  checkDifferentialCases(getConcreteCases(testCase)),
);
