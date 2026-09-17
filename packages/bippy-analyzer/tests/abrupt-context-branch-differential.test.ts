import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { checkDifferentialCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

interface BranchContext {
  name: string;
  statement: string;
  normal: string;
  completed: number;
  interrupted?: number;
}

const contexts: BranchContext[] = [
  { name: "direct", statement: "operand();", normal: "7", completed: 0 },
  { name: "not", statement: "!operand();", normal: "7", completed: 0 },
  { name: "typeof", statement: "typeof operand();", normal: "7", completed: 0 },
  { name: "sequence", statement: "(operand(), after());", normal: "7", completed: 1 },
  {
    name: "optional-member-key",
    statement: "operand()?.[after()];",
    normal: "{ value: 7 }",
    completed: 1,
  },
  { name: "call-callee", statement: "(operand())(after());", normal: "consume", completed: 11 },
  { name: "call-argument", statement: "consume(operand(), after());", normal: "7", completed: 11 },
  {
    name: "new-argument",
    statement: "new Constructor(operand(), after());",
    normal: "7",
    completed: 11,
  },
  { name: "assignment-right", statement: "target.value = operand();", normal: "7", completed: 10 },
  {
    name: "compound-right",
    statement: "target.value += operand();",
    normal: "7",
    completed: 11,
    interrupted: 1,
  },
  {
    name: "assignment-key",
    statement: "target[operand()] = after();",
    normal: "'value'",
    completed: 11,
  },
  { name: "update-key", statement: "++target[operand()];", normal: "'value'", completed: 11 },
  {
    name: "class-heritage",
    statement: "class Child extends operand() { [after()]() {} static value = after(); }",
    normal: "Constructor",
    completed: 2,
  },
  {
    name: "class-key",
    statement: "class Child { [operand()]() {} static value = after(); }",
    normal: "'value'",
    completed: 1,
  },
];
const cases = contexts.map((context) => ({
  name: context.name,
  expected: [`normal:${context.completed}`, `caught:true:${context.interrupted ?? 0}`],
  body: `let count = 0; const target = { get value() { count++; return 7; }, set value(value) { count += 10; } }; const consume = () => { count += 10; }; class Constructor { constructor() { count += 10; } } const operand = () => { if (first) throw 'failure'; return (${context.normal}); }; const after = () => { count++; return 'value'; }; try { ${context.statement} return 'normal:' + count; } catch (error) { return 'caught:' + (error === 'failure') + ':' + count; }`,
}));

it.each(cases)("preserves symbolic abrupt effects $name", async ({ name, body, expected }) => {
  for (let index = 0; index < 4; index++) {
    expect(
      runInNewContext(
        `"use strict"; (() => { ${body} })()`,
        { first: !!(index & 2), second: !!(index & 1) },
        { timeout: 1000 },
      ),
    ).toBe(expected[index & 2 ? 1 : 0]);
  }
  await checkSymbolicCases([{ name, body }]);
});

it.each(cases)("matches all concrete abrupt-effect pins $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
