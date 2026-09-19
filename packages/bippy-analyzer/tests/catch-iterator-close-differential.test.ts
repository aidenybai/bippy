import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface CatchPattern {
  name: string;
  source: string;
  count: number;
  isRest: boolean;
  isThrowing: boolean;
}

const patterns: CatchPattern[] = [
  { name: "empty", source: "[]", count: 0, isRest: false, isThrowing: false },
  { name: "one", source: "[value]", count: 1, isRest: false, isThrowing: false },
  { name: "two", source: "[firstValue, secondValue]", count: 2, isRest: false, isThrowing: false },
  { name: "rest", source: "[...values]", count: 0, isRest: true, isThrowing: false },
  { name: "first-rest", source: "[value, ...values]", count: 1, isRest: true, isThrowing: false },
  {
    name: "throwing-default",
    source: "[value = fail()]",
    count: 1,
    isRest: false,
    isThrowing: true,
  },
];
const closeModes = ["missing", "object", "primitive", "getter-throws", "method-throws"];

const getReturnGetter = (closeMode: string): string =>
  `get return() { trace.push('close-get'); ${closeMode === "getter-throws" ? "throw 'lookup';" : closeMode === "missing" ? "return undefined;" : `return () => { trace.push('close-call'); ${closeMode === "method-throws" ? "throw 'close';" : `return ${closeMode === "primitive" ? "7" : "{}"};`} };`} }`;

const cases = patterns.flatMap((pattern) =>
  [0, 1, 2].flatMap((length) =>
    closeModes.map((closeMode) => {
      const isExhausted = pattern.isRest || pattern.count > length;
      const trace = ["open"];
      const steps = pattern.isRest ? length + 1 : Math.min(pattern.count, length + 1);
      for (let index = 0; index < steps; index++) trace.push("next:" + index);
      let error = pattern.isThrowing ? "binding" : null;
      if (pattern.isThrowing) trace.push("default");
      if (!isExhausted) {
        trace.push("close-get");
        if (closeMode === "getter-throws") error ??= "lookup";
        else if (closeMode !== "missing") {
          trace.push("close-call");
          if (closeMode === "primitive") error ??= "TypeError";
          if (closeMode === "method-throws") error ??= "close";
        }
      }
      if (error === null) trace.push("body");
      trace.push("finally");
      if (error !== null) trace.push("outer:" + error);
      const name = `${pattern.name}/length=${length}/close=${closeMode}`;
      const isKnown = !isExhausted || pattern.isThrowing;
      const actualTrace = [
        "open",
        ...Array.from({ length: length + 1 }, (_value, index) => "next:" + index),
      ];
      if (pattern.isThrowing) actualTrace.push("default");
      actualTrace.push("body", "finally");
      return {
        name,
        label: `${isKnown ? "known divergence: " : ""}${name}`,
        isKnown,
        actual: JSON.stringify(actualTrace.join("|")),
        expected: trace.join("|"),
        body: `const trace = []; let position = 0;
      const iterable = {
        [Symbol.iterator]() { trace.push('open'); return this; },
        next() { const index = position++; trace.push('next:' + index); return index < ${length} ? { value: undefined, done: false } : { done: true }; },
        ${getReturnGetter(closeMode)}
      };
      const fail = () => { trace.push('default'); throw 'binding'; };
      try { try { throw iterable; } catch (${pattern.source}) { trace.push('body'); } finally { trace.push('finally'); } } catch (error) { trace.push('outer:' + (typeof error === 'string' ? error : error.name)); }
      return trace.join('|');`,
      };
    }),
  ),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isKnown }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (isKnown) await checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
  else await checkDifferentialCases([{ name, body }]);
});

it.each(closeModes)("preserves explicit return lookup and invocation for %s", (closeMode) =>
  checkDifferentialCases([
    {
      name: `explicit/${closeMode}`,
      body: `const trace = []; const iterator = { ${getReturnGetter(closeMode)} }; try { const close = iterator.return; if (close !== undefined) close(); trace.push('after'); } catch (error) { trace.push('outer:' + error); } return trace.join('|');`,
    },
  ]),
);
