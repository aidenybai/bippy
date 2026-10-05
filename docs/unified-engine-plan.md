# One execution engine for JavaScript and React

## Goal

Run application code and React through one engine262-derived semantic core. Concrete inputs take concrete paths. Unknown inputs retain conditions, heap relationships, completions, and scheduled effects. Concrete replay is a validation tool, not a substitute for symbolic execution.

For an unknown Boolean `enabled`, a closure that increments an object in one branch and later renders it must keep these associations:

```text
enabled = false → unchanged object → original output
enabled = true  → incremented object → updated output
```

The same rule applies when a branch throws, suspends, installs an effect, or schedules a callback. Executing React inside the engine must not commit effects from abandoned renders.

## Order of work

### 0. Reconcile PR #145 before more implementation

PR #145 originally targeted `aiden/strict-compatibility-24aa`, not the current PR #115 branch. It was reconciled with the current branch, retargeted explicitly, and merged as `4398f30e` after review repairs. Its remote build, check, typecheck, test, and web E2E checks passed. The steps below record the integration requirements.

1. Record both branch heads, inspect their ancestry, and read the complete PR diff and failed CI logs.
2. Preserve the uncommitted engine experiment and nascent source import. Use separate worktrees for PR repair and integration.
3. Distinguish failures introduced by the PR from failures already present in its base. Fix real issues rather than disabling tests or weakening compatibility criteria.
4. Reconcile overlapping production fixes and tests against the current analyzer. Preserve the SSA, narrowing, ownership, resolver, and platform-error fixes already present here.
5. Run focused regressions, full tests, repository checks, and typechecking. Report coverage and strict compatibility separately; a green test run does not make the strict gate green.
6. Update the PR with reviewed fixes, verify remote checks, and merge the reviewed head into its intended base. Integrate that result into the working analyzer branch with explicit ancestry preservation. If its base is unrelated or contains substantial unreviewed work, establish the integration route before merging.
7. Revalidate the engine experiment on the reconciled tree, then resume the work below. Do not force-push over concurrent work.

### 1. Establish a maintained source fork

- Maintain engine sources inside `packages/bippy-analyzer/engine/` with a pinned upstream revision and reproducible pnpm/TypeScript build.
- Preserve upstream license, provenance, source layout, and test history. Keep upstream source distinguishable from project-authored adapters; do not rename or restyle the entire vendor tree.
- Incorporate the existing regex patch in source, not only generated distribution files.
- Verify the fork against the pinned package and native JavaScript. Keep an explicit Test262 inventory of passes, failures, unsupported features, harness failures, and exclusions.
- Keep production execution unchanged until later acceptance gates pass.

### 2. Execute React inside the fork

- Load React's public library and its actual reconciler into the same engine realm as application code. The original membrane experiment runs React natively; the newer engine-owned probe is separate.
- Reuse React code rather than recreate hooks, classes, update queues, error boundaries, or Suspense.
- Start with a deterministic host renderer, then evaluate the DOM renderer and host boundary separately. Keep host effects controlled and observable.
- Test constructors, private fields, state/reducer queues, memo/context, refs, cleanup, error boundaries, lazy loading, Suspense abandonment/retry, transitions, and unmount.
- Compare ordered commits and effects with native React. Keep independent browser tests separate from shared-harness comparisons.

### 3. Prove a symbolic vertical slice

- Add an explicit abstract-value and execution-policy boundary to the fork. Input domains come from caller declarations, never TypeScript annotations.
- Start with Boolean conditions and primitive expressions. Preserve aliases and conditions through local variables, object properties, captured scopes, exceptions, and callbacks.
- Make unsupported abstract operations fail visibly. Never silently coerce an unknown value to an ordinary truthy object.
- Choose and document continuation ownership. Upstream evaluators use host JavaScript generators, which cannot simply be cloned.
- If isolated symbolic path replay is used initially, label it as replay, isolate every run's effects, and preserve abstract values and path conditions. It does not establish checkpoint cloning, heap joins, general numeric solving, or scalable exploration.
- Acceptance example: an unknown condition mutates a captured object, registers a callback, throws on one path, and produces correlated React outputs on the other. Unused symbolic inputs must not trigger concrete assignment enumeration.

### 4. Generalize state and control

- Introduce branch-owned environments, heap versions, descriptor/private-field state, and allocation identities.
- Preserve return/throw/break/continue/finally ordering, iterator closing, per-iteration bindings, async resumption, generator state, and job ownership.
- Add sound constraints and widening for broader scalar domains and loops. Track unknown satisfiability rather than claiming infeasible paths are real executions.
- Implement joins only where values, aliases, effects, and pending work remain correlated. Record budget exhaustion as incomplete analysis.
- Use differential generators and shrinking to retain failures as small native-backed regressions.

### 5. Carry symbolic state through React

- Execute React's control flow under the same guarded-state machinery. A native reconciler cannot consume arbitrary unknown values directly.
- Keep render attempts, hook queues, class updates, context, Suspense retries, and effect cleanup tied to their owning execution states.
- Give the host renderer a guarded observation contract. DOM projection and irreversible external effects must not erase conditions or replay silently.
- Test competing updates, discarded work, repeated suspension, throwing reducers, error recovery, and event sequences, not just initial trees.

### 6. Integrate and retire duplicate machinery

- Share source resolution, environment declarations, observations, diagnostics, and provenance where their semantics actually agree.
- Move one proven capability at a time from the old interpreter. Keep the old path available until its replacement passes the corresponding regressions and performance gates.
- Preserve supplied-input-to-outcome associations in the public API and serialized results.
- Profile preparation, execution, state forks/joins, retained heap, and real application workloads before deciding whether to retain or replace the local SSA optimization.
- Delete superseded implementations only after an explicit production cutover review.

## Definition of done

- One maintained semantic core handles both concrete and symbolic application execution.
- React's implementation executes inside that core for the analyzed paths; a native oracle remains independent application execution.
- Unknown inputs remain associated with outcomes through state changes, exceptions, jobs, and React lifecycle work.
- Supported behavior, unresolved semantics, bounds, host policies, and exclusions are explicit and covered by reproducible tests.
- Existing regressions, targeted Test262 coverage, native differential tests, and representative React/application workloads meet documented gates.
- Production migration and removal of duplicate code are reviewed separately from experimental milestones.

“Done” does not mean all JavaScript, browsers, or possible event histories have been exhaustively proved correct. No such claim follows from a finite corpus.

## Current state

- Existing concrete experiment: 579/585 fixtures match at both recorded seeds; five native-oracle failures and one unsupported import remain. That historical experiment is separate from the production API integration described below.
- **Stage 0 complete:** PR #145 merged into the current analyzer branch as `4398f30e`. The reconciliation preserved newer production work, removed unused list-integrity helpers, restored defensive checks, and repaired its tests. Engine work remained uncommitted and separate.
- **Stage 1 partial:** `packages/bippy-analyzer/engine` builds vendored source at `f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a` with the regex patch, Node 22 compatibility changes, and explicit control lowering. Declarations are generated from current source. The 352 core/boundary/Test262 tests and 17 production-renderer integration tests pass, including control-checkpoint and Test262-runner regressions. The expanded Test262 report is recorded in the [fork README](../packages/bippy-analyzer/engine/readme.md); SharedArrayBuffer failures still keep its gate red.
- The Test262 runner now supports recursive scopes, stable shards, full-tree selection, per-variant process limits, and a manual artifact-producing workflow. With bounded job draining and async completion checks, the isolated baseline has 883/885 passing variants, two SharedArrayBuffer failures, and no unsupported files. JavaScript modules now support cycles, live bindings, dynamic imports, resolution negatives, and top-level await. The module-code/dynamic-import selection has 2,344 passes and 158 unsupported variants across 1,604 files, with no failures, harness/engine errors, or incomplete work. The complete two-directory generator selection passes 1,056/1,056 variants across 556 files, and shard `1/16` passes 74/74. Four async-function/generator directories pass 2,096/2,096 variants; Promise resolve/then pass 206/206. Unhandled rejections are reported separately rather than automatically treated as uncaught exceptions. The 53,595 full-tree test candidates have been listed, not run. The workflow has not run remotely for this work.
- **Stage 2 partial:** actual installed React and `react-reconciler` now execute inside the engine with a mutation-mode test host. Twelve native-backed tests pass, including Suspense, transitions, lifecycles, and effects. The production API now also runs actual React DOM inside the engine. Hydration, resources, framework behavior, and application-scale performance remain incomplete acceptance gates.
- **Stage 3 control preparation implemented; symbolic support remains unimplemented:** lowered algorithms now run through an explicit delegation stack with tail-continuation replacement. Tests cover 20,000 delegated frames, 2,000 recursive application calls, and bounded strict tail-call depth through direct, bound, proxy, call, and apply paths. A low-level, owner-dependent control checkpoint now restores direct captured bindings and continuations without prefix replay. Transitive native captures and unversioned heaps/jobs still prevent general sound forks. Stages 4–5 remain unimplemented. Stage 6 now has an explicit production API path, but no default cutover or removal of the old symbolic backend.
- Both fork corpus sweeps now match the same 579 fixtures out of 585 native attempts per seed, with five native-oracle failures and one unsupported import. The first fork sweep had an intermittent autosave mismatch; the browser harness now waits for registered Web Crypto work inside each `act` callback. This declared batching policy is not browser scheduling semantics.
- **Stage 6 integration started:** `StaticRenderer({ execution: "engine" })` runs components and entry modules through `src/engine`, with project resolution and the existing fiber snapshot contract. Application code, React, React DOM, and the recorder are engine-owned. Seventeen integration tests cover behavior and explicit refusal without fallback. The verified full production-path corpus attempted all 585 fixtures: 570 matches, one mismatch, nine unsupported imports/mappings, five oracle errors, and no engine/harness errors or incomplete/excluded cases. Raw/inline assets now use the existing project transforms. See the [integration README](../packages/bippy-analyzer/src/engine/readme.md) for the remaining gaps. Unknown inputs, framework contracts, and guarded state still prevent a complete port.
- Repository typechecking passes with the source fork. The latest full repository run passed 26,071 tests with two skipped, across 559 passing files and two skipped files. Repository checks pass with zero errors and 65 existing warnings. No coverage or strict compatibility gate was remeasured.
- The [symbolic control gate](unified-engine-control.md) specifies the next acceptance program and explains what the concrete driver does—and does not—own. The symbolic program is still an acceptance contract, not implemented support.
