import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface AwaitReferenceCase {
  name: string;
  expression: string;
  mutate: string;
  staged: string;
  expected: string;
  actual: string;
}

const cases: AwaitReferenceCase[] = [
  {
    name: "binary left operand",
    expression: "value + await pending",
    mutate: "value = 100;",
    staged:
      "const previous = value; const settled = await pending; const result = previous + settled;",
    expected: "sync|settle|result:3|done#100#10,20#1#1",
    actual: "sync|settle|result:102|done#100#10,20#1#1",
  },
  {
    name: "computed assignment reference",
    expression: "(items[index] = await pending)",
    mutate: "index = 1;",
    staged:
      "const target = items; const key = index; const settled = await pending; const result = (target[key] = settled);",
    expected: "sync|settle|result:2|done#1#2,20#1#1",
    actual: "sync|settle|result:2|done#1#10,2#1#1",
  },
  {
    name: "compound assignment old value",
    expression: "(value += await pending)",
    mutate: "value = 100;",
    staged:
      "const previous = value; const settled = await pending; const result = (value = previous + settled);",
    expected: "sync|settle|result:3|done#3#10,20#1#1",
    actual: "sync|settle|result:102|done#102#10,20#1#1",
  },
  {
    name: "compound property reference",
    expression: "(receiver.value += await pending)",
    mutate: "receiver = { value: 100 };",
    staged:
      "const target = receiver; const previous = target.value; const settled = await pending; const result = (target.value = previous + settled);",
    expected: "sync|settle|result:3|done#1#10,20#3#100",
    actual: "sync|settle|result:102|done#1#10,20#1#102",
  },
  {
    name: "left call effects",
    expression: "tap('left', value) + await pending",
    mutate: "value = 100;",
    staged:
      "const previous = tap('left', value); const settled = await pending; const result = previous + settled;",
    expected: "left:1|sync|settle|result:3|done#100#10,20#1#1",
    actual: "sync|settle|left:100|result:102|done#100#10,20#1#1",
  },
  {
    name: "argument prefixes",
    expression: "collect(tap('arg', value), await pending, tap('tail', value))",
    mutate: "value = 100;",
    staged:
      "const callee = collect; const previous = tap('arg', value); const settled = await pending; const result = callee(previous, settled, tap('tail', value));",
    expected: "arg:1|sync|settle|tail:100|result:1,2,100|done#100#10,20#1#1",
    actual: "sync|settle|arg:100|tail:100|result:100,2,100|done#100#10,20#1#1",
  },
  {
    name: "array prefixes",
    expression: "[tap('item', value), await pending].join(',')",
    mutate: "value = 100;",
    staged:
      "const previous = tap('item', value); const settled = await pending; const result = [previous, settled].join(',');",
    expected: "item:1|sync|settle|result:1,2|done#100#10,20#1#1",
    actual: "sync|settle|item:100|result:100,2|done#100#10,20#1#1",
  },
  {
    name: "template prefixes",
    expression: "`${tap('template', value)}:${await pending}`",
    mutate: "value = 100;",
    staged:
      "const previous = tap('template', value); const settled = await pending; const result = `${previous}:${settled}`;",
    expected: "template:1|sync|settle|result:1:2|done#100#10,20#1#1",
    actual: "sync|settle|template:100|result:100:2|done#100#10,20#1#1",
  },
  {
    name: "sequence prefix",
    expression: "(tap('sequence', value), await pending)",
    mutate: "value = 100;",
    staged: "tap('sequence', value); const result = await pending;",
    expected: "sequence:1|sync|settle|result:2|done#100#10,20#1#1",
    actual: "sync|settle|sequence:100|result:2|done#100#10,20#1#1",
  },
  {
    name: "logical and decision",
    expression: "condition && await pending",
    mutate: "condition = false;",
    staged: "const selected = condition; const result = selected && await pending;",
    expected: "sync|settle|result:2|done#1#10,20#1#1",
    actual: "sync|settle|result:false|done#1#10,20#1#1",
  },
  {
    name: "logical or decision",
    expression: "empty || await pending",
    mutate: "empty = 100;",
    staged: "const selected = empty; const result = selected || await pending;",
    expected: "sync|settle|result:2|done#1#10,20#1#1",
    actual: "sync|settle|result:100|done#1#10,20#1#1",
  },
  {
    name: "nullish decision",
    expression: "nullable ?? await pending",
    mutate: "nullable = 100;",
    staged: "const selected = nullable; const result = selected ?? await pending;",
    expected: "sync|settle|result:2|done#1#10,20#1#1",
    actual: "sync|settle|result:100|done#1#10,20#1#1",
  },
  {
    name: "conditional decision",
    expression: "condition ? await pending : 100",
    mutate: "condition = false;",
    staged: "const selected = condition; const result = selected ? await pending : 100;",
    expected: "sync|settle|result:2|done#1#10,20#1#1",
    actual: "sync|settle|result:100|done#1#10,20#1#1",
  },
  {
    name: "method lookup and receiver",
    expression: "receiver.method(await pending)",
    mutate: "receiver = { value: 100, method(result) { return this.value + result + 1000; } };",
    staged:
      "const target = receiver; const callee = target.method; const settled = await pending; const result = callee.call(target, settled);",
    expected: "sync|settle|result:3|done#1#10,20#1#100",
    actual: "sync|settle|result:1102|done#1#10,20#1#100",
  },
  {
    name: "getter before suspension",
    expression: "accessor.value + await pending",
    mutate: "value = 100;",
    staged:
      "const previous = accessor.value; const settled = await pending; const result = previous + settled;",
    expected: "get|sync|settle|result:3|done#100#10,20#1#1",
    actual: "sync|settle|get|result:102|done#100#10,20#1#1",
  },
];

const createReferenceCase = (testCase: AwaitReferenceCase, source: string): DifferentialCase => ({
  name: testCase.name,
  body: `
    const trace = [];
    let value = 1, index = 0, condition = true, empty = 0, nullable = null;
    const items = [10, 20];
    let receiver = { value: 1, method(result) { return this.value + result; } };
    const original = receiver;
    const accessor = { get value() { trace.push('get'); return value; } };
    const tap = (name, result) => { trace.push(name + ':' + result); return result; };
    const collect = (...values) => values.join(',');
    let settle;
    const pending = new Promise((resolve) => { settle = resolve; });
    const run = async () => { ${source} trace.push('result:' + result); };
    run().then(() => trace.push('done'), (error) => trace.push('error:' + error));
    trace.push('sync');
    queueMicrotask(() => { ${testCase.mutate} trace.push('settle'); settle(2); });
    return () => trace.join('|') + '#' + value + '#' + items.join(',') + '#' + original.value + '#' + receiver.value;
  `,
});

describe.each(cases)("await reference: $name", (testCase) => {
  it("known divergence: replays the captured prefix after suspension", () =>
    checkKnownDifferentialWitnesses(
      [
        {
          ...createReferenceCase(testCase, `const result = ${testCase.expression};`),
          expected: testCase.expected,
          actual: JSON.stringify(testCase.actual),
        },
      ],
      true,
    ));
  it("matches native when intermediate references and values are explicitly staged", () =>
    checkDifferentialCases([createReferenceCase(testCase, testCase.staged)], true));
});

it.each([
  {
    expression: "(await first) + (await second)",
    expected: "sync|A:3|B:30",
    actual: "sync|A:12|B:30",
  },
  {
    expression: "[await first, await second].join(':')",
    expected: "sync|A:1:2|B:10:20",
    actual: "sync|A:10:2|B:10:20",
  },
])(
  "known divergence: concurrent invocations exchange intermediate values in $expression",
  ({ expression, expected, actual }) =>
    checkKnownDifferentialWitnesses(
      [
        {
          name: expression,
          expected,
          actual: JSON.stringify(actual),
          body: `
    const trace = [];
    const run = async (name, first, second) => { const value = ${expression}; trace.push(name + ':' + value); };
    run('A', Promise.resolve(1), Promise.resolve(2)).catch((error) => trace.push('error:' + error));
    run('B', Promise.resolve(10), Promise.resolve(20)).catch((error) => trace.push('error:' + error));
    trace.push('sync');
    return () => trace.join('|');
  `,
        },
      ],
      true,
    ),
);

it("known divergence: an unconsumed await outcome leaks into a later sequential call", () =>
  checkKnownDifferentialWitnesses(
    [
      {
        name: "stale sequential await",
        expected: "first:1|second:2",
        actual: JSON.stringify("first:false|second:1"),
        body: `
    const trace = [];
    let enabled = true;
    let settle;
    const pending = new Promise((resolve) => { settle = resolve; });
    const run = async (value) => { return enabled && await value; };
    run(pending).then((value) => { trace.push('first:' + value); enabled = true; return run(Promise.resolve(2)); })
      .then((value) => trace.push('second:' + value), (error) => trace.push('error:' + error));
    queueMicrotask(() => { enabled = false; settle(1); });
    return () => trace.join('|');
  `,
      },
    ],
    true,
  ));
