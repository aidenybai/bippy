import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  checkSymbolicCases,
} from "./helpers/differential-evaluator.js";

interface CompletionAction {
  name: string;
  source: string;
}

const actions: CompletionAction[] = [
  { name: "normal", source: "" },
  { name: "continue-inner", source: "continue inner;" },
  { name: "break-inner", source: "break inner;" },
  { name: "continue-outer", source: "continue outer;" },
  { name: "break-outer", source: "break outer;" },
  { name: "return", source: "return 'body';" },
  { name: "throw", source: "throw 'body';" },
];
const finalizers: CompletionAction[] = [
  { name: "normal", source: "" },
  { name: "continue-outer", source: "continue outer;" },
  { name: "break-outer", source: "break outer;" },
  { name: "return", source: "return 'finally';" },
  { name: "throw", source: "throw 'finally';" },
];

const getExpectedTrace = (
  action: CompletionAction,
  finalizer: CompletionAction,
  trigger: number,
): string => {
  const trace: string[] = [];
  let position = 0;
  while (position < 9) {
    const row = Math.floor(position / 3);
    trace.push(`enter:${position}`, `finally:${position}`);
    const effective =
      position === trigger ? (finalizer.name === "normal" ? action : finalizer) : actions[0];
    if (effective.name === "return" || effective.name === "throw") {
      const result = effective === finalizer ? "finally" : "body";
      return `${effective.name === "throw" ? "caught:" : ""}${result}#${trace.join("|")}`;
    }
    if (effective.name === "break-outer") return `end#${trace.join("|")}`;
    if (effective.name === "continue-outer" || effective.name === "break-inner") {
      if (effective.name === "break-inner") trace.push(`outer:${row}`);
      position = (row + 1) * 3;
      continue;
    }
    if (effective.name !== "continue-inner") trace.push(`tail:${position}`);
    position++;
    if (position % 3 === 0) trace.push(`outer:${row}`);
  }
  return `end#${trace.join("|")}`;
};

const matrix = actions.flatMap((action) =>
  finalizers.map((finalizer) => {
    const name = `${action.name}/${finalizer.name}`;
    const isKnown =
      finalizer.name === "continue-outer" ||
      (finalizer.name === "normal" && action.name.startsWith("continue-"));
    return {
      action,
      finalizer,
      name,
      isKnown,
      label: `${isKnown ? "known divergence: " : ""}${name}`,
    };
  }),
);

it.each(matrix)("$label", ({ action, finalizer, name, isKnown }) => {
  const cases = [0, 4, 8].map((trigger) => ({
    expected: getExpectedTrace(action, finalizer, trigger),
    actual: "<string: + on dynamic values>",
    name: `${name}/trigger=${trigger}`,
    body: `
      const trace = [];
      const run = () => {
        outer: for (const outerValue of [0, 1, 2]) {
          inner: for (const innerValue of [0, 1, 2]) {
            const position = outerValue * 3 + innerValue;
            trace.push('enter:' + position);
            try { if (position === ${trigger}) { ${action.source} } }
            finally { trace.push('finally:' + position); if (position === ${trigger}) { ${finalizer.source} } }
            trace.push('tail:' + position);
          }
          trace.push('outer:' + outerValue);
        }
        return 'end';
      };
      let result;
      try { result = run(); } catch (error) { result = 'caught:' + error; }
      return result + '#' + trace.join('|');
    `,
  }));
  for (const testCase of cases) {
    expect(
      runInNewContext(`"use strict"; (() => { ${testCase.body} })()`, {}, { timeout: 1000 }),
      testCase.name,
    ).toBe(testCase.expected);
  }
  return isKnown ? checkKnownDifferentialWitnesses(cases) : checkDifferentialCases(cases);
});

it.each([
  {
    name: "labeled block break runs intervening finally",
    body: `const trace = []; block: { try { trace.push('body'); break block; } finally { trace.push('finally'); } trace.push('unreachable'); } trace.push('after'); return trace.join('|');`,
  },
  {
    name: "conditional labeled block break keeps the skipped path's writes",
    body: `const trace = []; const force = () => 0; for (const value of [false, true]) { block: { if (value) break block; trace.push('rest:' + value); } trace.push('after:' + value); } return trace.join('|');`,
  },
  {
    name: "for-of breaks out to an enclosing label",
    body: `let trace = ''; const force = () => 0; outer: { for (const item of [1, 2, 3]) { if (item === 2) break outer; trace += item; } trace += 'a'; } return trace + '!';`,
  },
  {
    name: "labeled loop breaks its own label",
    body: `let trace = ''; const force = () => 0; loop: for (const item of [1, 2, 3]) { if (item === 2) break loop; trace += item; } return trace + '!';`,
  },
  {
    name: "labeled switch break skips the rest of the case",
    body: `let trace = ''; const force = () => 0; for (const value of [false, true]) { choice: switch (1) { case 1: if (value) break choice; trace += 'a'; } trace += '!'; } return trace;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "nested labeled breaks to different targets",
    body: `let trace = ''; const force = () => 0; outer: { inner: { if (first) break outer; trace += 'a'; break inner; } trace += 'b'; } return trace + '!';`,
  },
  {
    name: "independent inputs break to inner and outer labels",
    body: `let trace = ''; const force = () => 0; outer: { inner: { if (first) break inner; if (second) break outer; trace += 'a'; } trace += 'b'; } return trace + '!';`,
  },
  {
    name: "unbounded loop breaks out to an enclosing label",
    body: `let trace = ''; const force = () => 0; outer: { while (true) { if (first) break outer; break; } trace += 'a'; } return trace + '!';`,
  },
  {
    name: "uncertain loop tail keeps a break to an enclosing label",
    body: `let trace = ''; const force = () => 0; const limit = first ? 400 : 1; outer: { for (let index = 0; index < limit; index++) { if (second) break outer; } trace += 'a'; } return trace + '!';`,
  },
  {
    name: "labeled block keeps a return apart from its break",
    body: `let trace = ''; const force = () => 0; label0: { if (first) { trace += 'x'; break label0; } if (second) return trace + '?'; trace += 'a'; } return trace + '!';`,
  },
])("preserves $name for each input assignment", (testCase) => checkSymbolicCases([testCase]));

it.each([
  {
    name: "switch break does not consume a labeled outer continue",
    expected: "0|tail|2|tail",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; outer: for (const value of [0, 1, 2]) { switch (value) { case 1: continue outer; default: trace.push(value); } trace.push('tail'); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
