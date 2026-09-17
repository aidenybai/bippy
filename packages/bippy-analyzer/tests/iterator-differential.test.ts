import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface IteratorConsumer {
  name: string;
  source: string;
}

const consumers: IteratorConsumer[] = [
  { name: "spread", source: "result = [...iterable].join(',');" },
  {
    name: "rest destructuring",
    source: "const [first, ...rest] = iterable; result = first + ':' + rest.join(',');",
  },
  {
    name: "full for-of",
    source: "for (const value of iterable) { trace += 'B' + value; } result = 'done';",
  },
  {
    name: "continue for-of",
    source: "for (const value of iterable) { trace += 'B' + value; continue; } result = 'done';",
  },
  {
    name: "break for-of",
    source: "for (const value of iterable) { trace += 'B' + value; break; } result = 'done';",
  },
  {
    name: "return from for-of",
    source:
      "const run = () => { for (const value of iterable) { trace += 'B' + value; return value; } }; result = run();",
  },
  {
    name: "throw from for-of",
    source: "for (const value of iterable) { trace += 'B' + value; throw 'body'; }",
  },
  { name: "one destructured item", source: "const [first] = iterable; result = first;" },
  { name: "empty destructuring", source: "const [] = iterable; result = 'empty';" },
  {
    name: "Array.from mapper",
    source:
      "result = Array.from(iterable, (value) => { trace += 'M' + value; return value * 2; }).join(',');",
  },
  {
    name: "throwing Array.from mapper",
    source: "result = Array.from(iterable, (value) => { trace += 'M' + value; throw 'mapper'; });",
  },
  {
    name: "argument spread",
    source:
      "const consume = (...values) => { trace += 'C'; return values.join(','); }; result = consume(...iterable);",
  },
];

const createIteratorCase = (consumer: IteratorConsumer, closing: string): DifferentialCase => ({
  name: `${consumer.name}/${closing}`,
  body: `
    let trace = '';
    let position = 0;
    const iterator = {
      next: () => {
        const current = position++;
        trace += 'N' + current;
        return {
          get done() { trace += 'D' + current; return current === 3; },
          get value() { trace += 'V' + current; return current; }
        };
      },
      return: () => { trace += 'R'; ${closing === "throws" ? "throw 'close';" : closing === "primitive" ? "return 0;" : "return {};"} }
    };
    const iterable = { [Symbol.iterator]: () => { trace += 'I'; return iterator; } };
    let result;
    try { ${consumer.source} }
    catch (error) { result = typeof error === 'string' ? error : error.name; }
    return String(result) + '|' + trace;
  `,
});

const knownConsumers = new Set([
  "full for-of",
  "continue for-of",
  "break for-of",
  "return from for-of",
  "throw from for-of",
  "one destructured item",
  "empty destructuring",
  "Array.from mapper",
  "throwing Array.from mapper",
]);
const closingConsumers = new Set([
  "break for-of",
  "return from for-of",
  "throw from for-of",
  "one destructured item",
  "empty destructuring",
  "throwing Array.from mapper",
]);

describe.each(consumers)("iterator consumer $name", (consumer) => {
  const isKnownDivergence = knownConsumers.has(consumer.name);
  const check = isKnownDivergence ? checkKnownDifferentialCases : checkDifferentialCases;
  it.each(closingConsumers.has(consumer.name) ? ["normal", "throws", "primitive"] : ["normal"])(
    `${isKnownDivergence ? "known divergence" : "matches native"}: closing mode %s`,
    (closing) => check([createIteratorCase(consumer, closing)]),
  );
});

it.each(["next", "done", "value"])(
  "known divergence: throwing %s stops iterator consumption",
  (failure) =>
    checkKnownDifferentialCases([
      {
        name: `throwing ${failure}`,
        body: `
      let trace = '';
      let position = 0;
      const fail = (phase) => { trace += phase; if (phase === '${failure}') throw phase; };
      const iterator = { next: () => {
        if (position++ > 2) return { done: true };
        fail('next');
        return { get done() { fail('done'); return false; }, get value() { fail('value'); return 1; } };
      }, return: () => { trace += 'return'; return {}; } };
      const iterable = { [Symbol.iterator]: () => iterator };
      try { [...iterable]; } catch (error) { trace += 'caught:' + error; }
      return trace;
    `,
      },
    ]),
);
