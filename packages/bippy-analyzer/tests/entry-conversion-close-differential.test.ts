import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface EntryShape {
  name: string;
  source: string;
  failures: string[];
}

const failures = [
  "none",
  "key-get",
  "value-get",
  "primitive-get",
  "primitive-call",
  "primitive-object",
];
const closingModes = [
  "missing",
  "null",
  "noncallable",
  "object",
  "primitive",
  "getter-throws",
  "method-throws",
];
const shapes: EntryShape[] = [
  { name: "getter-object", source: "getterPair", failures },
  {
    name: "array",
    source: "[key, 7]",
    failures: failures.filter((failure) => failure !== "key-get" && failure !== "value-get"),
  },
];

const getPrelude = (failure: string): string =>
  `const trace = []; const token = {}; const closeToken = {}; const check = (phase) => { if (phase === ${JSON.stringify(failure)}) throw token; }; const key = { get [Symbol.toPrimitive]() { trace.push('primitive:get'); check('primitive-get'); return operations.convert; } }; const operations = { convert(hint) { trace.push('primitive:call:' + hint + ':' + (this === key)); check('primitive-call'); return ${failure === "primitive-object" ? "{}" : "'entry'"}; } }; const getterPair = { get 0() { trace.push('key:get'); check('key-get'); return key; }, get 1() { trace.push('value:get'); check('value-get'); return 7; } };`;
const getClosingBody = (mode: string): string => {
  if (mode === "getter-throws") return "throw closeToken;";
  if (mode === "missing" || mode === "null" || mode === "noncallable")
    return `return ${mode === "missing" ? "undefined" : mode === "null" ? "null" : "7"};`;
  return `return () => { trace.push('close:call'); ${mode === "method-throws" ? "throw closeToken;" : `return ${mode === "primitive" ? "7" : "{}"};`} };`;
};
const getExpectedTrace = (shape: EntryShape, failure: string, closing: string): string => {
  const trace = ["open", "next:0"];
  const phases = [
    ...(shape.name === "getter-object" ? ["key-get", "value-get"] : []),
    "primitive-get",
    "primitive-call",
  ];
  for (const phase of phases) {
    trace.push(phase === "primitive-call" ? "primitive:call:string:true" : phase.replace("-", ":"));
    if (phase === failure) break;
  }
  if (failure === "none") return [...trace, "next:1", "next:2", "after"].join("|");
  trace.push("close:get");
  if (closing === "object" || closing === "primitive" || closing === "method-throws")
    trace.push("close:call");
  return [...trace, failure === "primitive-object" ? "caught:TypeError" : "caught:entry"].join("|");
};

const cases = shapes.flatMap((shape) =>
  shape.failures.flatMap((failure) =>
    closingModes.map((closing) => ({
      name: `${shape.name}/${failure}/${closing}`,
      expected: getExpectedTrace(shape, failure, closing),
      body: `${getPrelude(failure)} const pair = ${shape.source}; let position = 0; const iterator = { next() { const current = position++; trace.push('next:' + current); return current === 0 ? { value: pair, done: false } : current === 1 ? { value: ['later', 9], done: false } : { done: true }; }, get return() { trace.push('close:get'); ${getClosingBody(closing)} } }; const iterable = { [Symbol.iterator]() { trace.push('open'); return iterator; } }; try { Object.fromEntries(iterable); trace.push('after'); } catch (error) { trace.push('caught:' + (error === token ? 'entry' : error === closeToken ? 'close' : error.name)); } return trace.join('|');`,
    })),
  ),
);

it.each(cases)(
  "known divergence: entry conversion and close $name",
  async ({ name, body, expected }) => {
    expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
      expected,
    );
    await checkKnownDifferentialWitnesses([
      { name, body, expected, actual: '"open|next:0|next:1|next:2|after"' },
    ]);
  },
);

it.each(failures)("preserves explicitly staged entry reads and raw conversion for %s", (failure) =>
  checkDifferentialCases([
    {
      name: `manual/${failure}`,
      body: `${getPrelude(failure)} try { const keyValue = getterPair[0]; const entryValue = getterPair[1]; const convert = keyValue[Symbol.toPrimitive]; const converted = convert.call(keyValue, 'string'); trace.push('raw:' + typeof converted + ':' + entryValue); } catch (error) { trace.push('caught:' + (error === token ? 'entry' : error.name)); } return trace.join('|');`,
    },
  ]),
);
