# React analyzer roadmap

Build an analyzer that executes real application code and real React through engine262. Keep unknown inputs symbolic, then describe conditional UI and state transitions without rerunning the whole application for every concrete input combination.

This is a migration of capabilities from [PR #115](https://github.com/aidenybai/bippy/pull/115), not a new custom JavaScript interpreter. engine262 must own JavaScript execution. The symbolic representation describes values, conditions, effects, and UI; it must not become a second execution engine.

## Where we are

Initial symbolic milestone: commit `3d5d5563` on [PR #149](https://github.com/aidenybai/bippy/pull/149), stacked on [the engine262 setup PR](https://github.com/aidenybai/bippy/pull/146). These features are implemented on the PR branch, not a claim about a merged release.

- [x] Pin engine262 and provide a public-API smoke test and Test262 setup.
- [x] Expose `evaluateSymbolicExpression()` through the package source API.
- [x] Preserve both results of an unknown Boolean ternary condition.
- [x] Handle Boolean negation, nested conditions, correlated decisions, and guarded scalar exceptions.
- [x] Reuse selected Boolean guard shapes and helpers from #115.
- [x] Reject unsupported syntax and report step/outcome budget exhaustion without returning a complete-looking result.
- [x] Compare supported expressions with independent runs of the unmodified engine. The initial baseline had 58 passing tests and a passing analyzer CI job.

```text
(enabled ? 1 : 2) + 3
├── enabled  → 4
└── !enabled → 5
```

- [x] Replace runtime bundle insertion with a pinned source build, typed hook, generated declarations, and source maps.
- [x] Verify clean-build reproducibility across relocated roots and preserve the scoped concrete baseline against the published engine.

- [x] Lift finite guarded scalar alternatives through engine arithmetic, comparisons, unary operations, ternaries, and short-circuit/nullish expressions.
- [x] Preserve input correlations through intermediate values and skip right operands on throwing or short-circuited paths.
- [x] Compare scalar fixtures and generated operator matrices with unmodified engine262 and native Node execution. The scalar checkpoint passed 651 tests across four files.

- [x] Delegate bitwise and shift expressions to engine262's existing evaluators.
- [x] Compare guarded syntax traces and complete outcome partitions against independent witnesses. Keep generated selections fixed and preserve all failures.

The [parity goal and evidence](docs/parity.md) separates these scalar checks from the remaining application and React work.

Declared inputs remain unknown Booleans. Internal object tokens identify finite guarded alternatives; syntax checks and operand substitution keep those tokens out of ordinary engine coercions. The [source-built extension](engine/README.md) does not yet provide unbounded numeric/string inputs, heap isolation, or a general constraint solver. See the [current implementation contract](docs/symbolic-evaluation.md), including the v2 scope and intermediate-choice budget.

The separate resolver work includes native build observation, corpus comparisons, a build CLI, and a Vite + React demo. That work is not integrated into this PR. A matching build graph does not prove module execution or React rendering.

- [x] Execute supplied native-built JavaScript chunks through engine262's module loader and cache, including dynamic imports and top-level await.
- [x] Run actual React and React Test Renderer inside engine262. Nine scenarios compare trees, state, lifecycle traces, and cleanup against V8.
- [x] Add explicit zero-delay task-host boundaries, job/step budgets, failure retention, and runtime isolation checks. The initial concrete checkpoint passed 705 tests across eight files.
- [x] Execute production and development React DOM counter fixtures with guest-owned LinkeDOM. Compare HTML, lifecycle traces, programmatic clicks, and cleanup with V8 and real Chromium.
- [x] Add the missing Annex B `substr` intrinsic through an engine source patch. Preserve independent Test262 and V8 comparisons and the earlier engine failures.
- [x] Serialize guest exception diagnostics without traversing their heap or invoking guest code. Keep original values available explicitly.
- [x] Expose engine262’s argument parameter maps and lazy state to its existing checkpoints. [Argument aliases and roots](docs/arguments-checkpoints.md) restore in selected-state Agent forks; general React ownership remains incomplete.
- [x] Reuse canonical engine methods to checkpoint immutable-prototype and string-object properties, including the two intrinsic prototypes found by the React probe. [These selected snapshots](docs/intrinsic-checkpoints.md) are not general intrinsic ownership.
- [x] Reuse the existing Error constructor slot list and property snapshots for [initialized Error selection](docs/error-checkpoints.md). Read-only diagnostic fields do not own diagnostic lists or stack contexts.
- [x] Reuse engine RegExp allocation metadata and property snapshots for [initialized RegExp selection](docs/regexp-checkpoints.md), including `lastIndex`. Native matcher records remain unowned; the documented interior-surrogate discrepancy remains unresolved.
- [x] Reuse Map list/entry snapshots for [selected WeakMaps](docs/weak-map-checkpoints.md), with explicit saved-key retention. Expanded React discovery captures/releases 2,199 guest objects and 814 binding cells together; native ownership and React restoration remain incomplete.
- [x] Reuse context copying and CallSite cloning for [selected native context storage](docs/context-checkpoints.md). A diagnostic React fork matches eight native observations without prefix replay, but a timer variant proves host-state leakage. It is not an accepted general owner.
- [x] [Reject covered host effects](docs/checkpoint-host-effects.md) during evaluation checkpoints before queue or runtime storage changes. The partial-owner React timer probe now rejects its first timer instead of returning leaking branch results. Queue restoration remains missing.
- [x] Patch the existing web event loop to [snapshot selected macrotask membership](docs/web-queue-checkpoints.md), preserving its Map, Sets, job identities, and order. Callback state, microtasks, and timers remain separately owned or unowned; host-effect guards stay enabled.
- [x] Reuse Basic/ByTypeJobQueue Sets for [selected job-queue membership snapshots](docs/job-queue-checkpoints.md), including category indexes and saved roots. This does not rewind callback state or permit effects during evaluation checkpoints.
- [x] Snapshot [concrete timer and diagnostic storage](docs/concrete-host-checkpoints.md) with the engine queues and declared host roots. Restore consumed/cancelled capture arrays and handles without resetting lifetime work budgets. Guest/native callback state remains separate; evaluation host-effect guards stay enabled.
- [x] Expose [builtin behaviour references](docs/builtin-capture-edges.md) and original from-adapter targets through existing marking/capture metadata. The React diagnostic now discovers 2,471 native functions, including 65 without manifests; counts do not establish ownership or GC coverage.
- [x] Declare [concrete installed-callback and job captures](docs/concrete-native-captures.md) through the existing engine metadata API. Preserve timer-array aliases and let an explicit owner reject discovered runtime state before branching. Registration does not prove ownership. The collector now follows reachable declared bindings, not arbitrary closures.
- [x] Reuse the collector for [declared native-capture roots](docs/native-capture-roots.md), preserving cycle detection and weak-key fixed-point behavior. Unregistered callbacks and plain native records remain unsupported; retention does not establish restoration.
- [x] Restore [selected ReferenceRecord keys](docs/reference-checkpoints.md) through the existing state checkpoint. Both branch orders now match native computed-assignment behavior without reusing the previous branch’s coerced key. Unselected referents and other native state remain unowned.
- [x] Restore [selected native-list storage](docs/native-list-checkpoints.md) through the existing state checkpoint, preserving original arrays and holes. This fixes argument accumulation across branches, not transitive ownership of array elements or a general React owner.
- [x] Reject [clock and random operations](docs/checkpoint-nondeterminism.md) during evaluation checkpoints before host-hook lookup, entropy use, or Realm random-state mutation. This is a safe rejection boundary, not nondeterminism rollback or complete ownership.
- [x] Validate [final engine Descriptor records](docs/descriptor-checkpoints.md) through the original constructor schema and shared read-only metadata checks. Saved property-table descriptors are included automatically. The separate mutable `ToPropertyDescriptor` initializer requires its own selection below.
- [x] Reuse the original Descriptor constructor and marker for [mutable initializer snapshots](docs/descriptor-initializers.md). Explicit selection fixes a reproduced property-conversion leak across both branch orders. Unselected native records and general React ownership remain unsupported.
- [x] Reject [six module host operations](docs/checkpoint-module-effects.md) during evaluation checkpoints before their hook lookups or engine completion writes. Cold imports/meta reads reject; cached meta reads remain available. Already-started loaders, native caches, and module rollback remain unowned.
- [x] Reject checkpoint capture while [engine module loads remain pending](docs/pending-module-loads.md), before owner access. The counterexample exposes native cache/context writes before the existing completion guard. Admission rejection avoids that checkpoint path; it does not restore module or callback state.
- [x] Mark [pending module capabilities and graph-module edges](docs/module-load-roots.md) through the existing request registry and collector. Forced-GC tests preserve reaction values through loading and release their roots after completion. Referrers, native caches, and complete module ownership remain outside this increment.
- [x] Mark [completed builtin module-cache results and script-associated modules](docs/module-cache-roots.md) through their original records. Repeated imports preserve exported object, symbol, and namespace identity across GC. Cached syntax-error identity differs from the recorded Node behavior; no cache rollback or general module-ownership claim follows.
- [x] Mark [live template-cache arrays](docs/template-cache-roots.md), including `.raw` through existing property markers. Twelve Node comparisons preserve tagged-template identity through GC. Cache/AST ownership and tail-call conformance failures remain separate work.
- [x] Register [native class lexical captures](docs/native-class-captures.md) without replacing constructors. Both-order counter regressions restore a class-only binding after its creator returns. `[[ClassState]]` remains explicitly unowned; registration does not restore fields, prototypes, private state, or detached methods.
- [x] Compare four real React tree specializations from two opaque Boolean inputs with native execution and explicit trees. [The ownership probe](docs/react-tree-ownership.md) identifies unsupported state before the first choice. These witnesses do not restore or explore shared-prefix React branches.

These are [concrete execution increments](docs/concrete-execution.md), not completion of the browser runtime stages. Still missing here: full application-loader integration, general browser host support, general symbolic values, branch-local mutable state, symbolic React trees, and event transitions.

## Rules for every stage

- Keep implementation in the normal package source, API, tests, and CI. Do not create a parallel experimental implementation.
- Reuse engine262's concrete operations. Extend their handling of unknown values instead of copying the old interpreter's operators or evaluator.
- Prefer existing engine262 APIs and reviewed engine extensions over custom runtime code. Keep JavaScript semantics in engine262 and React semantics in actual React. Custom code should focus on abstraction, guards, state ownership, host boundaries, and reporting.
- Execute actual React and runnable dependencies. Do not recreate hooks or silently replace child components, imports, or libraries with stubs.
- Make unknown inputs explicit. An omitted prop is `undefined`; a TypeScript annotation does not declare a symbolic input.
- Preserve initial state. A counter initialized to zero does not start as an arbitrary number merely because future states are symbolic.
- Use concrete input enumeration for differential tests, not as the symbolic implementation.
- Report unsupported operations, incomplete exploration, engine failures, and analysis mismatches separately. None is a successful proof.
- Keep budgets explicit. Do not silently increase limits, truncate results, or drop failing branches.
- Inspect the relevant pinned engine262 and React source before changing execution behavior.

## Migration inventory

Reference: #115 at `1b73cbf75f6e9eb04d6a4ce03c95318960207906`. Paths below are under its `packages/bippy-analyzer/` directory. Existing implementations are references with limited coverage, not proof of general correctness.

| Existing work                                                    | What to carry over                                                 | What must change                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `src/symbolic/guards.ts`, `guard-solver.ts`                      | Guard formulas, correlation, constraint checks, witness tests      | Extend beyond the current Boolean subset and connect constraints to engine values                                  |
| `src/types.ts`, `src/evaluate/values.ts`                         | Requirements for unknown values, ranges, strings, and alternatives | Represent symbolic values within the engine262 execution model; do not transplant `StaticValue` as another runtime |
| `src/evaluate/heap-journal.ts`, `scope-journal.ts`               | Isolation and merge designs, aliasing and mutation regressions     | Track engine262 objects, environments, internal state, and host effects                                            |
| `src/evaluate/react-hooks.ts`, `src/materialize/`                | Hook, lifecycle, ownership, and update test cases                  | Let actual React implement hooks and reconciliation inside engine262                                               |
| `src/harness/symbolic-tree.ts`, `src/symbolic/serialization.ts`  | Guarded tree, repeat, provenance, and serialization designs        | Produce observations from engine execution and promote reusable output code into production source                 |
| `src/harness/state-space.ts`, `src/materialize/commit-causes.ts` | State matching, transition, and commit-cause concepts              | Connect them to engine-owned state and real React commits                                                          |
| `src/compiler/`, the old interpreter and library models          | Regression cases and performance findings                          | Do not port their execution machinery. Control-flow graphs and static single assignment are not prerequisites      |

- [ ] Inventory old tests by capability and assign each a target stage below.
- [ ] Mark each capability as reused, adapted, replaced, deferred, or unsupported.
- [ ] Keep expected results independent of the old interpreter. Use engine262 and native React/browser runs as reference executions.

## Implementation order

```text
0. Define the analysis contract
└── 1. Maintainable engine extension
    ├── 2. Application loading → 3. Concrete React execution
    └── 4. Symbolic values → 5. Branch-local state
        Both tracks are required for:
        6. Symbolic React trees
        └── 7. Events, effects, and asynchronous transitions
            └── 8. Repetition, state summaries, and queries
                └── 9. Demo, CLI, corpus, and release gates
```

Loading and concrete React work can proceed alongside symbolic engine work. Do not enable symbolic React until state isolation covers its engine and host writes. Add tests and diagnostics throughout, not only in stage 9.

## 0. Define the analysis contract

- [ ] Define caller-selected entrypoints, exports, props, providers, environment inputs, and permitted interactions. Do not infer an application's root component.
- [ ] Define unknown-input identities, types, domains, and provenance. Cover props, state families, event payloads, network data, storage, routes, clocks, and randomness.
- [ ] Distinguish a concrete initial state, an unknown external input, and a symbolic family of reachable states.
- [ ] Confirm the first public report: a guarded UI tree, a transition graph, or both. Preserve the conditions and state identity needed to connect them.
- [ ] Define exact, overapproximated, unsupported, and incomplete results. An overapproximation may include behavior that no concrete run can reach.
- [ ] Define how unsupported calls and unresolved values appear in reports. Never convert them into an empty tree, a false condition, or a successful result.
- [ ] Specify the first supported JavaScript, React, host, and scheduling subset. Record exclusions alongside capabilities.

Completion check: API examples show a concrete render, an unknown prop, a state update, a guarded exception, and an incomplete result. Their meanings and limits are explicit before the implementation broadens.

## 1. Maintainable engine extension

- [x] Replace load-time bundle text insertion with a reproducible source-built extension or an upstream evaluation hook.
- [x] Pin source, patches, build tools, generated artifacts, declarations, and licenses. Produce valid source maps and a documented upgrade procedure.
- [ ] Define typed extension points for symbolic decisions, values, state changes, and observations. Preserve normal evaluation order and abrupt completions.
- [ ] Audit specification operations and intrinsics implemented in host TypeScript. An override of guest syntax cannot make their concrete tests and native operations symbolic.
- [x] Keep an unmodified engine available for independent comparisons. Run concrete checks against the extended engine too, not only the published CLI.
- [ ] Expand Test262 coverage using pinned selections and bounded workers. Preserve existing failures and distinguish expected exceptions from crashes and harness failures.
- [ ] Test agent/realm isolation, reentrancy, overlapping requests, cancellation, deadlines, and cleanup failures.
- [ ] Define CPU, memory, source-size, recursion, and queue limits. Node-count limits do not bound a single expensive operation.
- [x] Remove the current temporary bundle loader once the replacement passes the same tests.

Completion check: CI builds the extension from pinned sources. Concrete execution preserves the recorded baseline, and the symbolic tests no longer depend on bundle string matching.

## 2. Load real application code

- [ ] Integrate the existing resolver/build work without discarding its independent native comparisons or historical failures.
- [ ] Preserve caller root, entrypoint, workspace ownership, native configuration, conditions, transforms, and virtual-module identities. Keep configuration execution opt-in.
- [x] Select and document the first executable artifact path: caller-supplied native-built JavaScript chunks with canonical URLs. Native Vite owns fixture transforms; no analyzer compiler is used.
- [x] Connect supplied JavaScript artifacts to engine262's module APIs. Test live bindings, cycles, re-exports, module singletons, dynamic imports, and top-level await. Native-built entry and dynamic chunks also match an independent Node process.
- [ ] Support the selected output formats deliberately. Handle CommonJS and bundler runtimes through their actual semantics rather than guessed export objects.
- [ ] Resolve runtime chunk URLs and transformed asset references. Distinguish JavaScript modules, styles, data, assets, workers, and external boundaries.
- [ ] Preserve source maps, module/export identity, original diagnostics, and cleanup failures.
- [ ] Reject missing runtime dependencies and unsupported resource protocols. A complete-looking module graph must not hide an unexecutable entrypoint.

Completion check: a native-built module fixture and its dynamic chunk execute inside engine262. Native execution independently confirms imports, exports, errors, and module identity. Connect the full demo after its host APIs exist in stage 3. Browser bootstrap loading remains distinct from component-entry loading.

## 3. Run concrete React through engine262

The first check uses React's own test renderer, not a custom host configuration. It covers selected concrete state, effects, keys, class errors, stores, transitions, and development Strict Mode behavior. A later fixture uses actual React DOM with guest-owned LinkeDOM and matches V8 and Chromium counter observations. The broader DOM/browser tasks below remain open.

- [ ] Load actual React, its JSX runtime, React DOM, and the application into the same managed execution system. Prevent duplicate React instances.
- [ ] Provide an explicit DOM/browser adapter. Choose and pin its implementation; distinguish a DOM emulator from a real browser.
- [ ] Define the host bridge for objects, functions, callbacks, prototypes, identity, and exceptions. Application callbacks must return to engine execution, not host-evaluated copies.
- [ ] Implement the host capabilities required by the first fixtures: DOM operations, events, timers, microtasks, and React's scheduling transport.
- [ ] Render a component, nested components, and a stateful counter. Test functional state updates, batching, event dispatch, and unmount cleanup.
- [ ] Add context/providers, reducers, refs, effects, memoization, keys, class lifecycles, error boundaries, and Strict Mode fixtures.
- [ ] Extend the React feature matrix to layout/insertion effects, imperative handles, portals, stable IDs, external stores, transitions, deferred values, resource reads, and action/optimistic state. Implement their required host behavior or report each capability as unsupported.
- [ ] Add concrete lazy loading and Suspense once module loading and job ordering support them.
- [ ] Observe commits, DOM output, fiber identity, lifecycle order, and update causes without invoking getters or causing extra renders.
- [ ] Compare with independently executed native React under the same version, inputs, actions, and host policy. Use browser checks for browser-dependent behavior.

Completion check: the demo mounts and responds to supported interactions through engine262. Values, DOM output, commits, and cleanup match native observations. Hooks are supplied by React, not an analyzer reimplementation.

## 4. General symbolic values and conditions

- [x] Lift finite guarded scalar alternatives through the existing engine operations, with Boolean inputs, correlation checks, and independent concrete comparisons. This is a bounded first increment, not completion of the general-value tasks below.
- [ ] Replace the Boolean-token-only contract with explicit abstract values and expressions integrated with engine execution.
- [ ] Define constants, inputs, operations, conditional values, references, and explicit unknown results. Share repeated expressions instead of copying entire alternative trees.
- [ ] Carry over useful guard normalization, contradiction checks, numeric constraints, string constraints, membership, and witness generation from #115.
- [ ] Lift arithmetic, equality, comparisons, `typeof`, negation, and conversions. Preserve JavaScript rules for strings, BigInts, Symbols, `NaN`, infinities, and negative zero.
- [ ] Track abstract support for built-ins such as Math, String, Array, RegExp, Date, JSON, and collection operations. Reuse engine implementations; any abstract summary needs an explicit contract and differential tests.
- [ ] Extend `if`/`else`, ternaries, short-circuit operators, nullish operators, optional chaining, and `switch` without changing evaluation order.
- [ ] Preserve repeated-condition correlation and guarded normal/throw outcomes. Extend return, break, continue, and `try`/`catch`/`finally` as statement execution expands.
- [ ] Keep effectful coercion, calls, and property access blocked until stage 5 can isolate their state changes.
- [ ] Remove syntax restrictions only when the corresponding engine semantics and regression tests exist. Never let an opaque token silently behave like an ordinary object.

Completion check: unknown numeric and string inputs remain expressions through supported operations. Concrete substitutions reproduce values and exceptions in unmodified engine262, including repeated and contradictory conditions.

## 5. Isolate and merge branch state

This is the main gap between the current conditional evaluator and a symbolic JavaScript engine. Evaluating both branches against the same mutable heap is incorrect. The [completion checklist](docs/symbolic-react-status.md) maps the remaining React requirements to current artifacts.

- [x] Add engine-owned checkpoints for explicitly selected ordinary objects, with ownership, descriptor/order preservation, nested restoration, and garbage-collection roots. [The contract](docs/object-checkpoints.md) excludes captured bindings, unselected objects, jobs, and continuations. This does not complete branch isolation.
- [x] Add [combined checkpoints](docs/state-checkpoints.md) for selected ordinary objects and declarative/function bindings, preserving cell identity, initialization, flags, aliases, and ownership. Module state, disposal, jobs, and continuations remain excluded.
- [x] Lower engine algorithm generators into [explicit control frames](docs/control-continuations.md). Verify native completion behavior and actual engine resumption with selected state, without prefix replay. Whole-realm ownership remains missing.
- [x] Coordinate registered evaluator control, decision identity, and saved roots with [Agent evaluation checkpoints](docs/evaluation-checkpoints.md). Selected-state fixtures resume both branch orders without replay. Transitive ownership and checkpoints across separate evaluations remain missing.
- [ ] Inventory mutable engine and host state. Define ownership for objects, environments, module bindings, execution records, internal collections, jobs, and external handles.
- [x] Add bounded [closed guest-data graph checkpoints](docs/data-graph-checkpoints.md), following supported references and rejecting unsupported reachable state. Verify Agent-controlled forks with aliases and one prefix execution. Functions, intrinsic prototype graphs, environments, jobs, and general React ownership remain excluded.
- [x] Verify storage capture inside the owner callback and [inspect an actual React suspension](docs/react-checkpoint-audit.md). Queue/update property capture succeeds. The constructor restriction found there is addressed below; broader ownership still rejects. Failed capture preserves the decision and native results, not React branch isolation.
- [x] Preserve [selected constructor-tracking lists](docs/constructor-checkpoints.md), original identities, ordered references, and live/saved roots. Actual React fiber/queue/update property capture succeeds inside the owner callback, but general ownership and React rollback remain unimplemented.
- [x] Restore [selected builtin function properties](docs/builtin-checkpoints.md) with canonical methods, shared creation slot definitions, and read-only metadata. Verify Agent branches and intrinsic Object.is capture in actual React. Native captures, additional slot records, and transitive intrinsic ownership remain unimplemented.
- [x] Restore [selected global environments](docs/global-checkpoints.md) through existing backing-object and declarative-binding snapshots, with read-only metadata and same-Agent validation. Verify both Agent branch orders without prefix replay. Referenced closures, modules, intrinsics, and host work remain separately owned.
- [ ] Choose checkpoint/journal or persistent-state mechanisms that preserve object identity and aliases. Do not use JSON or generic deep cloning as a heap snapshot.
- [ ] Define branch continuation and resumption behavior, including exception unwinding and `finally`. Do not assume a suspended host generator can be cloned or that heap restoration also restores execution.
- [x] Add [selected array restoration](docs/array-checkpoints.md) to the combined checkpoint, preserving identity, holes, length descriptors, integrity, and saved roots. This does not include unselected elements, iterators, or transitive React ownership.
- [ ] Isolate variable assignments, captured bindings, allocations, arrays, property presence/order, deletion, descriptors, prototypes, and object integrity changes.
- [x] Add [selected Map/Set restoration](docs/collection-checkpoints.md), preserving internal lists, Map entry identities, insertion order, and saved roots. Unselected entries and iterator positions do not rewind.
- [ ] Cover internal-slot mutations for supported Maps, Sets, iterators, generators, Promises, typed arrays, and buffers. Keep unsupported categories explicit. Selected Map/Set storage alone does not complete ownership.
- [x] Restore [selected ECMAScript and bound function properties](docs/function-checkpoints.md) while retaining read-only metadata and function identity. Captured environments and bound objects still require separate selection. This does not establish transitive function ownership.
- [ ] Evaluate actual functions, closures, methods, constructors, classes, getters, setters, and proxies through engine262. Preserve receiver identity, exceptions, and side effects.
- [ ] Handle unknown property keys and conditional object identities without inventing missing properties or conflating distinct allocations.
- [ ] Merge normal and abrupt paths into guarded values and effects. Preserve mutations made before a throw, return, or other abrupt completion.
- [ ] Journal or isolate host-visible writes, callback registrations, timers, and queued jobs before permitting them on symbolic paths.
- [ ] Reject or defer irreversible external effects. Exploring both alternatives must not perform both alternatives' real network, filesystem, or other external writes.
- [ ] Define commit, rollback, nested fork, abandonment, and disposal behavior. Prevent one branch or request from retaining another's writes or resources.
- [ ] Port the old mutation, aliasing, closure, descriptor, scope, and completion regressions against this new state model.

Completion check: an unknown condition mutates an object through two aliases and a captured variable. Each concretized branch matches the independent engine, the common prefix executes once, and reversing branch visitation does not change the result.

## 6. Build symbolic React trees

- [ ] Run supported symbolic inputs through the concrete React integration. React must retain responsibility for hooks, reconciliation, and lifecycle behavior.
- [ ] Isolate React's mutable runtime state, fibers, hook queues, refs, context, module state, and host DOM writes. Do not share mutable native wrappers across alternatives.
- [ ] Adapt #115's output representation for elements, components, text, fragments, conditional branches, shared subtrees, and explicit unknown nodes.
- [ ] Preserve props, children, keys, sibling order, component identity, source locations, input provenance, and guard relationships.
- [ ] Observe committed output separately from render attempts, abandoned work, errors, and Suspense fallbacks.
- [ ] Preserve state across hidden branches when React preserves the component. Reset state only when real reconciliation remounts it.
- [ ] Track correlations between conditional labels, conditional children, and state-dependent props. Do not combine individually possible nodes into an impossible UI.
- [ ] Capture observations without executing guest getters, invoking components again, or mutating the engine state.
- [ ] Serialize shared identities and guards deterministically. Define compatibility/versioning for the report format.

Completion check: one unknown prop selects different real React subtrees. The guarded tree specializes to the independently rendered output for each input, with correct keys, state identity, and provenance.

## 7. Events, effects, and asynchronous transitions

- [ ] Define a transition record containing the source state, trigger, guard, state changes, destination state, and commit cause.
- [ ] Invoke actual event handlers with declared event payloads. Preserve functional updater order, reducer actions, batching, and render-phase update behavior.
- [ ] Preserve synchronous mutations and scheduling during effect setup and cleanup, including updates across components.
- [ ] Integrate engine Promise jobs, async/await, timers, cancellation, and React scheduling with branch-owned state. Preserve job ordering and callback identity.
- [ ] Model network responses, routes, storage, time, randomness, viewport, and external stores as explicit inputs or declared host operations. Do not fabricate successful responses.
- [ ] Connect dynamic imports and asynchronous data to Suspense, retries, resolved output, rejection, and error boundaries.
- [ ] Track pending, canceled, abandoned, and completed work. Define the observation point instead of assuming every application reaches an idle state.
- [ ] Report unsupported scheduling behavior, outstanding work, and queue/deadline exhaustion without claiming a settled render.

Completion check: engine and native runs agree on event-driven state updates, Promise/timer ordering, effect cleanup, lazy resolution, and failures for the declared scheduling policy. Transitions explain which action caused each commit.

## 8. Repetition, state families, and queries

- [ ] Represent symbolic collection lengths, elements, keys, and index relationships. Adapt the old repeat/cardinality representation where it fits engine-produced output.
- [ ] Preserve concrete loop semantics through engine262. Add summaries for supported symbolic loops and recursive calls rather than unrolling without a limit.
- [ ] Define when repeated states can be merged. Equality must account for observable state, identity, pending work, and scheduling context, not only equal DOM output.
- [ ] Add fixed-point or widening rules where repeated transitions would otherwise grow indefinitely. Record any loss of precision and the affected domain.
- [ ] Represent counter-like state families and transitions without enumerating every reachable count. Retain JavaScript numeric semantics rather than assuming mathematical integers.
- [ ] Extend constraint solving and witness generation only for supported domains. An unknown solver result is not proof that a path is impossible.
- [ ] Add assertions over UI, state, and transitions, with the input domain and exploration bounds attached.
- [ ] Replay proposed violations against independent concrete execution. Distinguish confirmed counterexamples, possible violations, bounded passes, and justified exhaustive results.

Completion check: a repeated list is represented without choosing one arbitrary length. A counter is represented as a state family with updates, not a finite list mislabeled as complete. Incomplete analysis cannot produce an unqualified “safe” result.

## 9. Demo, API, CLI, corpus, and release gates

- [ ] Connect project loading, engine execution, symbolic state, React observations, and transitions through one package API.
- [ ] Add analysis commands to the normal CLI. Keep build inspection, concrete rendering, and symbolic analysis separate in names and reports.
- [ ] Accept caller-selected entries, inputs, providers, actions, host policy, permissions, and budgets. Do not silently select another application or repair its prerequisites.
- [ ] Provide machine-readable reports and Unicode tree output. Include source diagnostics, unresolved behavior, limits, and completeness status.
- [ ] Record engine/extension hashes, React and toolchain versions, dependency/configuration identity, inputs, seeds, scheduler policy, and selected scenarios.
- [ ] Integrate the Vite + React demo as an end-to-end acceptance fixture, not merely a build-graph fixture.
- [ ] Add independent native differential fixtures for concrete and symbolic behavior. Compare state, output, effects, exceptions, identity, and event/job ordering where observable.
- [ ] Port relevant #115 regressions before broad corpus promotion. Add generated cases and reductions for engine/analysis mismatches.
- [ ] Harvest existing stories, tests, and demos from pinned repositories with source/license provenance. Validate native scenarios before comparing analyzer results.
- [ ] Start with a bounded pilot, then expand the corpus. Keep native setup failures, unsupported behavior, mismatches, timeouts, and successful comparisons separate.
- [ ] Keep build compatibility, runtime loading, resource closure, React rendering, and symbolic coverage as separate measurements.
- [ ] Refresh immutable evidence when producer or acceptance code changes. Preserve previous failures; do not relabel stale receipts or normalize mismatches into passes.
- [ ] Add CI gates for the built engine, concrete baseline, symbolic regressions, native React comparisons, and budget/cleanup failures. Preserve the two-worker policy unless explicitly changed.
- [ ] Measure execution time, memory, branch growth, expression sharing, and state growth. Optimize only with semantic regression coverage.
- [ ] Document supported versions, examples, failure modes, upgrade policy, and remaining gaps. Treat subprocess limits as resource controls, not a security sandbox.

Completion check: the supported demo scenarios run through the package API and CLI on CI, with reproducible native comparisons. Unsupported scenarios remain visible, and a passing build comparison is never counted as symbolic analysis coverage.

## End-to-end demo acceptance

Use the existing demo's actual initial state: count `0`, step `1`, and details hidden. Preserve its semantics throughout analysis.

- [ ] Render its initial UI through real React in engine262.
- [ ] Derive increment and decrement transitions using the selected step of `1`, `2`, or `5`.
- [ ] Derive reset as a count-only update. Preserve the selected step and details visibility.
- [ ] Preserve the relationship between count parity and the rendered label.
- [ ] Preserve the relationship between details visibility, the button label, and the conditional child.
- [ ] Capture lazy details loading, its Suspense fallback, resolution, hide, and cleanup behavior.
- [ ] Reproduce the browser-checked count sequence `0 → 1 → 6 → 0 → −5` with the same interactions.
- [ ] Specialize the symbolic report to those concrete scenarios and compare committed observations independently.
- [ ] Represent additional reachable states with declared summaries or bounds. Do not claim this finite sequence covers all behavior.

```text
App state family: (count = c, step = s, detailsVisible = d)
├── parity label depends on c % 2
├── details subtree and label depend on d
├── increase → (c + s, s, d)
├── decrease → (c - s, s, d)
├── reset    → (0, s, d)
├── select step → (c, selectedStep, d), selectedStep ∈ {1, 2, 5}
└── toggle details → (c, s, !d)
```

Here, `c`, `s`, and `d` describe a later reachable-state family. They do not replace the concrete initial state. The expressions retain JavaScript semantics, and pending lazy work requires additional state beyond these three fields.

## Later runtime targets

The first end-to-end target is browser client rendering. These targets need separate execution contracts and acceptance suites; the initial analyzer must report them as unsupported rather than imply coverage:

- [ ] Server rendering, hydration, and streaming.
- [ ] React Server Components, server actions, and mixed server/client module graphs.
- [ ] React Native, Expo, and native platform host behavior.
- [ ] Workers, shared memory, and cross-agent scheduling.
- [ ] Framework-specific runtime behavior beyond the validated client entrypoint and loader contracts.

Do not block the browser demo on these targets. Do not label a successful bundler adapter as support for their runtime semantics.

## First implementation PRs after this roadmap

1. Add symbolic scalar expressions and guard constraints without enabling unisolated side effects.
2. Prove engine-owned branch isolation with aliasing, closures, and guarded exceptions.
3. In parallel, integrate native artifacts and prove concrete React mounting and updates.
4. Combine those tracks for the first guarded React tree, then add event-driven transitions.

Keep the scope of each PR explicit. Check off a task only when its implementation and acceptance evidence exist, not when its representation or tests have been copied.
