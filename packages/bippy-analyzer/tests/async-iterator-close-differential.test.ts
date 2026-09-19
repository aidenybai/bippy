import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const cases = ["sync", "async"].flatMap((kind) =>
  ["break", "throw", "return"].flatMap((completion) =>
    ["object", "throw", "primitive"].map((close) => ({
      name: `${kind}/${completion}/${close}`,
      expected:
        "iterator|next|sync|item:7|close|" +
        (completion === "throw"
          ? "error:body"
          : close === "throw"
            ? "error:cleanup"
            : close === "primitive"
              ? "error:TypeError"
              : completion === "return"
                ? "ok:early"
                : "ok:end"),
      actual:
        kind === "async"
          ? "<string: join of a list with an unknown length>"
          : JSON.stringify(
              "iterator|next|next|next|item:7|sync|" +
                (completion === "throw"
                  ? "error:body"
                  : completion === "return"
                    ? "ok:early"
                    : "ok:end"),
            ),
      body: `
    const trace = [];
    let position = 0;
    const iterator = {
      next() { trace.push('next'); return { value: 7, done: position++ >= 2 }; },
      return() { trace.push('close'); ${close === "throw" ? "throw 'cleanup';" : close === "primitive" ? "return 1;" : "return { done: true };"} }
    };
    const iterable = { [Symbol.${kind === "sync" ? "iterator" : "asyncIterator"}]() { trace.push('iterator'); return iterator; } };
    const run = async () => {
      for await (const value of iterable) { trace.push('item:' + value); ${completion === "break" ? "break;" : completion === "throw" ? "throw 'body';" : "return 'early';"} }
      return 'end';
    };
    run().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + (typeof error === 'string' ? error : error.name)));
    trace.push('sync');
    return () => trace.join('|');
  `,
    })),
  ),
);

it.each(cases)("known divergence: mixed iterator close completion: $name", (testCase) =>
  checkKnownDifferentialWitnesses([testCase], true),
);

it.each([
  {
    name: "async iterator values are not implicitly unwrapped",
    expected: "sync|object|done",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; let position = 0; const iterable = { [Symbol.asyncIterator]() { return { next() { return { done: position++ > 0, value: Promise.resolve(7) }; } }; } }; const run = async () => { for await (const value of iterable) trace.push(typeof value); }; run().then(() => trace.push('done'), (error) => trace.push(error.name)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "sync iterator promise values are implicitly unwrapped",
    expected: "sync|number|done",
    actual: JSON.stringify("object|sync|done"),
    body: `const trace = []; let position = 0; const iterable = { [Symbol.iterator]() { return { next() { return { done: position++ > 0, value: Promise.resolve(7) }; } }; } }; const run = async () => { for await (const value of iterable) trace.push(typeof value); }; run().then(() => trace.push('done'), (error) => trace.push(error.name)); trace.push('sync'); return () => trace.join('|');`,
  },
  {
    name: "async close is awaited before continuing",
    expected: "sync|7|close|closed|after|done",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; let finish; const closing = new Promise((resolve) => { finish = resolve; }); let position = 0; const iterable = { [Symbol.asyncIterator]() { return { next() { return { done: position++ > 1, value: 7 }; }, return() { trace.push('close'); queueMicrotask(() => { trace.push('closed'); finish({ done: true }); }); return closing; } }; } }; const run = async () => { for await (const value of iterable) { trace.push(value); break; } trace.push('after'); }; run().then(() => trace.push('done'), (error) => trace.push(error.name)); trace.push('sync'); return () => trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase], true));

it.each(["break", "throw", "return"])(
  "does not close an iterator when the loop is never entered: %s",
  (completion) =>
    checkDifferentialCases(
      [
        {
          name: `unentered async loop/${completion}`,
          body: `const trace = []; const iterable = { [Symbol.asyncIterator]() { trace.push('iterator'); return { next() { return { done: true }; }, return() { trace.push('close'); return { done: true }; } }; } }; const run = async () => { if (false) { for await (const value of iterable) { ${completion === "break" ? "break;" : completion === "throw" ? "throw 'body';" : "return 'early';"} } } return 'end'; }; run().then((value) => trace.push(value)); trace.push('sync'); return () => trace.join('|');`,
        },
      ],
      true,
    ),
);
