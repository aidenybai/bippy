import { lineOf, nodeEnd, nodeStart, prepareScript, testNodeOf } from "./cfg-shared.js";

// The substrate of mutation testing, applied at the *runtime* layer instead of
// by rebuilding the source per mutant. Each tracked decision's test is wrapped in
// a gate: normally it returns the real value, but when a matching mutant is
// active it forces the outcome. One instrumented build then runs every mutant by
// toggling a global, so an E2E suite can be mutation-tested without the
// rebuild-per-mutant cost that makes source mutation impractical for the browser.
//
// `__MUTANT` selects the active mutant (`t<id>` forces the decision true, `f<id>`
// forces it false); any other value is a passthrough, so the instrumented build
// is a no-op until a mutant is selected. In Playwright, set it per worker with
// `page.addInitScript("globalThis.__MUTANT = 'f3'")`, run the specs that cover
// that decision, and a still-passing suite means the mutant survived.
export const MUTATION_GATE =
  "globalThis.__mutCond=function(id,v){var m=globalThis.__MUTANT;" +
  'return m==="t"+id?true:m==="f"+id?false:v;};';

// One runtime mutant: a forced outcome for a tracked decision. Two are emitted
// per decision (force-true and force-false). A surviving mutant is a proven gap:
// the suite ran the decision but no assertion noticed the forced outcome.
export interface RuntimeMutant {
  /** `t<decision>` (force true) or `f<decision>` (force false); set as `__MUTANT`. */
  id: string;
  decision: number;
  force: boolean;
  line: number;
  condition: string;
}

export interface InstrumentedScript {
  /** Source with decision tests wrapped in `__mutCond(...)`; prepend `MUTATION_GATE`. */
  code: string;
  mutants: RuntimeMutant[];
}

// Statement decisions whose test is a single node with a clean, non-overlapping
// span, so a span splice is safe. Expression-level branches (ternary, `&&`/`||`)
// nest, so instrumenting them needs an AST codegen pass, not a splice; left out
// of the spike. `for`/`for-in`/`for-of` carry no test node and are skipped too.
const MUTABLE_KINDS = new Set(["if", "while", "do-while"]);

/**
 * Wrap each `if`/`while`/`do-while` test in the runtime mutation gate, using the
 * CFG to locate the decisions, and return the catalog of force-true/false
 * mutants. Best-effort: a parse failure yields the source unchanged and no
 * mutants. The mutants are scoped to real decisions (and can be filtered to the
 * reached, depth-ranked ones via the manifest), so a run stays targeted.
 */
export const instrumentForMutation = (script: string, source: string): InstrumentedScript => {
  const prepared = prepareScript(script, source);
  if (!prepared) return { code: source, mutants: [] };

  const seen = new Set<number>();
  const spans: Array<{ start: number; end: number }> = [];
  for (const fn of prepared.functions) {
    for (const block of fn.cfg.blocks) {
      if (!MUTABLE_KINDS.has(block.terminal.kind)) continue;
      const test = testNodeOf(block.terminal);
      if (!test) continue;
      const start = nodeStart(test);
      if (seen.has(start)) continue;
      seen.add(start);
      spans.push({ start, end: nodeEnd(test) });
    }
  }
  spans.sort((left, right) => left.start - right.start);

  const mutants: RuntimeMutant[] = [];
  spans.forEach((span, decision) => {
    const condition = source.slice(span.start, span.end);
    const line = lineOf(source, span.start);
    mutants.push({ id: `t${decision}`, decision, force: true, line, condition });
    mutants.push({ id: `f${decision}`, decision, force: false, line, condition });
  });

  // Splice from the end so earlier offsets stay valid; `decision` is the sorted
  // index, matching the id the gate compares against.
  let code = source;
  for (let decision = spans.length - 1; decision >= 0; decision--) {
    const { start, end } = spans[decision]!;
    code = `${code.slice(0, start)}__mutCond(${decision},(${source.slice(start, end)}))${code.slice(end)}`;
  }
  return { code, mutants };
};
