import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface ExpressionContext {
  name: string;
  statement: string;
  normal: string;
  prefix?: string;
}

const contexts: ExpressionContext[] = [
  { name: "direct", statement: "operand();", normal: "7" },
  { name: "not", statement: "!operand();", normal: "7" },
  { name: "plus", statement: "+operand();", normal: "7" },
  { name: "minus", statement: "-operand();", normal: "7" },
  { name: "bitwise-not", statement: "~operand();", normal: "7" },
  { name: "typeof", statement: "typeof operand();", normal: "7" },
  { name: "void", statement: "void operand();", normal: "7" },
  { name: "delete-value", statement: "delete operand();", normal: "7" },
  { name: "conditional", statement: "operand() ? after() : after();", normal: "7" },
  { name: "sequence", statement: "(operand(), after());", normal: "7" },
  { name: "array-element", statement: "[operand(), after()];", normal: "7" },
  { name: "object-value", statement: "({ first: operand(), second: after() });", normal: "7" },
  { name: "object-key", statement: "({ [operand()]: after() });", normal: "'created'" },
  {
    name: "object-spread",
    statement: "({ ...operand(), second: after() });",
    normal: "{ extra: 7 }",
  },
  { name: "array-spread", statement: "[...operand(), after()];", normal: "[7]" },
  { name: "template", statement: "`${operand()}${after()}`;", normal: "7" },
  { name: "tag-callee", statement: "(operand())`${after()}`;", normal: "consume" },
  { name: "tag-substitution", statement: "consume`${operand()}${after()}`;", normal: "7" },
  {
    name: "class-heritage",
    statement: "class Child extends operand() { [after()]() {} static value = after(); }",
    normal: "Constructor",
  },
  {
    name: "class-key",
    statement: "class Child { [operand()]() {} static value = after(); }",
    normal: "'created'",
  },
  { name: "optional-member", statement: "operand()?.value;", normal: "target" },
  { name: "optional-computed", statement: "operand()?.[after()];", normal: "target" },
  { name: "optional-call", statement: "operand()?.(after());", normal: "consume" },
  { name: "member-base", statement: "operand().value;", normal: "target" },
  { name: "member-key", statement: "target[operand()];", normal: "'value'" },
  { name: "computed-member-base", statement: "operand()[after()];", normal: "target" },
  { name: "call-callee", statement: "(operand())(after());", normal: "consume" },
  { name: "call-argument", statement: "consume(operand(), after());", normal: "7" },
  { name: "new-callee", statement: "new (operand())(after());", normal: "Constructor" },
  { name: "new-argument", statement: "new Constructor(operand(), after());", normal: "7" },
  { name: "assignment-key", statement: "target[operand()] = after();", normal: "'value'" },
  { name: "assignment-base", statement: "operand().value = after();", normal: "target" },
  { name: "assignment-right", statement: "target.value = operand();", normal: "7" },
  { name: "compound-key", statement: "target[operand()] += after();", normal: "'value'" },
  { name: "compound-right", statement: "target.value += operand();", normal: "7", prefix: "get|" },
  { name: "update-key", statement: "++target[operand()];", normal: "'value'" },
  { name: "object-binding", statement: "const { value = after() } = operand();", normal: "{}" },
  { name: "array-binding", statement: "const [value = after()] = operand();", normal: "[]" },
  {
    name: "destructuring-assignment",
    statement: "({ value: target.value = after() } = operand());",
    normal: "{}",
  },
];
const thrownSources = [
  "undefined",
  "null",
  "false",
  "0",
  "''",
  "'failure'",
  "NaN",
  "thrownObject",
  "thrownSymbol",
];
const knownOutcomes = new Map([
  ["object-binding", "operand|after|caught:true"],
  ["array-binding", "operand|after|caught:true"],
]);
const cases = contexts.flatMap((context) =>
  [null, ...thrownSources].map((thrown) => ({
    name: `${context.name}/throw=${thrown ?? "none"}`,
    label: `${thrown !== null && knownOutcomes.has(context.name) ? "known divergence: " : ""}${context.name}/throw=${thrown ?? "none"}`,
    expected: `${context.prefix ?? ""}operand|caught:true`,
    actual: thrown === null ? undefined : knownOutcomes.get(context.name),
    isThrowing: thrown !== null,
    body: `const trace = []; const thrownObject = {}; const thrownSymbol = Symbol('thrown'); const thrown = ${thrown ?? "undefined"}; const target = { get value() { trace.push('get'); return 7; }, set value(value) { trace.push('set'); } }; const consume = () => { trace.push('call'); return 7; }; class Constructor { constructor() { trace.push('construct'); } } const operand = () => { trace.push('operand'); ${thrown === null ? `return (${context.normal});` : "throw thrown;"} }; const after = () => { trace.push('after'); return 'value'; }; try { ${context.statement} trace.push('done'); } catch (error) { trace.push('caught:' + Object.is(error, thrown)); } return trace.join('|');`,
  })),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isThrowing }) => {
  if (isThrowing)
    expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
      expected,
    );
  if (actual !== undefined)
    await checkKnownDifferentialWitnesses([
      { name, body, expected, actual: JSON.stringify(actual) },
    ]);
  else await checkDifferentialCases([{ name, body }]);
});

it.each(
  ["null", "undefined"].flatMap((value) =>
    ["operand()?.value", "operand()?.[after()]", "operand()?.(after())"].map((expression) => ({
      name: `${value}/${expression}`,
      body: `const trace = []; const operand = () => { trace.push('operand'); return ${value}; }; const after = () => { trace.push('after'); return 'value'; }; ${expression}; trace.push('done'); return trace.join('|');`,
    })),
  ),
)("preserves actual nullish optional short circuits $name", (testCase) =>
  checkDifferentialCases([testCase]),
);
