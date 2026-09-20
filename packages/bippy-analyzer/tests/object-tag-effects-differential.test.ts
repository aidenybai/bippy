import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface TagCase {
  name: string;
  body: string;
}
const tags: TagCase[] = [
  { name: "strings", body: "return firstValue?'A':'B';" },
  { name: "empty string", body: "return firstValue?'':'B';" },
  { name: "undefined", body: "return firstValue?undefined:'B';" },
  { name: "number", body: "return firstValue?7:'B';" },
  { name: "symbol", body: "return firstValue?Symbol('entry'):'B';" },
  {
    name: "object not coerced",
    body: "return firstValue?{toString(){trace.push('unexpected');return 'bad';}}:'B';",
  },
  { name: "throw", body: "if(firstValue)throw 'tag';return 'B';" },
];
const invocations = [
  { name: "direct", expression: "target.toString()" },
  { name: "call", expression: "Object.prototype.toString.call(target)" },
  {
    name: "apply",
    expression:
      "Object.prototype.toString.apply(target,{get length(){trace.push('length');return 1;},get 0(){trace.push('arg');return 0;}})",
  },
  { name: "bound", expression: "Object.prototype.toString.bind(target)()" },
  { name: "unary", expression: "+target" },
  { name: "update", expression: "++value" },
];
const cases: DifferentialCase[] = tags.flatMap((tag) =>
  [false, true].flatMap((isInherited) =>
    invocations.map((invocation) => ({
      name: `${tag.name}/inherited=${isInherited}/${invocation.name}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const owner={};const target=${isInherited ? "Object.create(owner)" : "owner"};target.marker=secondValue?'one':'two';target.valueOf=function(){trace.push('valueOf');return this;};Object.defineProperty(owner,Symbol.toStringTag,{get(){trace.push('tag:'+this.marker+':'+arguments.length);this.marker='changed';${tag.body}},configurable:true});let value=target;try{const result=${invocation.expression};trace.push('after:'+typeof result+':'+String(result));}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return trace.join('|')+':'+target.marker+':'+(firstValue?'A':'B');`,
    })),
  ),
);
it.each(cases)("matches native object tag effects and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete object tag inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
