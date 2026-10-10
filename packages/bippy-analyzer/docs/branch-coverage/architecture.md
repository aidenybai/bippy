- [Architecture](#architecture)
  - [Design principles](#design-principles)
- [Pipeline overview](#pipeline-overview)
- [Stage 1: V8 capture](#stage-1-v8-capture)
- [Stage 2: merge and remap](#stage-2-merge-and-remap)
  - [Merge](#merge)
  - [Remap](#remap)
  - [Score](#score)
- [Stage 3: the control-flow-graph engine](#stage-3-the-control-flow-graph-engine)
  - [From AST to basic blocks](#from-ast-to-basic-blocks)
  - [The graph analyses](#the-graph-analyses)
- [Stage 4: depth analysis](#stage-4-depth-analysis)
  - [The depth algorithm](#the-depth-algorithm)
  - [Guard depth from control dependence](#guard-depth-from-control-dependence)
  - [Honest arm execution](#honest-arm-execution)
  - [Edge cases from condition structure](#edge-cases-from-condition-structure)
  - [Dead code never counts](#dead-code-never-counts)
- [Stage 5: interaction analysis](#stage-5-interaction-analysis)
- [A worked example](#a-worked-example)
- [Coordinate spaces](#coordinate-spaces)
- [How much of the engine is used](#how-much-of-the-engine-is-used)
- [Limitations](#limitations)
- [The benchmark harness](#the-benchmark-harness)

# Architecture

This document explains how the coverage module (`src/branch-coverage`) turns a Playwright and/or Vitest run into four coverage signals: line/branch/function coverage, control-flow depth, interaction coverage, and synthesized edge cases. Read it to change the pipeline, debug a wrong number, or understand why the package vendors a control-flow-graph engine.

The pipeline has two halves. The capture half runs inside Playwright Chromium workers (`capturePlaywrightCoverage`) or Vitest/Node workers (`setupVitestCoverage` / `captureNodeCoverage`) and writes one raw V8 dump per test. The report half runs once after the suite: it merges dumps from one or more directories, source-maps served bundles back to `src` (or accepts already-original Node sources), and runs a control-flow-graph engine to measure how deep and how combinatorially the tests exercised each script. The mission is to hand an agent a faithful mold of the app's control flow, cast in tests, so the goal of every signal below is a ranked worklist of the next test to write.

### Design principles

These hold across the package and are worth preserving as the code changes.

- **Best-effort everywhere**

  Capture, parsing, and reporting are all wrapped. A parse failure, a missing source map, or a report error yields less coverage, never a failed test or a red suite. Coverage is a diagnostic; it must never break the thing it measures.

- **Soundness over completeness**

  A worklist may omit a real gap, but it must never report a gap as covered or claim a test reached deeper than it did. Over-claiming hides work from the agent, which is the one failure the mission can't tolerate. Where a measurement is uncertain, the code under-credits rather than over-credits, and every accuracy change is checked against this rule.

- **Parse once, share**

  Depth and interactions run off a single parse and one set of post-dominator trees per script, plus one `TraceMap` per served path. The static analysis is the expensive part, so nothing recomputes it.

- **Lazy and gated**

  The heavy dependencies (monocart, the parser, the CFG engine) load only when their pass runs, so importing the capture fixture in a test worker never pulls them in. Non-coverage runs pay nothing.

- **Bounded memory**

  The merge folds each dump into a running accumulator and keeps one source per script, so a thousand tests cost about the same as a handful. Holding every dump would exhaust the heap on a real suite.

- **Source-anchored output**

  Every worklist row is a place to write a test: a file, a line, the controlling condition, and the exact outcome or input to drive, ranked so the deepest gaps surface first. A number an agent can't act on is not worth reporting.

## Pipeline overview

```text
per test (Playwright or Vitest)     once, after the whole suite
───────────────────────────────    ───────────────────────────────────────────
start V8 precise coverage       →   read every raw dump (one or more dirs)
   run the test                     merge V8 ranges per script (range-tree)
stop / takePreciseCoverage      →   remap bundle → src (or identity for Node)
write <uuid>.json to rawDir         ├─ monocart: line/branch/function coverage
                                     ├─ depth: parse → CFG → post-dominance
                                     └─ interactions: per-test arm observation
                                    format the table / return CoverageSummary
```

The two halves never share a process. Capture writes files; the report reads them. That decoupling is what lets the CLI re-analyze saved dump dirs as many times as you want without re-running tests, which is the inner loop an agent uses: run the suite once, then re-read the worklist after each new test.

## Stage 1: V8 capture

`src/fixture.ts` wraps Chromium's `page.coverage` for Playwright. `src/node-fixture.ts` + `src/vitest-fixture.ts` wrap Node's `inspector` `Profiler.*PreciseCoverage` for Vitest. Both write the same per-test JSON dump shape: `{ url, source, functions[] }`.

Playwright capture is Chromium only (`page.coverage` exists nowhere else), so it self-guards and no-ops on other browsers. Vitest capture enriches each script with source from disk or `Debugger.getScriptSource`. Capture is best-effort everywhere — a failure degrades to a missing dump, never a failed test.

Each dump is an array of entries. An entry carries the served `url`, the script `source` V8 saw, and `functions[]` with `ranges[]`. Every test repeats the full source of every script it loaded, which is why the report half merges incrementally instead of holding all dumps at once.

## Stage 2: merge and remap

`src/report.ts` is the orchestrator. It does four things in order: merge, remap, score, then analyze.

### Merge

`mergeRawCoverage` streams the raw directory. For each entry it resolves the served URL to a local path with `urlToLocalPath`, which handles `file://` URLs, Vite's `/@fs/<abs>` out-of-root form, and bare absolute paths. An entry is kept only when its path has a sibling `.map`, which drops the app, the Vite client, and framework chunks up front because none of those remap to your `src`.

Kept entries merge into a per-path accumulator through monocart's `mergeV8Coverage`, the bcoe/v8-coverage range-tree merge. The accumulator keeps one source per URL and folds each new test's ranges into a running total. Memory stays bounded by the count of unique remappable scripts, not the number of tests.

When interaction analysis is on, the merge pass also retains each test's raw ranges as a `TestObservation`. The merged coverage discards per-test identity, but interactions need to know which arms co-occurred in one test, so the raw ranges are kept (ranges are far smaller than the deduped sources).

### Remap

V8 reports hit counts in served-bundle byte offsets. To land them on `src/*.ts(x)`, the report inlines each dist `.map` into the source as a base64 data URI, then hands the result to monocart, whose remap engine walks the source map.

`absolutizeMapSources` rewrites the map's `sources` to absolute paths first. Without it the remapper resolves `dist`'s `../src/index.ts` against `baseDir` and loses the package segment, yielding `packages/src/...` instead of `packages/<name>/src/...`. Absolute sources remove that ambiguity.

### Score

monocart returns per-file results. `summarizeFile` reads each file's line hit map into a `{ covered, total }` metric and compresses the uncovered line numbers into istanbul-style ranges like `5-7,13`. Branch and function metrics come straight from monocart's per-file summary. The overall totals sum the per-file metrics.

## Stage 3: the control-flow-graph engine

Line and branch coverage answer "did this run?". Depth, interactions, and edge cases need the shape of the code: which decisions guard which blocks, which decisions are independent, and what each condition tests. That shape comes from a control-flow graph, so the package vendors one under `src/cfg/`.

The engine is a trimmed fork of `@react-doctor/cfg`, keeping only what the coverage passes use. Its barrel (`src/cfg/index.ts`) exposes the CFG and SSA builders, the post-dominator tree, `enumerateFunctions`, the constant-folding and path-feasibility helpers, and the basic-block types.

### From AST to basic blocks

`src/cfg/build/` lowers an oxc-parsed ESTree AST into one `FunctionCfg` per function, plus one for the program body. A `BasicBlock` is a maximal run of instructions that always execute together, ending in a `Terminal` that names its successors. Edges are typed: `uncond` for fall-through, `cond` for a decision arm, `backedge` for a loop, and `throw`, `finalize`, and `join` for exception flow.

The builder models expression-level control flow, not only statements. A ternary, a `&&`/`||`/`??` short-circuit, a logical assignment, and an optional chain each fork the current block into arms that reconverge at a fallthrough merge. That is why a guard like `cond && doThing()` registers as a real decision: `doThing()` sits in a block reachable only through the truthy arm. The ternary and logical terminals also stash their arm sub-expression nodes (the consequent, the alternate, the right operand), which the depth pass needs to probe each arm honestly.

Loops build a header (the test) and a body, closed by a `backedge` from body to header. `for` loops get a separate latch block for the update clause so loop-carried values flow correctly. A try/catch/finally routes a `cond` edge from the try entry to the catch (a coarse "a throw anywhere may be caught" model) and reaches the finally through `finalize` edges that bypass normal-completion filtering.

### The graph analyses

`src/cfg/analysis/` computes the classic facts over each CFG. Two matter most to coverage:

- **Post-dominators**: `computePostDominatorTree` reverses the graph and runs the Cooper-Harvey-Kennedy dominator algorithm from the exit. Block B post-dominates block A when every path from A to exit passes through B. This is the basis of control dependence.
- **Loops**: `computeCyclicBlocks` runs Tarjan's strongly-connected-components over the non-throw subgraph, so back-edges define cycles and abrupt throws don't.

Reachability, reverse-postorder, node order, the dominance frontier, and the unconditional set round out the set. Each derived structure is computed lazily and memoized per function, so a pass that only asks for post-dominators never pays for the rest.

## Stage 4: depth analysis

`src/cfg-shared.ts` and `src/depth.ts` measure how deep into each script's guard-nesting the tests reached. `prepareScript` parses one served script once and, per function, computes the post-dominator tree, the decision blocks, and a memoized `depthOf`. Both the depth and interaction passes share this single parse.

### The depth algorithm

For each served script:

1. Parse the source once into an ESTree AST (oxc), then build a CFG per function plus one for the program body.
2. Compute each function's post-dominator tree, adding virtual edges from infinite-loop latches to the exit so post-dominance stays defined inside `while (true)` and `for (;;)`.
3. Compute each block's guard depth: the longest chain of direct controllers, memoized (see [Guard depth from control dependence](#guard-depth-from-control-dependence)).
4. For each decision's arms, skipping any arm a constant test makes dead, probe whether it executed (see [Honest arm execution](#honest-arm-execution)) and tally branch-edge coverage, depth-weighted coverage (each arm weighted `1 + guardDepth`), and the deepest structural and reached depths.
5. Walk the live-reachable blocks at depth one or more for deep-block coverage and the deepest unreached gap, the "add a spec that gets here" hint.
6. Read edge cases off each reached decision's condition (see [Edge cases from condition structure](#edge-cases-from-condition-structure)).
7. Roll the per-script results up, drop third-party locations, dedupe across code-split chunks, rank deepest-first, and cap each worklist.

### Guard depth from control dependence

A block's guard depth is the length of its longest control-dependence chain. `directControllers` implements direct control dependence (Ferrante et al.): decision D directly guards block B when B post-dominates one of D's arms but not D itself. Code after an `if` reconverges, so it post-dominates the `if` and has no controller, which is what you want: it scores depth 0. `makeDepthOf` then takes the max over a block's controllers plus one, so triply nested `if`s score 3.

Control dependence rests on post-dominance, which needs a path from every block to the exit. Blocks inside an infinite loop never reach the exit, so a plain post-dominator tree drops them and everything nested in the loop collapses to depth 0. `computePostDominatorTreeWithVirtualExits` adds a virtual edge from each infinite-loop latch to the exit (the same completion the unconditional-set analysis uses), so post-dominance stays defined and an `if` inside an event loop scores its true depth. When the exit is reachable there are no such latches and it reduces to the plain tree, so finite-loop code is unaffected.

### Honest arm execution

"Did this arm run?" has a subtle answer for expression branches. A statement `if`'s arms are real blocks, so `representativeOffset` reads the block's own first instruction. But a ternary's arms and a `&&`/`||` right operand are empty blocks (the value flows structurally), so a forward walk would land on the reconverged merge, whose hit count belongs to the joined path, not the arm. Reading it would let an unexecuted deep arm borrow that hit.

`armProbe` returns the honest query instead: a ternary arm reads its own sub-expression's byte span, a logical arm 0 reads the right operand, and the short-circuit arm (arm 1) compares counts, fired when `count(left) > count(right)` because the surplus is the times the right operand was skipped. V8 only places range boundaries at control-flow divergence points, so `count(left) >= count(right)` always holds and this comparison is sound.

Max depth folds in each arm target's structural depth so a nested ternary doesn't look flat; it doesn't depend on execution, so it never over-claims. Depth reached folds an arm's depth only when that honest probe says the arm fired, so an unexecuted deep arm can never inflate it.

### Edge cases from condition structure

`collectEdgeCases` reads a worklist straight off each reached decision's condition AST, for the value axis V8 coverage can't see. A relational comparison against a numeric constant (`count > 10`) yields a boundary suggestion: vary `count` around 10. It walks the boolean structure (`&&`, `||`, `!`) to reach every leaf comparison, so `count > 10 && count < 100` yields both boundaries. An optional chain or `??` yields a null/undefined suggestion for its base or left operand.

This is synthesis, not measurement: the tool can't tell whether the boundary value ran, only that the condition's shape implies a test should exercise it. So it's emitted only for decisions that actually executed (an unreached one is already a line gap), ranked deepest-first, and clearly advisory. It turns the deepest, most edge-case-prone decisions into concrete inputs to try.

`collectConditionMutations` reads a fourth worklist from the same conditions: the operator mutants a faithful test should kill (`>` to `>=`, `===` to `!==`, `&&` to `||`). Coverage proves a branch ran; it never proves a test would notice if the operator flipped. The manifest names that gap, tagged with whether the decision was covered both ways (a surviving mutant on a both-ways branch is a missing assertion; a one-way branch needs covering first). It's a targeted, coverage-filtered plan a mutation tester such as Stryker can consume instead of mutating the whole file blindly, which on a browser suite is the difference between feasible and not. Like the edge cases it's synthesis, scoped to reached decisions, and ranked deepest-first.

### Dead code never counts

A compile-time-constant guard has an arm that can never run: `if (false)` never takes its `then`, `while (true)` never takes its condition-exit, `false && x` never evaluates `x`. `isDeadArm` recognizes these from the vendored `isConstantTruthyTest`/`isConstantFalsyTest`, and the depth pass skips the dead arm so it isn't charged against branch or weighted coverage or surfaced as a gap. `computeLiveReachableSet` extends the same idea to blocks: a block reachable only through a dead arm is dead code, so it's kept out of the deep-block count and can't become the deepest-gap hint. A line-coverage zero already records it; it isn't a test you can write.

## Stage 5: interaction analysis

`src/interactions.ts` measures combinatorial coverage: for two independent decisions that were each exercised both ways, did any single test drive both arms together? Depth already captures nested combinations, so only independent pairs add signal.

Two decisions are independent when neither is in the other's transitive control-dependence ancestor set, computed from the same post-dominance relation. Only binary decisions pair, and only when a function has at most `MAX_DECISIONS_FOR_PAIRING` of them, because pairing is quadratic.

The analyzer is two-phase. `observeTest` replays each test's raw ranges against the static model and records, per decision, which arms fired and, per candidate pair, which arm combinations co-occurred in that one test. `summarize` then counts, for every pair whose two decisions were each demonstrably exercised both ways, how many of their feasible outcome combinations were ever observed together. The uncovered combinations become source-anchored targets, ranked deepest-first.

Some combinations are impossible, not untested: two decisions over the same value, like `status === "error"` and `status === "ok"`, can never both hold. The `pruneInfeasibleInteractions` option (on by default, `--no-prune-infeasible` to disable) builds SSA over the script so the two `status` reads resolve to one value, lowers both arms' guards into facts, and drops the combination when `isPathFeasible` proves a contradiction. It's sound by construction: a combination is dropped only on proof, so `feasible`, `unknown`, or an unresolved guard all keep it. Disabling it only ever keeps extra sound targets, at the cost of a noisier worklist.

## A worked example

Take this function and a test that calls it as an admin with a small `count`, so `escalate()` never runs:

```ts
function classify(user, count) {
  if (user.role === "admin") {
    // L2
    if (count > 100) {
      // L3
      escalate(); // L4  — never runs in this test
    }
  }
  return count > 0 ? "active" : "idle"; // L7
}
```

The depth pass reports:

```text
maxDepth 2  depthReached 1   branchEdges 5/6   weighted 6/8   deepBlocks 1/2
deepest gap   app.ts:4 (depth 2)

Half-covered branches
  app.ts:3   count > 100        never = true

Edge cases
  app.ts:3   count > 100        vary `count` around the boundary 100 (>)
  app.ts:7   count > 0 ? …      vary `count` around the boundary 0 (>)
```

Every number points somewhere. `maxDepth 2` with `depthReached 1` says the structure nests two deep but the test only got one level in. `weighted 6/8` sitting below `branchEdges 5/6` says the uncovered arm is a deep one, not a shallow one. The deepest gap names `app.ts:4`, the `escalate()` the test never reached. The half-covered branch says `count > 100` only ever went `false`, so the fix is a test with `count > 100`. The edge cases add the values: confirm the `> 100` and `> 0` decisions at their boundaries (`count = 100`, `count = 0`). An agent can write those tests directly off the rows, with no need to read the function.

## Coordinate spaces

Depth is measured per served script, the coordinate space V8 reports in, not per remapped source file. A bundled `dist` is one script covering many sources. Every byte offset the CFG passes work with is a served-bundle offset.

`createOffsetMapper` builds one `TraceMap` per served script and resolves a bundle offset to `{ file, line }` in source. The depth and interaction passes share these mappers through a cache. When a map resolves, a gap reports its real `src` location. When it doesn't, the gap falls back to the served-script line, which is why a worklist row sometimes shows a chunk name and a large line number instead of a source path.

A bundler emits a source-map entry per token, not per byte, so the exact byte offset of a deep expression-level decision often falls between mappings and resolves to nothing. Rather than drop straight to bundle coordinates, the mapper retries at the nearest mapped column on the same generated line: it walks every mapping once (via `eachMapping`) into a per-line sorted column index, then binary-searches for the closest token. The source line is what the worklist needs, so the nearest token is a sound hint, and recovering it also lets the gap dedupe across code-split chunks.

A bundle also inlines its `node_modules`, so a source-mapped location can land inside a third-party package. The worklists treat third-party locations as not-yours-to-test and drop them, preferring a first-party location even when a deeper third-party one exists. The nearest-token fallback is held to the same rule: it accepts a guessed location only when first-party, so a between-tokens byte on a line whose only mapping is an inlined dependency stays first-party (via the served line) rather than being relabeled and dropped.

Capture into a clean `rawDir` per run (that is what `cleanRawCoverage` is for). Mixing dumps from several builds in one directory leaves content-hashed twin chunks that the report counts separately, because identical source files don't imply identical compiled output: a modern and a legacy build of the same sources are genuinely different code with different coverage.

## How much of the engine is used

The depth and interaction passes started on the CFG plus post-dominance alone. Two of the vendored analyses are now wired in for accuracy:

- **Constant-condition folding** (`constant-condition.ts`): drives `isDeadArm` and `computeLiveReachableSet`, so a compile-time-dead arm or block never counts against coverage or appears as a gap.
- **SSA plus path feasibility** (`ssa.ts`, `path/`): `ssaValueResolver` keys two reads of one value to the same atom, and `isPathFeasible` proves an interaction combination impossible. This powers `pruneInfeasibleInteractions` (on by default).

## Limitations

These are known and deliberate. They're worth keeping in mind before trusting a number or extending the engine.

- **Value-blind.** V8 coverage records that a branch was taken, never with what value. Boundary and null/undefined coverage is therefore synthesized from the condition AST (the edge-case worklist), not measured. The tool can tell you to test `count = 100`; it can't tell you whether you did.
- **No path coverage.** The merged coverage loses per-test path identity, so the tool measures depth (longest satisfied guard prefix) and pairwise interaction, not full path coverage. Triple-and-higher combinations and exact execution routes are out of reach without per-test traces.
- **Merged counts hide iteration shape.** A merged hit count can't separate "one test, many iterations" from "many tests, one iteration", so loop iteration coverage (0/1/many) is not reported. It would need a per-test pass like interactions.
- **Source maps required.** A served script with no readable sibling `.map` is dropped before analysis. Depth and interactions only ever cover code that remapped to source.
- **ASCII-offset assumption.** V8 offsets are UTF-16 code units and oxc spans are UTF-16 too, but `makeCountAt` treats them as interchangeable byte indices. Non-ASCII source before a decision can skew a point query slightly. Acceptable for a diagnostic, not for a proof.
- **Optional-chain arm precision.** `armProbe` handles ternary and logical arms exactly; optional-chain arms still fall back to the representative offset, so their per-arm execution is approximate.

## The benchmark harness

`bench/` makes the metrics measurable so they can be improved deliberately. It has two tiers. Ground-truth fixtures (`bench/src/fixtures/`) are small modules with deliberately varied control flow that drive a known subset of their own paths; each line carries a `// @cov` or `// @nocov` marker stating whether the driver should reach it. Real-world subjects (`--real`) clone branchy libraries and run them under their own suites.

Every measurement goes through the real product path. A fixture is bundled with esbuild, run under Node's `NODE_V8_COVERAGE`, and fed to `generateCoverageReport`. Node's dumps carry the same `functions[].ranges` shape Chromium's `page.coverage` returns, so this is a faithful headless stand-in. Line truth is checked against the markers; structural depth is locked in `expected/*.json` and re-baselined with `--update` when a metric genuinely changes.
