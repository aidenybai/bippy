# React analyzer: execution-model refactor

## Decision

Refactor the existing interpreter in place. Keep real React as the rendering backend. Make input identity, conditional execution, mutable state, completion, and task lifetime obey consistent contracts before considering a different renderer.

The model is a partly known execution. A component or fiber tree is an observation of that execution. This does not require materializing a graph of every possible future, replacing the parser, or building a new JavaScript VM.

**First deliverable:** a small, permanent test and implementation slice that preserves an uncertain operation’s returned value, shared mutations, and selecting condition together. Start with nullish coalescing; do not start by splitting the materializer into many files.

## Baseline and assumptions

This plan targets `ce8412900dcf5daa83546a30a8ee38143323837d`, the current HEAD when inspected. The explanatory HTML describes the older `c9cfc18f` revision. Reproduce old examples against the implementation baseline before treating them as outstanding defects.

Current source already provides:

- `StaticValue`, derivation tracking, guards, and a guard solver.
- `forkValues`, `forkPaths`, `runMaybe`, and expression continuations.
- `HeapJournal`, scope snapshots, and `JournaledState` for hidden mutable state.
- Persistent hook frames and modeled promise/task handling.
- Real React proxies, commit-cause tracking, and pattern extraction.
- Architecture tests enforcing dependency boundaries.

In particular, `generators.ts` now journals its cursor, and named list-property joins now receive the predicate. Preserve those improvements; do not reimplement fixes from the historical guide.

Assume the initial product contract remains **source-first analysis of initial and settled React DOM rendering under concrete or unknown inputs**, with the current configurable settling window. Preserve existing public renderer calls and fiber-pattern output. Arbitrary browser action exploration, exhaustive schedules, and a renderer-independent UI product are outside the first milestone.

All paths below are relative to `packages/bippy-analyzer/` unless stated otherwise. Proposed files are marked **new**. Names describe intended ownership, not permission to add empty layers.

## Target ownership

| Concern                                      | Owner                                    | Boundary                                                                         |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Parsed source and import resolution          | Existing graph/parser                    | Share across runs; no evaluated module state here.                               |
| Modeled values and input relationships       | Values, predicates, symbolic foundations | Pure transforms preserve relationships; they do not execute effectful callbacks. |
| Scope/store mutations and branching          | Interpreter and journals                 | All affected stores use the same fork/restore/join rules.                        |
| Completion and continuations                 | Evaluation                               | Decide which states reach subsequent code.                                       |
| Tasks and promise continuations              | Scheduler/promise models                 | Own registration, eligibility, cancellation, and modeled queue ordering.         |
| Application hook values                      | Hook frames                              | Own current, pending, deferred, and escaped application state.                   |
| Mounted React instances and lifecycle phases | Real React through the materializer      | Own reconciliation; do not invent a second independent mount/unmount authority.  |
| Trees and other observations                 | Pattern/capture boundary                 | Project execution results without becoming the owner of execution state.         |

An execution context is a logical grouping, not a requirement to copy one huge state object. Retain specialized object, hook, and task representations. Give them compatible mutation and lifetime contracts.

## Non-goals

- No new general-purpose IR, SMT solver, bytecode VM, or event-sourcing framework.
- No conversion of every object reference into a numeric address just for uniformity.
- No complete persistent-heap rewrite before measuring journal costs.
- No general React scheduler implementation.
- No automatic exploration of all user interactions or all asynchronous interleavings.
- No new public backend switch until there is a useful second backend.
- No attempt to fix every existing JavaScript compatibility issue as a prerequisite.

## Phase 0 — Make the semantic contracts executable

**Touch:** `tests/helpers/differential-evaluator.ts`, `tests/helpers/component-runner.ts`, `tests/architecture.test.ts`.

**Add only if the existing helpers cannot express the assertions:** `tests/helpers/guarded-outcomes.ts` and `tests/execution-contracts.test.ts` (**new**).

### Work

1. Preserve compact examples from the guide as checked-in regression cases rather than relying on temporary files.
2. Extend the test harness to check the association between an input assignment and an outcome. The existing symbolic helper primarily compares sets of rendered results; a correct set can still associate results with the wrong inputs.
3. Observe return values, throws, selected shared-store contents, and callback traces directly for interpreter cases. Do not route all semantic assertions through text fibers.
4. For each small finite program, run native JavaScript for each concrete assignment. Restrict the combined symbolic result by the same assignment and compare the observable outcome. Independent concrete analyzer runs are useful controls, but do not replace checking the combined result.
5. Reuse concrete React captures for instance, cleanup, context, and commit behavior. Assert event traces and state persistence as well as structural output.
6. Record a small fixed performance baseline: elapsed time, memory, forks, guard work, task executions, and React commits. Start with existing counters and test-local measurements rather than adding a public telemetry system.

### Required examples

- Repeated reads of one input versus independent inputs.
- Correlated arithmetic through two derived values.
- Conditional object writes observed through an alias and a closure.
- A short-circuited callback with a write and a throwing variant.
- Early return with a later write that must not run on the returned path.
- Promise and timer registration on only one branch.
- State replacement versus functional updates; reducer action order.
- Two component instances of one function and two closures from one factory.
- Conditional cleanup/cancellation and a callback that survives an unrelated commit.

**Exit:** the harness can reject a result with the right possible values but the wrong input association. Existing failures are recorded separately from newly introduced failures. Do not make the whole repository’s unrelated compatibility backlog a prerequisite for this refactor.

## Phase 1 — Implement one guarded execution path end to end

**Touch:** `src/evaluate/interpreter.ts`, `src/evaluate/values.ts`, `src/evaluate/heap-journal.ts`, `src/evaluate/scope-journal.ts` and the short-circuit/branch tests.

### First slice

Use this program with an unknown Boolean `flag`:

```ts
let calls = 0;
const fallback = () => {
  calls += 1;
  return "fallback";
};
const input = flag ? null : 0;
const value = input ?? fallback();
```

Required relation:

| Input          | Value        | Calls |
| -------------- | ------------ | ----- |
| `flag = true`  | `"fallback"` | 1     |
| `flag = false` | 0            | 0     |

The current `??` path still maps alternatives and caches a right-operand evaluation. Audit it with the current surrounding completion handling before changing it; do not transplant a historical patch.

### Work

1. Use the existing tested-path/fork machinery for the effectful right operand. Preserve nullishness rather than replacing it with truthiness.
2. Preserve abrupt completion from the left operand before touching the right operand.
3. Test lexical writes, aliased object writes, callback throws, and nested forks. Keep task registration for the scheduler phase unless an existing guarded registration path already handles it correctly.
4. Establish the call-site rule: `mapValue` is for pure value transformation. Any transform that calls application code, invokes a getter, coerces an object through user code, or changes modeled state must use a guarded execution path.
5. Audit nearby uses of `mapValue`, `joinMappedAlternatives`, and `callAlternatives`. Migrate callers in small batches with a concrete effect-order example for each batch.
6. Extract shared fork lifecycle code only after the slice works. If extraction removes real duplication, use `src/evaluate/branch-execution.ts` (**new**), called by existing interpreter entry points. Do not replace all three fork mechanisms with one giant function: expression results and statement continuations have different responsibilities.

**Exit:** the table holds for the combined analysis and concrete runs; no sibling path inherits the write; a skipped right operand does not throw or run a getter. Branch-order reversal does not change the meaning of the result after conditions are accounted for.

## Phase 2 — Make semantic identity and condition propagation explicit

**Touch:** `src/evaluate/predicates.ts`, `src/evaluate/values.ts`, `src/symbolic/guards.ts`, `src/symbolic/serialization.ts`, `src/render/static-renderer.ts`, `src/types.ts`.

### Work

1. Write down identity rules for inputs, bindings, allocations, closures, component occurrences, and registrations. Keep those identities distinct from source locations and display names.
2. Trace the repeated-input and correlated-arithmetic examples through construction, mapping, flattening, narrowing, and serialization. Fix the first point that loses the relationship; adding a solver rule cannot repair absent provenance.
3. Audit process-level WeakMaps and counters. Immutable caches can remain shared. Mutable semantic metadata must have a defined run lifetime; introduce a run-owned input/derivation registry only where the audit demonstrates that need.
4. Retain actual object identity for allocations and captured scopes. A source node is not a closure identity, and a source location is not a fresh-input identity.
5. Make rebuilding a branch preserve the condition for every resulting alternative, including deduplication and nested flattening. Distinguish an impossible path from a path whose value is unknown.
6. Use structured immutable predicates internally where string parsing currently crosses hot evaluation paths. Serialize at the marker/public boundary. During migration, the old string accessor must derive from one semantic source, not maintain a second mutable predicate field.
7. Preserve existing serialized shapes and decision identifiers where consumers depend on them. If that cannot be done for a particular change, make the schema migration explicit rather than silently changing the meaning of old data.

**Exit:** repeated reads correlate; distinct evaluations remain distinct; aliases and narrowed values retain their source; separate runs cannot change each other’s semantic identities. Semantic results remain equivalent after input-ID renaming, independent of previous runs.

## Phase 3 — Close gaps in the mutation protocol

**Touch:** `src/evaluate/heap-journal.ts`, `src/evaluate/scope-journal.ts`, `src/evaluate/hooks.ts`, `src/evaluate/generators.ts`, `src/evaluate/promises.ts`, mutable collection/native models, and `StubRenderTools` in `src/types.ts`.

### Work

1. Inventory stateful fields by owner, lifetime, mutation entry point, and restoration mechanism. Include closure environments and module tables, not just object properties.
2. Reuse `JournaledState` for hidden model state. Do not add a competing snapshot protocol.
3. Ensure a mutation is recorded before it changes a preexisting value. Preserve allocation-sensitive treatment of path-local objects.
4. Cover object metadata as well as entries: prototypes, accessors, descriptor flags, list named properties, backing-buffer aliases, and any metadata that affects later operations. Investigate each owner rather than assuming every field is currently unjournaled.
5. Make nested-fork behavior explicit: inner joins remain visible to the outer journal; an untouched path contributes its entry state; aliases still refer to the same object after a join.
6. Verify the newly journaled generator cursor rather than replacing it. Keep eager generator-body semantics as a separate issue; cursor journaling does not implement native generator suspension.
7. Separate application abrupt completion from an internal interpreter failure. A caught application throw preserves earlier writes on that path. An internal failure must unwind journal/guard stacks and must not publish a half-joined normal result.
8. Narrow subsystem capabilities around existing methods such as `setProperty`, `pushItems`, and `recordStateMutation`. Prefer small existing interfaces over a new universal operation bus.

**Exit:** the same fork tests work for lexical bindings, module state, objects, arrays, hook updates, iterator cursors, and supported mutable native models. Each additional mutable model must demonstrate alias preservation and sibling restoration.

## Phase 4 — Make completion and resumption consistent

**Touch:** `src/evaluate/completion.ts`, `src/evaluate/thrown.ts`, `src/evaluate/context.ts`, statement/expression continuation code in `interpreter.ts`, `src/evaluate/loops.ts`, and async differential tests.

### Work

1. Specify normal, return, throw, break, continue, and suspend as distinct semantic outcomes. Retain payloads, jump targets where supported, and the condition selecting the outcome.
2. Introduce explicit outcome records at the statement/continuation boundary. Keep the current `StatementOutcome` adapter temporarily for unmigrated callers. Migrate one statement family at a time and remove its adapter when all callers move.
3. Do not join exited states into the live state used by the rest of a block. Preserve the existing useful distinction between completing and exited paths in `forkPaths` and `journal.continueFrom`.
4. Preserve catch access to mutations preceding a throw. Preserve pending return/throw through a normal finalizer; replace it when the finalizer exits abruptly.
5. Route supported await resumption through the same completion handling as synchronous execution. Keep captured scope, handler stack, input condition, and execution context with the suspended computation.
6. Handle mixed outcomes explicitly: one path can suspend while another returns or continues. Never replace a suspended path with a normal unknown value and execute its following statements prematurely.
7. Expand supported forms incrementally: straight-line block awaits, then conditional continuations, then loops/switch/destructuring as separate changes. Unsupported forms retain an explicit limitation; full async JavaScript support is not hidden inside this phase.

**Exit:** nested return/throw/finally examples preserve values and writes; a suspended path neither disappears nor executes early; resumed rejection reaches the correct handler. No expression operand after an unconditional throw is evaluated.

## Phase 5 — Give queued work explicit identity and lifetime

**Touch:** `src/evaluate/timers.ts`, `src/evaluate/promises.ts`, `src/materialize/commit-causes.ts`, interpreter task entry points, and the existing task-cause fixtures.

### Work

1. Replace bare queued callbacks with internal task records carrying the information actually needed: registration identity, task kind, bound callback, registration condition, parent task, and handle/timing data where relevant. The callback can remain a closure; a serializable task language is not required.
2. Keep registration records immutable. Journal or otherwise guard mutable eligibility, consumption, cancellation, and promise state through the shared mutation protocol.
3. Preserve registration conditions independently of the latest commit. Combine registration and execution constraints before running a callback, and apply the resulting condition to its writes.
4. Preserve path-specific queue membership and order. Joining two queues must not invent a single unconditional ordering. If their orders are incompatible, retain guarded sequence alternatives or separate states; do not introduce a general partial-order exploration engine in this phase.
5. Give promise reactions the same discipline as timers. Audit registration as well as settlement: journaling only the promise’s settled value does not establish that its reaction list is correct.
6. Ensure a task is consumed at most once per modeled path. A handle cancels its registration, not another callback with the same source body.
7. Keep the current settling policy explicit and compatible: drain eligible modeled work between React flushes under the configured window and bounds. Unknown external timing stays deferred; no arbitrary new user events are generated.
8. Keep scheduled updates associated with their registration/callback history. Do not reduce causal ownership to whichever guard is currently active at an unrelated later commit.

**Exit:** conditional registration, nested microtasks, promise adoption, callback registration after await, conditional cancellation, and unrelated intervening commits preserve their allowed update sequences. Existing task-cause examples serve as starting points, not only tree-shape assertions.

## Phase 6 — Clarify the React boundary and contain alternative interference

**Touch:** `src/materialize/materializer.ts`, `src/evaluate/hooks.ts`, `src/evaluate/react-hooks.ts`, `src/materialize/commit-causes.ts`, `src/materialize/mount.ts`, `src/render/static-renderer.ts`.

### Work

1. State the ownership split in code contracts: the hook frame owns modeled application state; React owns mounted proxy identity and lifecycle phases; the task model owns modeled asynchronous work. The proxy’s scheduling hook is not application state.
2. Separate element descriptions, mounted instances, render attempts, and committed effect records. Preserve React’s component/type/key/position behavior rather than inventing global instance IDs from keys or source names.
3. Publish effect records only from the pass that commits. Keep render-phase updates, bailouts, dependency reuse, old cleanup retention, unmount, and Strict Mode behavior distinct.
4. Extend assertions for two occurrences of one component, closure-created component types, keyed reorder versus remount, provider changes, refs, error boundaries, and Suspense fallback/retry. Preserve logical ancestry through portals.
5. Add a bounded isolated-execution path for cases where combined alternative mounting contaminates shared state. It must rerun the selected history from the entry with a fresh interpreter and host, including effects and task order. Rendering only the final selected tree in a new root is not equivalent.
6. Initially use that path internally on explicit finite fixtures. Selection must correspond to consistent input/path constraints; existing marker decision pins alone are not a general way to constrain every earlier side effect. Reuse existing derived-renderer machinery where it fits, without presenting it as a new exhaustive execution engine.
7. Share parsed source, not evaluated module stores, hook frames, queues, DOM state, or mutable native model state. A new React root alone is insufficient isolation. Where native/global state cannot be reset reliably, use a separate process for that bounded path or leave it explicitly unsupported.
8. Before making isolation a default, measure the cost and define its bounds. Keep unresolved regions explicit if the bounded path cannot cover them. Do not label a finite sample of histories as the complete model.

**React source requirement:** before lifecycle changes, inspect `ReactChildFiber.js`, `ReactFiberHooks.js`, `ReactFiberCommitEffects.js`, and the relevant work-loop, Suspense, and host-config code for the supported React version. The reference clone inspected while planning was `/tmp/react-pr-115-refactor-plan` at `59aff3e18cb5b3a336c280bbfa57ec37999511b9`; it is not a substitute for checking the version used by each fixture.

**Exit:** retaining or remounting a component preserves or resets the right state; only committed effects run; cleanup belongs to the registration it created; isolated histories cannot observe another history’s modeled mutations. Fiber output remains available through real React.

## Phase 7 — Make collection and external-operation summaries honest

### Collections

**Touch:** `src/evaluate/array-methods.ts`, `src/evaluate/loops.ts`, collection models, `src/harness/static-pattern.ts`.

- Preserve known finite lists and their ordering whenever possible.
- Distinguish an absent item from an unknown present item.
- Keep per-item uncertainty separate from shared outer inputs.
- Preserve key/identity relationships needed by React reconciliation.
- Make widening of loop-carried state explicit. A repeat summarizes structure; it does not establish arbitrary iterator or callback behavior.
- Check a mapped list whose rows share `selectedId`, plus rows with independent local inputs and conditional callback writes.

### External operations

**Touch:** `src/evaluate/stubs.ts`, `src/evaluate/escapes.ts`, `src/evaluate/native-values.ts`, `src/evaluate/native-closures.ts`, `src/libraries/index.ts`, and affected models.

- Document each supported boundary’s behavior in its existing narrow interface: returned value, reachable mutations, thrown outcomes, retained callbacks, and scheduled work.
- Unknown calls must not silently mean “returns unknown and otherwise does nothing.” Reuse escape handling to broaden affected reachable state where supported; otherwise surface the unsupported effect boundary.
- Begin with existing library models and their actual callers. Do not introduce a package-wide effect-annotation DSL.
- Treat native calls as effectful unless the supported operation is known to be safe for the supplied arguments. Preserve shared references across conversion/lifting.

**Exit:** summaries do not invent independence, erase callback effects, or confuse unknown structure with empty output. Unsupported behavior is distinguishable from an ordinary unknown input.

## Phase 8 — Optimize only after semantic boundaries hold

**Touch only measured hot paths.** Candidate areas are predicate construction, fork snapshots, guard solving, module reuse, and repeated component evaluation.

1. Reuse immutable source graphs and canonical immutable condition structures where that reduces measured work.
2. Investigate journal deltas or copy-on-write stores only if mutation snapshots dominate time or memory.
3. Memoize only computations whose dependencies are accounted for. Function identity and argument values are insufficient when a call reads modules, context, shared objects, clocks, or stores.
4. Track dependency reads narrowly if needed. Fall back to invalidation rather than reusing a result with an incomplete dependency set.
5. Merge or subsume states only when control position, lifetime, and queued-work distinctions remain represented. Identical current trees are not a sufficient merge criterion.
6. Compare fixed cold/warm runs and repeated samples against Phase 0. Require an agreed time and memory envelope before switching defaults; do not invent a percentage without baseline data.

**Exit:** measured improvements preserve the semantic examples. Remove temporary compatibility paths as their callers migrate; do not leave a second shadow interpreter running in normal execution.

## Backend decision gate — separate project, not a prerequisite

After Phase 6, decide whether users need a direct element/component projection in addition to fibers.

A bounded prototype may support a deliberately limited subset of stateless, non-suspending components and known children. It must not pretend that creating element descriptions reproduces mounting, cleanup, Suspense, or React scheduling.

Proceed only if a real consumer benefits and the prototype reduces cost or complexity. Keep it private until there is a concrete API requirement. Preserve the React backend for fiber and lifecycle behavior. Do not replace the reconciler based on a smaller architecture diagram.

## Implementation order and review units

Dependency order:

```text
0: executable contracts
  → 1: guarded-operation vertical slice
  → 2: identity and condition preservation
  → 3: mutation protocol
  → 4: completion/resumption
  → 5: task lifetime/order
  → 6: React boundary/isolation
  → 7: collection and external summaries
  → 8: measured optimization
```

Keep each phase in small reviewable changes. A representation extraction and a semantic correction should be separate commits when possible. Model-specific work can proceed in parallel after the shared mutation contract is stable; edits to the interpreter’s branch/continuation core should be sequenced.

First four changes to implement:

1. Add input-associated outcome assertions and the nullish-coalescing example to permanent tests.
2. Fix that operation through the existing guarded fork machinery, including abrupt completion and alias effects.
3. Factor only the shared fork lifecycle made clear by that change; protect dependency boundaries with `architecture.test.ts`.
4. Add the correlated-input reconstruction cases and repair condition propagation at the earliest failing boundary.

This yields useful behavior before the later lifecycle work and gives a stopping point if the broader refactor stops paying for itself.

## Validation commands

Run from the repository root. These are starting suites, not a claim that all checks were run while writing this plan.

```sh
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test tests/architecture.test.ts tests/heap-journal.test.ts tests/branch-differential.test.ts tests/branch-reachability.test.ts
pnpm --filter bippy-analyzer test tests/boolean-provenance-differential.test.ts tests/callback-guards.test.ts tests/react-hooks.test.ts
pnpm --filter bippy-analyzer test tests/async-completion-differential.test.ts tests/commit-causes.test.ts tests/task-cause-inputs.test.ts
pnpm --filter bippy-analyzer test tests/components.test.ts -t 'early-return-mutation|effect-cause-|render-counter-interference|ref-interference|context-scopes|external-store|keyed-fragment'
git diff --check
```

Add the new focused suites to the relevant change. Run the broader package tests before integration, comparing against the baseline rather than converting failures into expected behavior. Existing tests that intentionally encode a known defect need to be updated when that defect is fixed.

Preserve public shapes in `src/render/types.ts`, `src/index.ts`, and the harness serializers unless a separately documented API migration is necessary. Check that existing symbol/tree consumers still work, but judge semantic changes through values, state, lifetime, and ordering—not a report label.

## Completion criteria

The first milestone is complete when:

- Repeated inputs retain their relationships through calls, joins, and output.
- Every migrated mutation family obeys fork isolation and identity preservation.
- Returned, thrown, and suspended paths reach only the continuation they should.
- Tasks retain their registration conditions, order, cancellation, and ownership.
- React still determines supported reconciliation behavior through the existing backend.
- No new default backend, giant execution graph, or general solver is required.

The result should be fewer independent rules for the same semantic operation, not merely more interfaces around the current implementation.
