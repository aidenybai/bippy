# Engine control continuations

The maintained build now lowers engine262’s host generators into explicit control frames. Engine262 still evaluates application JavaScript. This change does not compile applications into a second interpreter or replace React hooks.

## Build and runtime

`engine/scripts/lower-generators.ts` runs after upstream completion macros, TypeScript removal, and decorators. Pinned Babel transforms handle parameters, destructuring, loops, block scope, and generator lowering. The build composes source maps across these steps.

`engine/extensions/execution-machine.mts` drives the resulting program counters, activation-local records, delegated frames, and completion handlers. Normal execution can delegate to foreign iterators. Control capture rejects foreign delegates because it cannot snapshot their execution state.

The build instruments supported native closures with lazy capture metadata. `native-captures.mts` attaches that metadata through a private brand without changing function identity, own keys, prototypes, or integrity. Source methods and computed-name closures without metadata remain outside the capture contract. Metadata describes direct captures and ambient names, not a complete state-ownership policy.

The implementation reuses existing control work from the separate development worktree. It does not import that worktree’s application interpreter, React emulation, generic heap owner, or tail-call extensions. The maintained upstream revision remains `a600354c2954300d62d108bf9ed3459a8e4a289b`.

## Capturing control

`captureControl(iterator, owner)` captures lowered frames while execution is suspended or has not started. It preserves:

- Program counters and activation locals.
- Delegation state and caller links.
- Pending return, throw, jump, and finally completions.
- Direct mutable native captures and read-only capture identities.
- Referenced creator frames, including completed creators whose locals remain captured.

The mandatory owner receives root values, ambient names, and control-owned objects. Its synchronous `capture()` must return a restoration operation. Its optional `references()` method can discover additional owned state. The owner must capture mutable external state or reject it. Supplying an empty restoration callback does not establish heap isolation.

Capture and restore reject active execution or reentrant capture. They reject overridden continuation methods, accessor locals, and immutable local records. Restore validates these conditions before writing control state. Read-only captures must still have their saved identities.

Restore reinstates captured cells and control before invoking the owner’s restoration operation. If that mutation phase fails, captured continuations become poisoned. Abandon the affected analysis because external state may be partially restored. Validation failures before mutation do not poison control.

The control API has no native frame, root, or capture-work budget. Syntax-step limits do not bound this work. Enforce external process limits where needed. The API is not a sandbox.

A control checkpoint does not have an independent branch heap. Previously returned objects and escaped callbacks can still refer to shared state after restoration. Manage the external owner’s lifecycle and discard control checkpoints when they are no longer needed.

## Verification

The increment adds 69 tests:

- `tests/control-machine.test.ts`: 20 native generator comparisons and 20,000 delegated frames without native stack recursion.
- `tests/control-checkpoint.test.ts`: 26 capture, completion, identity, rejection, and poisoning checks, including an actual engine expression continuation.
- `tests/native-captures.test.ts`: 18 metadata checks, including class-field/static-block receiver boundaries and outer receivers in computed keys.
- `tests/engine-control-state.test.ts`: three checks for measured engine execution and selected state across resumed branches.
- `tests/source-engine.test.ts`: one added check that the CLI executes in one process.

The selected-state fixture suspends actual `ScriptEvaluation` at `debugger`. It captures selected objects, global lexical bindings, and the execution-context stack through a fixture-specific owner. It then resumes supplied Boolean combinations in both orders. Return/throw values, finally mutations, aliases, and prefix observations match fresh V8 and published-engine executions. The prefix observer runs once.

This fixture verifies resumption without prefix replay. It does not declare unknown inputs or build a symbolic report. The native callback-array fixture is not an engine job-queue implementation.

## Remaining ownership gaps

There is no general engine-state owner. Selected object/binding checkpoints do not cover all internal collections, execution records, module state, jobs, host resources, or external effects. Control-local values also need proper engine GC roots. Direct closure metadata alone does not solve transitive ownership.

Native analyzer generator hooks are foreign continuations unless they are lowered through this machinery. Abstract decisions must not enter an opaque delegate and then pretend it is forkable. Unsupported coercions and operations must fail visibly rather than treating abstract values as ordinary truthy objects.

Numeric/string domains, guarded state joins, symbolic React trees, and transitions remain missing. The [completion checklist](symbolic-react-status.md) keeps those requirements separate from this control increment.

## CLI termination

The previous `tsx` executable started a child Node process. The harness killed the launcher on timeout, leaving the evaluator alive. The new tail-call timeouts exposed this adapter bug. Six surviving processes were identified by PID and working directory, then killed. Earlier timeout runs remain recorded but are not process-isolation evidence.

The executable now starts `node --import tsx` directly. TypeScript loading still uses tsx, but the harness owns the evaluator PID. A preload-based test checks that only one process executes. A repeated historical run retains its timeout failures and leaves no evaluator process behind. The harness still uses two workers and its original 10-second timeout.

## Provenance and gates

[Validation receipts](control-validation/summary.json) record source hashes, input comparisons, failures, corrected runs, and raw logs.

[The first Linux run](control-validation/ci-failure.json) passed 889/890 tests. Its first checkpoint case exceeded the five-second unit timeout during cold loading. The Test262 step did not run; other CI jobs passed. Vitest had transformed the already-built engine inside the test process. The test configuration now loads that artifact directly through Node. A native module-namespace assertion fails with the old configuration and passes with the correction. All 890 tests pass locally after the change. No unit or Test262 timeout changed. [The next Linux run](control-validation/ci-smoke-failure.json) passes all 890 unit tests but fails the unchanged smoke at 72/74. Both numeric `substr` variants time out. Diagnostic profiling takes 14398.57 ms with default flags and 14943.93 ms without Maglev. These diagnostic runs do not change the failed gate result. Control-runtime performance work remains open.

`engine/extensions/` is part of the build identity. The build checks its TypeScript, bundles it with engine262, and emits `CONTROL-LICENSE`. Completion dispatch retains Babel/Facebook MIT attribution. New direct Babel dependencies are exact versions, and unrelated lockfile resolutions remain unchanged.

The full local suite passes 890 tests across 21 files. The unchanged smoke passes 74/74. The parameter/arguments selection retains 557/559 verdicts. The historical selection retains 301/306, but its three tail-call failures now time out rather than overflowing the native stack. No timeout changed. An additional 212 generator variants pass in both source-built and published engines, with identical input and compiled hashes. Relocated clean builds match engine SHA-256 `cf0fd5f77326b740c6d0da56739e39ad9c770eb9e2a4b195a2430f3dd7980662`.
