import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface InvocationForm {
  name: string;
  expression: string;
}

const forms: InvocationForm[] = [
  { name: "direct", expression: "Reflect.apply(callback, receiver, args)" },
  { name: "alias", expression: "((invoke) => invoke(callback, receiver, args))(Reflect.apply)" },
  { name: "call", expression: "Reflect.apply.call(null, callback, receiver, args)" },
  { name: "apply", expression: "Reflect.apply.apply(null, [callback, receiver, args])" },
  { name: "bind", expression: "Reflect.apply.bind(null, callback, receiver)(args)" },
  { name: "nested", expression: "Reflect.apply(Reflect.apply, null, [callback, receiver, args])" },
];

const cases: DifferentialCase[] = forms
  .flatMap((form) => [
    {
      name: `${form.name} preserves arguments, receiver, and exact call count`,
      body: `const receiver = {tag:'receiver',total:0}; const args = [firstValue ? 1 : 2, secondValue ? 3 : 4]; let calls = 0; const callback = function(left,right) { calls++; this.total += left; return [this.tag, arguments.length, left, right].join(':'); }; const result = ${form.expression}; return [result, calls, receiver.total, args.join(',')].join('|');`,
    },
    {
      name: `${form.name} retains a bound receiver and leading argument`,
      body: `const owner = {tag:'owner',total:0}; const receiver = {tag:'other',total:100}; const args = [firstValue ? 1 : 2, secondValue ? 3 : 4]; let calls = 0; const callback = function(leading,left,right) { calls++; this.total += leading + left; return [this.tag, arguments.length, leading, left, right].join(':'); }.bind(owner, 5); const result = ${form.expression}; return [result, calls, owner.total, receiver.total, args.join(',')].join('|');`,
    },
    {
      name: `${form.name} propagates callback throws without repeating effects`,
      body: `const receiver = {total:0}; const args = [secondValue ? 3 : 4]; let calls = 0; const callback = function(value) { calls++; this.total += value; if (firstValue) throw new Error('stop'); return value + 1; }; let result; try { result = ${form.expression}; } catch (error) { result = error.name + ':' + error.message; } return [result, calls, receiver.total].join('|');`,
    },
  ])
  .map((testCase) => ({
    ...testCase,
    body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
  }));

it.each(cases)("matches native Reflect.apply invocation and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete Reflect.apply inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
