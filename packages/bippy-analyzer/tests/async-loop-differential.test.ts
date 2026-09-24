import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface AsyncLoopCase {
  name: string;
  source: string;
  expected: string;
  actual: string;
}

const serialTrace = "before:0|sync|after:0|before:1|after:1|before:2|after:2|end|ok:done";
const synchronousTrace = "before:0|after:0|before:1|after:1|before:2|after:2|end|sync|ok:done";
const cases: AsyncLoopCase[] = [
  {
    name: "for-of body suspension",
    source:
      "for (const value of [0, 1, 2]) { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); }",
    expected: serialTrace,
    actual: synchronousTrace,
  },
  {
    name: "for body suspension",
    source:
      "for (let index = 0; index < 3; index++) { trace.push('before:' + index); await Promise.resolve(); trace.push('after:' + index); }",
    expected: serialTrace,
    actual: synchronousTrace,
  },
  {
    name: "while body suspension",
    source:
      "let index = 0; while (index < 3) { const value = index++; trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); }",
    expected: serialTrace,
    actual: synchronousTrace,
  },
  {
    name: "do-while body suspension",
    source:
      "let index = 0; do { const value = index++; trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); } while (index < 3);",
    expected: serialTrace,
    actual: synchronousTrace,
  },
  {
    name: "break after suspension",
    source:
      "for (const value of [0, 1, 2]) { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); break; }",
    expected: "before:0|sync|after:0|end|ok:done",
    actual: "before:0|after:0|end|sync|ok:done",
  },
  {
    name: "return after suspension",
    source:
      "for (const value of [0, 1, 2]) { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); return value; }",
    expected: "before:0|sync|after:0|ok:0",
    actual: "before:0|after:0|sync|ok:0",
  },
  {
    name: "throw after suspension",
    source:
      "for (const value of [0, 1, 2]) { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); throw 'stop'; }",
    expected: "before:0|sync|after:0|error:stop",
    actual: "before:0|after:0|sync|error:stop",
  },
  {
    name: "for-await primitive values",
    source: "for await (const value of [1, 2]) { trace.push('item:' + value); }",
    expected: "sync|item:1|item:2|end|ok:done",
    actual: "item:1|item:2|end|sync|ok:done",
  },
  {
    name: "for-await promise values",
    source:
      "for await (const value of [Promise.resolve(1), Promise.resolve(2)]) { trace.push('item:' + value); }",
    expected: "sync|item:1|item:2|end|ok:done",
    actual: "item:[object Promise]|item:[object Promise]|end|sync|ok:done",
  },
  {
    name: "for-await closes a synchronous iterator",
    source:
      "let position = 0; const iterable = { [Symbol.iterator]: () => ({ next: () => { trace.push('next'); return position++ < 2 ? { done: false, value: Promise.resolve(position) } : { done: true }; }, return: () => { trace.push('close'); return {}; } }) }; for await (const value of iterable) { trace.push('item:' + value); break; }",
    expected: "next|sync|item:1|close|end|ok:done",
    actual: "next|next|next|item:[object Promise]|end|sync|ok:done",
  },
];

describe.each(cases)("async loop: $name", ({ name, source, expected, actual }) => {
  it("known divergence: preserves the native suspension trace", () =>
    checkKnownDifferentialWitnesses(
      [
        {
          name,
          expected,
          actual: JSON.stringify(actual),
          body: `const trace = []; const run = async () => { ${source} trace.push('end'); return 'done'; }; run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
        },
      ],
      true,
    ));
});

it.each(["forEach", "filter", "some", "every", "find", "findIndex"])(
  "matches native %s with async callbacks without awaiting their truthy promises",
  (method) =>
    checkDifferentialCases(
      [
        {
          name: method,
          body: `
    const trace = [];
    const visit = async (value) => { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); return false; };
    const result = [1, 2, 3].${method}(visit);
    trace.push('result:' + (Array.isArray(result) ? result.join(',') : result));
    trace.push('sync');
    return () => trace.join('|');
  `,
        },
      ],
      true,
    ),
);

it("matches native parallel async map followed by Promise.all", () =>
  checkDifferentialCases(
    [
      {
        name: "parallel map",
        body: `
    const trace = [];
    const promises = [1, 2, 3].map(async (value) => { trace.push('before:' + value); await Promise.resolve(); trace.push('after:' + value); return value * 2; });
    Promise.all(promises).then((values) => trace.push('result:' + values.join(',')), (error) => trace.push('error:' + error));
    trace.push('sync');
    return () => trace.join('|');
  `,
      },
    ],
    true,
  ));

it.each(["reduce", "reduceRight"])(
  "matches native serial promise accumulation through %s",
  (method) =>
    checkDifferentialCases(
      [
        {
          name: method,
          body: `
    const trace = [];
    [1, 2, 3].${method}(async (previous, value) => { trace.push('before:' + value); const total = await previous; trace.push('after:' + value); return total + value; }, 0)
      .then((value) => trace.push('result:' + value), (error) => trace.push('error:' + error));
    trace.push('sync');
    return () => trace.join('|');
  `,
        },
      ],
      true,
    ),
);
