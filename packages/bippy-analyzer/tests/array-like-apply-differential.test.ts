import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ArrayLikeProgram {
  name: string;
  setup: string;
  callback?: string;
}

const programs: ArrayLikeProgram[] = [
  {
    name: "plain indexed arguments",
    setup: "const source = {0:firstValue ? 1 : 2, 1:secondValue ? 3 : 4, length:2};",
  },
  {
    name: "length once before indexed getters",
    setup:
      "const source = {get length(){trace.push('length'); return firstValue ? 0 : 2;}, get 0(){trace.push('0'); return secondValue ? 7 : 8;}, get 1(){trace.push('1'); return 9;}};",
  },
  {
    name: "fixed length with live indexed reads",
    setup:
      "const source = {length:2, get 0(){trace.push('0'); this.length = firstValue ? 0 : 3; this[1] = secondValue ? 7 : 8; this[2] = 9; return 1;}, 1:2};",
  },
  {
    name: "inherited getter receiver",
    setup:
      "const prototype = {get 1(){trace.push('receiver:' + (this === source)); return this.marker + 10;}}; const source = Object.create(prototype); source.length = 2; source[0] = firstValue ? 1 : 2; source.marker = secondValue ? 3 : 4;",
  },
  {
    name: "throwing length prevents reads and invocation",
    setup:
      "const source = {get length(){trace.push('length'); if(firstValue) throw new Error('length'); return 2;}, get 0(){trace.push('0'); return secondValue ? 7 : 8;}, get 1(){trace.push('1'); return 9;}};",
  },
  {
    name: "throwing indexed getters stop acquisition",
    setup:
      "const source = {length:2, get 0(){trace.push('0'); if(firstValue) throw new Error('zero'); return 7;}, get 1(){trace.push('1'); if(secondValue) throw new Error('one'); return 9;}};",
  },
  {
    name: "ignores iterator property",
    setup:
      "const source = {0:firstValue ? 2 : 3, length:1, get [Symbol.iterator](){trace.push('iterator'); throw new Error('iterator');}};",
  },
  {
    name: "copies arguments before callback mutation",
    setup: "const source = {0:firstValue ? 1 : 2, 1:secondValue ? 3 : 4, length:2};",
    callback:
      "function(left,right){trace.push('call'); source[0] = 99; source.length = 0; return [arguments.length, arguments[0], left, right, this.tag].join(':');}",
  },
];

for (const length of [
  "firstValue ? 1.9 : '2.9'",
  "firstValue ? -1 : NaN",
  "firstValue ? null : undefined",
  "firstValue ? true : false",
  "firstValue ? 'invalid' : '-Infinity'",
  "firstValue ? 1n : Symbol('length')",
]) {
  programs.push({
    name: `primitive length coercion ${length}`,
    setup: `const source = {get length(){trace.push('length'); return ${length};}, get 0(){trace.push('0'); return secondValue ? 7 : 8;}, get 1(){trace.push('1'); return 9;}};`,
  });
}
for (const source of [
  "firstValue ? null : undefined",
  "firstValue ? 1 : 'ab'",
  "firstValue ? 1n : Symbol('source')",
  "firstValue ? false : {length:0}",
]) {
  programs.push({ name: `argument list validation ${source}`, setup: `const source = ${source};` });
}

const cases: DifferentialCase[] = ["function", "reflect"].flatMap((form) =>
  programs.map((program) => ({
    name: `${form}: ${program.name}`,
    body: `const firstValue = first; const secondValue = second; const trace = []; ${program.setup} const receiver = {tag:'owner'}; const target = ${program.callback ?? "function(left,right){trace.push('call'); return [arguments.length,left,right,this.tag].join(':');}"}; let result; try { result = ${form === "function" ? "target.apply(receiver, source)" : "Reflect.apply(target, receiver, source)"}; } catch (error) { result = error.name + ':' + error.message; } return trace.join(',') + '|' + result;`,
  })),
);

it.each(cases)(
  "matches native array-like argument acquisition and pinned replay for $name",
  (testCase) => checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete array-like argument inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
