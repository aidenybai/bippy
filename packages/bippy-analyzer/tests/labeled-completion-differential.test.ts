import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
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
      finalizer.name.endsWith("-outer") ||
      (finalizer.name === "normal" &&
        (action.name.startsWith("break-") || action.name.startsWith("continue-")));
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
    actual:
      action.name === "return"
        ? "branch(<string> | <string>)"
        : action.name === "throw"
          ? "branch(<string> | <string> | <string>)"
          : "<string: + on dynamic values>",
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
    expected: "body|finally|after",
    actual: "undefined",
    body: `const trace = []; block: { try { trace.push('body'); break block; } finally { trace.push('finally'); } trace.push('unreachable'); } trace.push('after'); return trace.join('|');`,
  },
  {
    name: "switch break does not consume a labeled outer continue",
    expected: "0|tail|2|tail",
    actual: "<string: join of a list with an unknown length>",
    body: `const trace = []; outer: for (const value of [0, 1, 2]) { switch (value) { case 1: continue outer; default: trace.push(value); } trace.push('tail'); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
