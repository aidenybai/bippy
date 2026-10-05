import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ConstructionCase extends DifferentialCase {
  hasRepeatedAmbientRead?: boolean;
}

const cases: ConstructionCase[] = [1, 2].flatMap((depth) =>
  [
    "undefined",
    "0",
    "null",
    "Symbol('returned')",
    "2n",
    "'ignored'",
    "{value:'replacement',marker:'returned'}",
    "function replacement(){}",
    "['returned']",
  ].map((returned) => ({
    name: `binding depth ${depth}/return ${returned}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const owner={value:'owner'};function Target(...values){trace.push('body:'+(this===owner));this.value=values.join(',');if(firstValue)return ${returned};}Target.prototype={marker:'initial'};const Initial=Target.bind(owner,'a');const Bound=${depth === 1 ? "Initial" : "Initial.bind({value:'wrong'},'b')"};Object.defineProperty(Bound,'prototype',{get(){trace.push('unexpected prototype');throw 'prototype';}});if(secondValue)Target.prototype={marker:'live'};const result=new Bound('c');return typeof result+':'+result.value+':'+result.marker+':'+(result instanceof Target)+':'+(result instanceof Bound)+':'+owner.value+':'+trace.join('|');`,
  })),
);
cases.push(
  ...[
    "new Bound(value)",
    "Reflect.construct(Bound,[value])",
    "Reflect.construct(Bound,[value],Bound)",
  ].map((expression) => ({
    name: `construction form ${expression}`,
    body: `const firstValue=first;const secondValue=second;const owner={};const trace=[];function Target(...values){trace.push('body');this.value=values.join(',');}const Bound=firstValue?Target.bind(owner,'A'):Target.bind(owner,'B');const value=secondValue?1:2;const result=${expression};return result.value+':'+(result instanceof Target)+':'+(result instanceof Bound)+':'+trace.join('|');`,
  })),
  ...["'token'", "undefined"].map((error) => ({
    name: `constructor throws ${error}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];function Target(value){trace.push('body:'+value);if(firstValue)throw ${error};this.value=value;}const Bound=Target.bind({value:'wrong'},secondValue?'A':'B');try{const result=new Bound();return result.value+':'+trace.join('|');}catch(error){return String(error)+':'+trace.join('|');}`,
  })),
  {
    name: "prototype changes during construction do not change the allocated instance",
    body: "const firstValue=first;function Target(){this.value='own';Target.prototype={marker:firstValue?'new A':'new B'};}Target.prototype={marker:'original'};const Bound=Target.bind(null);const result=new Bound();return result.marker+':'+Target.prototype.marker+':'+result.value+':'+(result instanceof Target)+':'+(result instanceof Bound);",
  },
  ...["null", "undefined", "0", "'not an object'", "Symbol('prototype')"].map((prototype) => ({
    name: `primitive target prototype ${prototype}`,
    body: `const firstValue=first;function Target(value){this.value=value;}Target.prototype=${prototype};const Bound=Target.bind(null,firstValue?'A':'B');const result=new Bound();return result.value+':'+(Object.getPrototypeOf(result)===Object.prototype);`,
  })),
);
cases.push(
  ...[false, true].map((isBound) => ({
    name: `${isBound ? "bound" : "unbound"} definite argument storage snapshot`,
    body: `const firstValue=first;const secondValue=second;const source=[undefined,secondValue?'A':'B'];const trace=[];function Target(firstArgument=(source[1]='changed',trace.push('default'),'default'),secondArgument){this.value=firstArgument+':'+secondArgument;}const Bound=${isBound ? "Target.bind(null)" : "Target"};const result=Reflect.construct(Bound,source);return result.value+':'+source[1]+':'+trace.join('|');`,
  })),
  ...[false, true].map((isBound) => ({
    name: `${isBound ? "bound" : "unbound"} guarded ordinary and primitive prototypes`,
    hasRepeatedAmbientRead: true,
    body: `const prototype={marker:'custom'};function Target(){this.value='instance';}Target.prototype=first?prototype:0;const Bound=${isBound ? "Target.bind(null)" : "Target"};const result=new Bound();return result.value+':'+result.marker+':'+(Object.getPrototypeOf(result)===(first?prototype:Object.prototype));`,
  })),
);
cases.push(
  ...cases
    .filter((testCase) => testCase.hasRepeatedAmbientRead)
    .map((testCase) => ({
      name: `${testCase.name}/captured input`,
      body: `const firstValue=first;${testCase.body.replaceAll("first?", "firstValue?")}`,
    })),
);
const nonConstructors = [
  "()=>trace.push('body')",
  "async()=>trace.push('body')",
  "function*(){trace.push('body');}",
  "async function*(){trace.push('body');}",
  "({method(){trace.push('body');}}).method",
  "({async method(){trace.push('body');}}).method",
];
cases.push(
  ...nonConstructors.flatMap((initializer) =>
    [0, 1, 2].flatMap((depth) =>
      [false, true].map((hasPrototype) => ({
        name: `non-constructor ${initializer}/depth ${depth}/own prototype ${hasPrototype}`,
        body: `const trace=[];const Target=(${initializer});${hasPrototype ? "Object.defineProperty(Target,'prototype',{value:{}});" : ""}const Bound=${depth === 0 ? "Target" : depth === 1 ? "Target.bind(null)" : "Target.bind(null).bind({})"};try{new Bound((trace.push('arg'),1));trace.push('accepted');}catch(error){trace.push(error.name);}return trace.join('|');`,
      })),
    ),
  ),
);
it.each(cases)("matches native bound construction and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete bound construction: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
