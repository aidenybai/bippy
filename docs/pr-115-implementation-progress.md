# Execution-model refactor: implementation status

Baseline: `ce841290`. The [implementation plan](./pr-115-implementation-plan.md) is **partially implemented**, not complete. Real React, public renderer calls, and the serialized fiber-pattern format remain in place.

The implemented contracts and remaining semantic boundaries are described in [`packages/bippy-analyzer/docs/execution-contracts.md`](../packages/bippy-analyzer/docs/execution-contracts.md).

## Implemented

The changes cover these execution contracts:

- Assignment-sensitive native differential assertions for one combined analysis, including return/throw outcomes, selected stores, and callback traces. The oracle rejects swapped outcomes even when their sets agree.
- Guarded nullish fallback evaluation and primitive-method argument distribution. String replacement callbacks now preserve conditional writes, throws, match order, capture arguments, and named groups. Native lifting preserves null prototypes.
- Stable unresolved-binding identity per module, environment, and interpreter run. Repeated reads no longer manufacture independent inputs. Existing resolved bindings still take precedence.
- Guard contexts carry input declarations through forks and continuations, including tasks whose own condition adds no new inputs.
- Captured lexical bindings outside the caller's scope snapshots participate in heap journals, including activation scopes retained by locally created closures. Internal failures restore entry state and unwind journal/guard stacks.
- Mixed live/exited statement paths continue only from their fallthrough state. Nested returns no longer permit later writes to contaminate the returned path.
- Narrowing retains the original alternative guards and input declarations. Filtering a compound Boolean value no longer invents an independent choice.
- Ordinary property descriptors retain data/accessor kind, getter/setter identity, flags, and receivers through writes and joins. Descriptor conversion runs getters and proxy presence traps in field order; bulk definitions finish conversion before committing any property.
- Proxy `has` and `defineProperty` traps run through guarded continuations. Supported ordinary-target invariants reject incompatible claims while retaining writes made by the trap.
- Ordinary-object freeze, seal, and extensibility state participates in heap snapshots, nested joins, task mutations, and internal-error rollback. Descriptor flags and strict writes/deletes respect the selected integrity state. Frozen status is derived from extensibility and current properties, rather than only whether `freeze` was called.
- Ordinary-object enumeration preserves numeric and conditional insertion order. It snapshots keys, rechecks descriptors after earlier getters, and reads through the original receiver.
- Object and JSX spreads execute getters and copy enumerable values into writable data properties. Supported `Object.assign` paths interleave source getters and strict target assignments, retaining earlier writes when a later read or setter throws.
- JSX resolves its factory and type before attributes and children. Conditional throws stop later arguments without rendering unused components. The native differential oracle now supports JSX through real React.
- Explicit queued task identity, parent, registration cause, cancellation handle, and journaled consumption. Sibling paths can still execute a task another path consumed. Microtask checkpoints are bounded and timers cannot overtake remaining microtasks.
- Queued function invocations start fresh call stacks and per-entry step budgets without losing captured scopes or guards. Native differential checks cover 150/151-callback microtask and promise chains; lower-budget controls retain synchronous depth and step limits.
- Pending-work diagnostics use the observation point before harness disposal. Cleanup-created work no longer creates a false settling warning, and cleanup cancellation cannot hide work left pending at the bound.
- Incremental async completion/resumption fixes: concise arrows, suspended catches and finalizers, mixed synchronous/suspended paths, and conditional settlement. `if`, `void`, and throw operands propagate abrupt completion.
- Render-owned effect registrations. Function proxies bind individual registrations to real React layout/passive hooks, preserving cleanup-before-setup order across components. Dependency tokens come from committed registrations and retain bailout behavior. Class proxies keep separate committed phase records. Suspended attempts cannot overwrite active cleanups.
- Hook-state and memo unwinding when an evaluated component pass throws, or a descendant suspends and abandons its completed pass. Scoped checkpoints also handle prewarmed siblings. Incoming updates, shared-object writes, and external work remain; tested later state/reducer queue writes survive discard. Concrete modeled promises use real wakeables rather than an independent fallback choice.
- Separate state-update presence from value, preserving a conditional no-update path across discard. External no-ops remain queued without scheduling a render. Reducer rebasing retains incoming and later actions, but not discarded render-phase actions.
- Shared run-local output input renaming across marker metadata, commit causes, and pattern reading. Four renderer-reuse expected failures now pass.
- An internal bounded isolated-assignment runner for entry and component histories with primitive imported inputs. Each assignment reruns source with fresh modeled state and real React. It rejects preexisting external providers and pinned decisions and promises only `modeled-state` isolation.

Existing divergence tests were converted to native-equivalence assertions only where the implementation now matches native behavior. Tests for remaining gaps retain explicit native expectations and divergence assertions.

## Scheduler regression found and fixed

The first full component run timed out on `compiled-tslib-async.js`; its outstanding React `act()` work contaminated later tests. An isolated original-revision run passed in roughly 9–14 seconds, while the initial refactor took over 200 seconds.

CPU sampling and a temporary probe isolated the new queue wrapper. It was adding a second application-mutation fork without the callback's captured hook frame. Bound timer/promise handlers already perform guarded mutation with that frame. The queue now enters the registration cause without adding that redundant fork. The fixture returned to about nine seconds, and subsequent complete component runs passed all 581 fixtures.

Removing the redundant wrapper also exposed missing inherited input declarations in the default task runner. That defect is fixed and has a direct regression test, as well as guarded-outcome and renderer differential tests.

## Abandoned-render regressions found and fixed

A component registered new effects and then suspended. The proxy’s cleanup read the mutable frame’s new registrations, losing the committed cleanup functions. Each evaluated pass now retains its effect records, and each native function-effect setup captures its cleanup value. The native fixture covers both direct suspension and suspension in a descendant, followed by reconnection and removal.

The same fixture exposed render-phase state updates and memo values surviving a thrown pass. Native React resumed with state `0` and the original memo object; the analyzer resumed with state `1` and a replacement object. Hook metadata now restores on that failure without reverting ordinary JavaScript writes. The fixture passes its original exactness assertion, including zero non-transition decisions.

A second fixture exposed interleaved sibling cleanup/setup calls. Function effects now bind individually to React hooks, so React orders the whole phase. The fixture includes cleanup-created microtasks and both synchronous and timer-driven commits. The first full run caught a reducer-bailout regression: reusing an evaluated pass must also reuse dependency tokens for effects without dependencies. The original assertion passes after that correction.

A further native fixture exposed state and memo changes retained by a parent whose child suspended: the model resumed with `1:false:true`, while React resumed with `0:true:true` (state, memo identity, shared-ref write). Completed passes now keep discardable checkpoints until React accepts them. Suspense scopes discard pending work in the affected subtree, including completed siblings under nested boundaries, without discarding ancestors outside that boundary.

React also prewarms siblings after the first suspension. The tail sibling exposed the same leak after the first discard had already happened. Boundary re-entry now discards those leftover attempts. The fixture retains exact assertions for basic recovery, nested boundaries, prewarmed tails, cleanup-created updates, later timer updates, and surviving ref writes.

This follows the pinned React work loop’s handling of ordinary thrown wakeables (`SuspendedOnDeprecatedThrowPromise` and `throwAndUnwindWorkLoop`); it does not add a scheduler or take over lifecycle effects. Non-Suspense abandonment, further interrupted queue histories, guarded dependencies, and other hook edge cases remain unfinished.

Three queue regressions followed:

- A conditional update joined `5` with the abandoned render’s `1`, using `1` as a substitute for no update. After restoring base state `0`, the no-update path still produced `1`. Queues now journal presence separately from value. The native fixture resumes with `0`; guarded unit checks retain `5` only on the selecting path and reverse branch order as a control.
- React retains an eager no-op update for later rebasing without scheduling a render. Dropping it made a prewarmed sibling resume with `0` rather than native `1`. The queue now retains it. An unconditional no-op also removes uncertainty left by an earlier conditional registration; the exact fixture still requires zero decisions.
- Restoring only the later reducer queue lost its incoming action. Incoming `+2`, a discarded render-phase `+1`, and later `+4` must yield `6`, not `4`. The checkpoint now rebases the incoming and later queues. Unit assertions check the resulting action order.

## Task entry and disposal boundaries

The effect-phase fixture also exposed a false settling warning: final harness cleanup queued a microtask after snapshot capture. Conversely, disposal could cancel pending work and hide exhaustion of the settling bound. `mountNode` now records pending work with the snapshot rather than checking the mutated queue after unmount.

The cancellation regression then exposed a separate task-entry defect. A self-scheduling callback inherited earlier callbacks’ call stacks and reached the synchronous depth limit. Native microtask and promise-chain controls reached 150/151 calls; the model stopped at 127. Function invocation now checks the active modeled task identity before reusing a stack or step budget. Synchronous recursion and long callback bodies still hit their original bounds.

The first disposal probe used an empty interval, which the existing interval model treats as quiescent. That program remains a control; a self-rescheduling timeout tests genuinely pending queue work. No limits were increased.

## Quality-audit follow-up

An await continuation retained its registration-time context. Each synchronous call from that context could receive a fresh step budget: with a 100-step bound, three calls completed 90 increments after `await`, while the equivalent microtask callback stopped at 31 with `budget-exhausted`. Resumed statement lists now refresh their context, and stale contexts entering the same queued task share one budget. Controls cover successive awaits, finalizers, below-bound work, and a native 150/151-callback await chain. No limits changed.

A reused hook checkpoint could lose an external update consumed by a later pass. The checkpoint now records incoming updates before consumption, retaining them across repeated successful or throwing retries. Tests cover conditional presence, reducer action order, and checkpoint ownership. This regression is established at the hook-helper level, not by a new native React fixture; the existing 587 component fixtures still pass. The queue handling was checked against `ReactFiberHooks.js` at `v19.2.4`, including base-queue preservation and render-phase unwind.

The cleanup shares pending-update payloads and capture/restore helpers without merging journal and render rollback policies. Property-reading capabilities use one interface, enumeration accepts only supported operation names, and architecture checks include the four extracted property modules. The new short input identifier was renamed.

## Remaining plan work

| Phase | Remaining work                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Broader execution/commit measurements beyond the fixed timing/memory runs and targeted CPU profile.                                                                                                 |
| 1     | Finish the effectful-transform audit; the migrated sites are not a claim that every builtin is effect-safe.                                                                                         |
| 2     | Repeated noncached dynamic equality still has precision gaps; broader identity/derivation auditing remains.                                                                                         |
| 3     | Integrity on arrays, functions, classes, and native targets remains limited. Prototype changes, backing-storage aliases, and enumeration/copy protocols on other target families need further work. |
| 4     | A full outcome-record migration and general suspension support remain. Arbitrary await expressions, asynchronous loops, and generator suspension are not implemented by these changes.              |
| 5     | Audit remaining task-producing host/library models against the queue contract; the scheduler still uses the existing bounded settling policy.                                                       |
| 6     | Audit non-Suspense abandonment, further interrupted queue histories, and remaining hook edge cases. Native-global/process isolation and automatic history discovery are not implemented.            |
| 7     | Complete collection-summary and unsupported external-operation contracts. Unknown calls do not yet have complete effect summaries.                                                                  |
| 8     | Further optimization is conditional on measurements. No persistent heap, shadow interpreter, or speculative memoization was added.                                                                  |

The direct-tree backend remains deferred, as the plan requires until there is a concrete consumer and a measured reason to build it.

## Validation and research artifacts

React source was cloned at `/tmp/react-bippy-execution-refactor`, checked out at `v19.2.4`, and inspected for reconciliation and effect behavior.

Validation commands:

```sh
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test --exclude 'tests/components.test.ts' --maxWorkers=6
pnpm --filter bippy-analyzer test tests/components.test.ts
git diff --check
```

The quality-audit follow-up passed:

- **15,004 tests in 353 non-component files** (`/tmp/bippy-quality-fixes-suite.log`).
- **587 React fixtures** (`/tmp/bippy-quality-fixes-components.log`).
- **15,591 tests in 354 files under V8 coverage**, with no failed or unrun assertions (`/tmp/bippy-quality-fixes-coverage.log`).
- Typechecking, touched-file lint, formatting, and `git diff --check`.

The strict compatibility report still exits 1: 14,231 ordinary passing assertions, 1,360 explicit known-defect assertions, and 232 incompletely covered source files. No test or source files are missing. Statement/branch/function/line coverage is 84.24% / 74.49% / 86.33% / 87.01%. The saved report is `/tmp/bippy-quality-fixes-compatibility-summary.json`. The separate 100%-per-file threshold command and live corpus remain unrun. No performance measurements below validate this follow-up.

The earlier queue-presence/rebasing checkpoint passed:

- **14,991 tests in 353 non-component files** (`/tmp/bippy-state-queues-suite.log`).
- **587 React fixtures** (`/tmp/bippy-state-queues-components.log`).
- **15,578 tests in 354 files under V8 coverage**, with no failed or unrun assertions (`/tmp/bippy-state-queues-coverage.log`).
- Typechecking, touched-file lint, formatting, and `git diff --check`. The hook ownership file contains 17 tests.

That strict compatibility report exited 1: 14,218 ordinary passing assertions, 1,360 explicit known-defect assertions, and 232 incompletely covered source files. No test or source files were missing. Statement/branch/function/line coverage was 84.22% / 74.48% / 86.32% / 87.00%. The saved report is `/tmp/bippy-state-queues-compatibility-summary.json`. Full semantic compatibility, the separate 100%-per-file threshold command, and live-corpus validation remain outstanding.

The earlier task-entry and descendant-Suspense checkpoint, before those queue fixes, passed:

- **14,985 tests in 353 non-component files** (`/tmp/bippy-parent-owner-suite.log`).
- **586 React component fixtures** (`/tmp/bippy-parent-owner-components.log`).
- **15,571 tests in 354 files under V8 coverage**, with no failed or unrun assertions (`/tmp/bippy-parent-owner-coverage.log`).
- Typechecking, formatting, and `git diff --check`. Focused lint exited 0 with two unchanged `no-unsafe-finally` warnings in `mount.ts`.

The fresh strict compatibility report still exited 1: 14,211 ordinary passing assertions, 1,360 explicit known-defect assertions, and 232 incompletely covered source files. No test or source files were missing. Statement/branch/function/line coverage was 84.21% / 74.46% / 86.30% / 86.99%. The saved report is `/tmp/bippy-parent-owner-compatibility-summary.json`. This is not full semantic compatibility; the separate 100%-per-file threshold command and live corpus were not run.

The preceding task-entry checkpoint passed 14,982 non-component tests and 585 fixtures.

The native-effect checkpoint, before the task-entry/disposal changes, passed:

- **14,972 tests in 351 non-component files** (`/tmp/bippy-native-effects-suite2.log`).
- **585 React component fixtures** (`/tmp/bippy-native-effects-components2.log`).
- **15,557 tests under V8 coverage**, with no failures or unrun assertions (`/tmp/bippy-native-effects-coverage.log`).
- Typechecking, touched-file lint, formatting, and `git diff --check`.

The strict compatibility report exited 1: 1,360 labeled defect assertions and 232 incompletely covered source files remain. It found no missing test or source files. Statement/branch/function/line coverage was 84.28% / 74.59% / 86.38% / 87.04%. These are execution counters, not language-compatibility percentages. The saved report is `/tmp/bippy-native-effects-compatibility-summary.json`.

The earlier ownership checkpoint, before individual native effect bindings, passed:

- **14,971 tests in 351 non-component files** (`/tmp/bippy-owner-suite.log`).
- **584 React component fixtures** (`/tmp/bippy-owner-components.log`).
- Typechecking, formatting, and `git diff --check`.

That earlier checkpoint totaled 15,555 passing tests, including tests that retain known divergence assertions. The live corpus has not been run.

The earlier scheduler checkpoint passed:

- **14,889 tests in 343 non-component files** (`/tmp/bippy-execution-suite-7.log`).
- **581 React component fixtures** (`/tmp/bippy-execution-components-5.log`).
- Typechecking, formatting, and `git diff --check`.

That earlier checkpoint totaled 15,470 passing tests.

Three alternating single-worker runs compared the unchanged `compiled-tslib-async.js` fixture with the queue-presence/rebasing checkpoint:

| Measurement               | Original revision   | Queue-presence/rebasing checkpoint |
| ------------------------- | ------------------- | ---------------------------------- |
| Wall time, seconds        | 14.14, 14.17, 14.23 | 2.03, 2.04, 2.06                   |
| Median maximum RSS, bytes | 1,349,074,944       | 377,405,440                        |

All six runs passed. The baseline checkout was clean at `ce841290`, and `cmp` confirmed unchanged fixture contents. These `/usr/bin/time -l` measurements cover whole processes on one fixture. They do not isolate a particular fix or establish corpus-wide performance. Logs are `/tmp/bippy-state-queues-benchmark-{baseline,current}-{1,2,3}.log`. The preceding descendant-Suspense measurements are `/tmp/bippy-parent-owner-benchmark-{baseline,current}-{1,2,3}.log`.

Earlier alternating measurements remain in `/tmp/bippy-tslib-final-{baseline,current}-{1,2,3}.log` (scheduler), `/tmp/bippy-owner-benchmark-{baseline,current}-{1,2,3}.log` (earlier ownership), and `/tmp/bippy-native-effects-benchmark-{baseline,current}-{1,2,3}.log` (native effect bindings). Each set passed all six runs; none measures the current checkpoint.

Other local evidence:

- `/tmp/bippy-execution-baseline`: original revision with linked dependencies.
- `/tmp/bippy-execution-probe`: temporary experimental checkout; not production code.
- `/tmp/bippy-tslib-profile.json`: CPU profile of the scheduler regression.
- `/tmp/bippy-execution-benchmark.log`: three alternating single-worker baseline/refactor runs of existing branch/async suites. Their elapsed time and memory were similar, but these early measurements are not a benchmark of the entire finished patch.
