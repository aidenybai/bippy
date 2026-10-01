import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface IteratorFailure {
  phase: string;
  position: number;
}

interface IteratorConsumer {
  name: string;
  statement: string;
  completion?: string;
}

const consumers: IteratorConsumer[] = [
  { name: "array-spread", statement: "[...getSource()];" },
  { name: "call-spread", statement: "consume(...getSource());", completion: "call" },
  { name: "new-spread", statement: "new Constructor(...getSource());", completion: "construct" },
  {
    name: "rest-binding",
    statement: "const [...values] = getSource(); trace.push('rest');",
    completion: "rest",
  },
  {
    name: "array-from",
    statement: "Array.from(getSource()); trace.push('array');",
    completion: "array",
  },
  { name: "for-of", statement: "for (const value of getSource()) {}" },
  {
    name: "from-entries",
    statement: "Object.fromEntries(getSource()); trace.push('entries');",
    completion: "entries",
  },
  {
    name: "manual",
    statement:
      "const source = getSource(); const method = source[Symbol.iterator]; const active = method.call(source); const next = active.next; while (true) { const result = next.call(active); const isDone = result.done; if (isDone) break; const value = result.value; }",
  },
];
const failures: IteratorFailure[] = [
  ...["none", "source", "iterator-get", "iterator-call", "next-get"].map((phase) => ({
    phase,
    position: -1,
  })),
  ...["next", "done", "value"].flatMap((phase) =>
    [0, 1, 2].map((position) => ({ phase, position })),
  ),
];

const getExpectedTrace = (
  failure: IteratorFailure,
  completion?: string,
  doesCloseOnStepError = false,
): string => {
  const trace: string[] = [];
  for (const phase of ["source", "iterator-get", "iterator-call", "next-get"]) {
    trace.push(phase.replace("-", ":"));
    if (failure.phase === phase) return [...trace, "caught:true"].join("|");
  }
  for (let position = 0; position <= 2; position++) {
    for (const phase of ["next", "done", "value"]) {
      if (position === 2 && phase === "value") break;
      trace.push(`${phase}:${position}`);
      if (failure.phase === phase && failure.position === position) {
        if (doesCloseOnStepError) trace.push("return:get", "return:call");
        return [...trace, "caught:true"].join("|");
      }
    }
  }
  if (completion !== undefined) trace.push(completion);
  return [...trace, "after"].join("|");
};

const completeProtocol = getExpectedTrace({ phase: "none", position: -1 }).split("|").slice(0, -1);
const cases = consumers.flatMap((consumer) =>
  failures.map((failure) => {
    const name = `${consumer.name}/${failure.phase}/${failure.position}`;
    const expected = getExpectedTrace(
      failure,
      consumer.completion,
      consumer.name === "from-entries",
    );
    const isThrowing =
      failure.phase !== "none" && !(failure.phase === "value" && failure.position === 2);
    const isKnown =
      consumer.name !== "manual" &&
      isThrowing &&
      failure.phase !== "source" &&
      !(consumer.name === "array-from" && failure.phase === "iterator-get");
    const actualTrace =
      failure.phase === "value"
        ? [...completeProtocol]
        : getExpectedTrace(failure).split("|").slice(0, -1);
    if (
      failure.phase === "value" &&
      !["rest-binding", "for-of", "from-entries"].includes(consumer.name)
    )
      actualTrace.push("caught:true");
    else {
      if (consumer.completion !== undefined) actualTrace.push(consumer.completion);
      actualTrace.push("after");
    }
    return {
      name,
      label: `${isKnown ? "known divergence: " : ""}${name}`,
      expected,
      actual: JSON.stringify(actualTrace.join("|")),
      isKnown,
      body: `const trace = []; const token = {}; const terminalToken = {}; let position = 0; const check = (phase, index = -1) => { if (phase === ${JSON.stringify(failure.phase)} && index === ${failure.position}) throw token; }; const iterator = { get next() { trace.push('next:get'); check('next-get'); return () => { const current = position++; trace.push('next:' + current); check('next', current); return { get done() { trace.push('done:' + current); check('done', current); return current >= 2; }, get value() { trace.push('value:' + current); check('value', current); if (current >= 2) throw terminalToken; return [current, current]; } }; }; }, get return() { trace.push('return:get'); return () => { trace.push('return:call'); return {}; }; } }; const iterable = { get [Symbol.iterator]() { trace.push('iterator:get'); check('iterator-get'); return () => { trace.push('iterator:call'); check('iterator-call'); return iterator; }; } }; const getSource = () => { trace.push('source'); check('source'); return iterable; }; const consume = () => { trace.push('call'); }; class Constructor { constructor() { trace.push('construct'); } } try { ${consumer.statement} trace.push('after'); } catch (error) { trace.push('caught:' + Object.is(error, token)); } return trace.join('|');`,
    };
  }),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isKnown }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (isKnown) await checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
  else await checkDifferentialCases([{ name, body }]);
});
