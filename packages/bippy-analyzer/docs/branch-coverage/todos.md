# TODOs

Working log for the coverage module (`src/branch-coverage`). The mission: let an agent build a
test suite that spans the whole project, a faithful cast of the app in tests. The
tool turns a coverage run into a ranked worklist of the next test to write.

## Done

### Signals (what we measure)

- [x] Line / branch / function coverage, remapped from the served bundle onto `src`
- [x] Control-flow depth: guard-nesting reached vs. max, depth-weighted branch coverage, deep-block coverage
- [x] Half-covered-branch worklist (reached decision, untaken arm)
- [x] Interaction (pairwise combinatorial) coverage, with provably-infeasible combos pruned (SSA + path feasibility)
- [x] Edge-case worklist synthesized from condition ASTs (relational boundaries, `??` / optional-chain nullish)
- [x] Mutation manifest: operator mutants a faithful test should kill (`>`→`>=`, `===`→`!==`, `&&`→`||`), coverage-aware
- [x] Unified worklist: all signals merged into one priority-ranked queue with stable ids and concrete actions
- [x] Per-file "Signals" column (deepest guard + gap/edge/mutant counts) on the istanbul-shaped table
- [x] Istanbul / lcov / HTML output via `--reports` (the report engine wraps istanbul's reporters)

### Accuracy (every change adversarially verified, soundness-first)

- [x] Honest optional-chain arm execution: `?.` present/nullish arms probe the continuation's own count, not the borrowed merge hit (a deep-audit soundness bug; 236 chains in the monorepo were reading 100% covered)
- [x] Distinct switch-case arm labels: each untaken `case` survives the worklist dedupe instead of all collapsing to "B" and being silently dropped (a deep-audit unsound hide)

- [x] Honest expression-arm execution (ternary/`&&`/`||` arms probe their own span, not the borrowed merge hit)
- [x] Infinite-loop depth via virtual post-dominator exits (`while (true)` no longer collapses nested depth to 0)
- [x] `maxDepth` folds expression-arm depth; `depthReached` does too, but only on honest execution
- [x] Dead-code exclusion: constant-guard dead arms and dead-reachable blocks never count or surface as gaps
- [x] Nearest-mapped-token source resolution (deep gaps stop landing in bundle coordinates), with a third-party guard
- [x] `toMetric(0, 0)` is 100% (branchless files aren't "0% covered")
- [x] `--top` ranks by uncovered line count, not raw percentage

### Defaults and ergonomics

- [x] Depth, interactions, infeasible-prune, and the mutation manifest are all on by default
- [x] CLI opt-outs: `--no-depth`, `--no-interactions`, `--no-prune-infeasible`, `--no-mutations`
- [x] `--json` always carries every signal incl. the worklist; the human table is the lead "Next tests" view
- [x] README (usage) + ARCHITECTURE (deep dive) + `examples/signal-example.{md,json}`

## Definitely next

### 1. Close the verification loop (Stryker bridge) — the capstone

The mutation manifest _predicts_ survivors; it does not _prove_ them. Wire it to an
actual run so survivors are real.

- [x] Export the manifest as a mutation plan (`buildMutationPlan` / `--mutation-plan`): Stryker `mutationRange` lines + implied mutators + the ranked target manifest, scoped to the reached, depth-ranked decisions so a browser-suite run is tractable
- [x] Re-ingest survivors: `parseStrykerSurvivors` + `matchSurvivors` (`--stryker-report`) match a Stryker report's survivors back to the manifest as proven assertion gaps
- [ ] Document/automate feeding coverage so Stryker skips uncovered code (guaranteed survivors)

### 1b. Runtime mutation testing (the substrate at the Playwright layer) — spiked

Source mutation rebuilds per mutant, which is impractical for a browser suite.
Applying the _same substrate_ at runtime amortizes the build: instrument once,
toggle a mutant per run.

- [x] Spike: `instrumentForMutation` wraps `if`/`while`/`do-while` tests in a `__mutCond(id, value)` gate (driven by the CFG); `MUTATION_GATE` is the runtime; force-true/false mutants per decision. Proven in `tests/mutation-runtime.test.ts` — force-false killed, force-true survives the unasserted branch
- [ ] Playwright fixture: set `globalThis.__MUTANT` per worker via `page.addInitScript`, run only the specs that cover the decision (needs test attribution, #4), record kill/survive
- [ ] Extend instrumentation from statement tests to expression branches (ternary/`&&`/`||`) via an AST codegen pass (span splice can't handle nested spans)
- [ ] Operator-level runtime mutants (not only force-true/false), matching the manifest's `> → >=` etc.
- [ ] Wire the instrumentation into the coverage build (Vite/oxc transform) behind a flag

### 2. Measure the value axis (targeted instrumentation)

Edge cases are currently _synthesized_ from the AST, not _measured_. V8 coverage is
value-blind; the only way to know a boundary value actually ran is instrumentation.

- [ ] A Vite/oxc transform that inserts value probes only at the decisions we rank highest (the CFG tells it where, so overhead stays low)
- [ ] Opt-in second capture mode, never perturbs the default passive V8 run (Heisenberg)
- [ ] Turns boundary coverage from "you should test `count = 10`" into "you did / didn't test `count = 10`"

### 3. Loop iteration coverage (the quantity axis / stress)

- [ ] Report loops entered but never iterated more than once (0/1/many boundary). Needs a per-test pass like interactions; merged counts alone can't separate one-test-many-iterations from many-tests-one-iteration. Design the sound signal before building.

### 4. Run-to-run delta (close the agent loop)

- [x] `diffWorklist` + `--baseline <file>`: report "closed N, opened M, K carried" against a prior `--json` run, using the stable ids
- [ ] Test attribution: tag each raw dump with its test name in `capturePlaywrightCoverage`, so a gap can say "extend `copy.spec.ts`" instead of only naming the line.

### 5. Combinatorial depth

- [ ] Selective 3-way interaction coverage on the deepest decision clusters (pairwise misses triple-interactions; full t-way explodes, so gate on depth + cap).

## Known limitations (documented, mostly inherent)

- [ ] **Value-blind**: boundary/null coverage is synthesized, not measured (see next-step 2).
- [ ] **No path coverage**: merged counts lose per-test path identity, so we measure depth + pairwise, not full paths.
- [ ] **Mixed-build dumps**: a `rawDir` holding several builds leaves content-hashed twin chunks counted separately. Capture into a clean dir (`cleanRawCoverage`). A sound display-collapse (warn + dedupe rows by source set, without merging ranges) would help. Low priority.
- [ ] **Optional-chain arm precision**: `armProbe` is exact for ternary/logical; optional-chain arms still fall back to the representative offset.
- [ ] **ASCII-offset assumption**: V8 and oxc offsets are treated as interchangeable; non-ASCII source before a decision can skew a point query slightly. Acceptable for a diagnostic.
- [ ] **Per-file Signals join**: rolls up the (capped) worklist, so counts reflect surfaced items, not file totals; joins report and worklist paths by full path then basename.

## From the deep audit (open)

- [ ] **Twin-chunk double-count** (soundness on aggregates): content-hashed twins in a mixed-build `rawDir` double-count depth aggregates and duplicate worklist items. Sound fix: warn + collapse the display by source-set without merging ranges. Workaround today: capture into a clean dir.
- [ ] **Worklist double-surface**: the same uncovered arm can appear as both a `deep-gap` and a `branch` item (with the deep-gap sometimes out-ranking the precise branch), and one guard can fan out to four stacked items at one `file:line`. Dedupe the worklist by location, keeping the most actionable kind.
- [ ] **createOffsetMapper adjacent-line fallback**: when a decision's generated line is fully unmapped, search nearby generated lines (±1, ±2) before dropping to bundle coordinates.
- [ ] **node_modules-as-bundle-coords leak**: an inlined dependency decision whose location is undefined passes the first-party filter and leaks into the worklist as bundle coordinates.
- [ ] **Switch case labels** show the case index (`case 1`), not the case value; pin the gap to the case line, not the `switch` keyword line. (Distinct labels already fixed the soundness hide.)
- [ ] **Labeled break/continue depth** inflates maxDepth by +1 versus plain break/continue; reconcile.

## House-keeping

- [ ] Surface "loaded but never executed" files (0% lines, present in the report) as a distinct class, not merely the bottom of the `--top` list.
- [ ] Consider committing a real `examples/react-grab-signal.md` (regenerated from a fresh single-build capture so no twin chunks).
