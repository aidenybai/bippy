import { it } from "vite-plus/test";
import { checkGuardedCases } from "./helpers/differential-evaluator.js";
import { checkSsaAgainstNative } from "./helpers/ssa-evaluator.js";

interface CompletionCase {
  name: string;
  statement: string;
}

const completions: CompletionCase[] = [
  { name: "normal", statement: "value += 1;" },
  { name: "return", statement: "return trace + ':' + value;" },
  { name: "throw", statement: "throw trace + ':' + value;" },
  { name: "break", statement: "break outer;" },
  { name: "continue", statement: "continue outer;" },
];

const cases = completions.flatMap((attempt) =>
  completions.flatMap((handler) =>
    completions.flatMap((finalizer) =>
      completions.map((outerFinalizer) => ({
        name: `try=${attempt.name}/catch=${handler.name}/finally=${finalizer.name}/outer=${outerFinalizer.name}`,
        body: `
    let trace = ''; let value = 0;
    outer: for (let index = 0; index < 3; index++) {
      try {
        try { trace += 't'; if (first) { ${attempt.statement} } else value += 2; }
        catch (caught) { trace += 'c'; if (second) { ${handler.statement} } else value += 3; }
        finally { trace += 'f'; if (second) { ${finalizer.statement} } else value += 4; }
      } finally { trace += 'o'; if (first) { ${outerFinalizer.statement} } else value += 5; }
      trace += 'a';
    }
    return trace + ':' + value;
  `,
      })),
    ),
  ),
);

it.each(cases)("matches native abrupt completion precedence: $name", ({ body }) => {
  for (const first of [false, true])
    for (const second of [false, true]) checkSsaAgainstNative(body, { first, second });
});

it.each(cases)("preserves completion-to-input associations: $name", ({ name, body }) =>
  checkGuardedCases([{ name, body: `return (() => { ${body} })();` }]),
);

it.each(["void 0", "null", "false", "0", "-0", "0/0", "1n", "'original'"])(
  "preserves thrown payload through nested handled failures: %s",
  (payload) => {
    const body = `try { try { throw (${payload}); } finally { try { throw 'inner'; } catch {} } } catch (caught) { return caught; }`;
    checkSsaAgainstNative(body);
    checkSsaAgainstNative(body, {}, true);
  },
);

it.each(["return value;", "throw value;", "break outer;", "continue outer;"])(
  "unwinds only crossed finalizers for %s",
  (completion) => {
    const body = `let value=0; let trace=''; outer: for(let index=0;index<2;index++) { try { inner: for(let inner=0;inner<2;inner++) { try { value++; if(first) { ${completion} } else break inner; } finally { trace+='i'; } } trace+='a'; } finally { trace+='o'; } } return trace+':'+value;`;
    for (const first of [false, true]) checkSsaAgainstNative(body, { first });
  },
);
