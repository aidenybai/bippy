# Caller-owned Boolean snapshot exploration

`createBooleanSnapshotExplorer()` supplies a checkpoint driver for one registered engine evaluation. It forks opaque Boolean decisions without replaying their shared prefix. A synchronous caller-provided observer converts completed paths into the existing [guarded host-tree report](guarded-host-tree-reports.md).

This is a low-level integration API for callers already using the source-built engine. It does not load an application, select a React root, provide a state owner, or verify committed React output. Every report keeps `execution` and `coverage` set to `not-verified`.

## Inputs and ownership

Create the explorer asynchronously, then call its synchronous `explore(options)` method. Register an evaluator on the supplied source-built `Agent` before exploration. The driver resumes that evaluation; it does not start replacement evaluations or drain jobs.

Supply these fields:

- `agent`: the Agent with the registered evaluation.
- `inputs`: up to 128 distinct opaque engine Booleans, each with a unique report input name.
- `createOwner`: a synchronous factory returning a `ContinuationStateOwner` plus `release()`.
- `observe`: a synchronous callback receiving the original value in a normalized normal or throw completion. Return a commit snapshot string or a report diagnostic.

The driver calls `Agent.captureEvaluation(owner)` at each new input decision. The owner must account for all mutable state reachable from that checkpoint. This includes guest storage, native referents, context-stack membership, callbacks, and pending work. Capture metadata and selected snapshots do not establish that ownership.

An explicit negative test supplies only context-stack restoration and omits guest storage. Its false branch reports `1` instead of native `0` after the true branch. The report remains unverified. The driver cannot certify an arbitrary owner; this counterexample is not accepted React isolation.

## Traversal and lifetime

The prefix runs once, before the first checkpoint. Its effects are not rolled back. The driver matches later decisions by exact Boolean identity, reuses known choices, and adds guards only for new inputs. It visits false before true unless `trueFirst` is enabled. Unused inputs remain unconstrained.

On healthy completion of a fork, the driver restores that fork’s paused state, then releases its evaluation checkpoint and owner. Nested snapshots release in last-in-first-out order. After healthy exploration with a fork, the Agent remains paused at the first fork. A concrete evaluation with no fork finishes normally. A budget or unsupported result before any fork can leave the evaluation at its current pause.

Owner admission, restore, observer, host, and report-builder failures abort traversal. The driver returns no partial report. It attempts checkpoint and owner release, preserves the original failure, and aggregates additional cleanup failures. Failure cleanup does not promise rollback or safe Agent reuse. Discard a poisoned Agent; do not resume it to obtain sibling results.

The driver restores the surrounding Agent and prevents same-Agent exploration reentrancy, including through option getters. Callbacks, metadata, native getters, proxies, and direct Agent access remain trusted, not sandboxed. Observers must not start another evaluation on the same Agent. Existing completion callbacks still run at every terminal path and need their own ownership policy.

The driver retains each normalized completion through observation and outcome copying with [scoped GC roots](scoped-gc-roots.md). This covers no-fork results after Agent notification roots end. Roots release on return or failure. Other native values held by an observer still need declared roots; retention does not verify serialization or ownership.

## Limits and unsupported paths

`maxForks` defaults to 127 and accepts integers from 0 through 255. `maxResumes` defaults to 10,000 and accepts integers from 0 through 1,000,000. Counters apply to the entire traversal and do not rewind. The frozen `exploration` metadata records both limits, actual counters, branch order, and unverified ownership. Zero resumes returns an incomplete root guard without execution.

When either counter prevents progress, the driver emits an `incomplete` diagnostic for the remaining guard. An undeclared Boolean or non-Boolean suspension produces an `unsupported` diagnostic without guessing a choice. These records are not empty commits or coverage proofs.

These limits bound driver operations, not concrete execution time. Use an Agent with an execution budget, such as the concrete runtime’s syntax-node budget. A single resume, native operation, capture, callback, parser, allocation, or garbage collection can do work outside driver counters. The driver adds no wall-clock cancellation or memory isolation.

`reportOptions` uses the report builder’s existing limits. The driver copies each observer outcome immediately and validates the accumulated report after each observation. Report-budget failure throws without partial output. Revalidation can repeat report-building work; it is not a constant-time operation.

The driver handles decisions exposed by the existing engine protocol. It adds no JavaScript interpreter, solver, React reconciler, hook model, or scheduler. Direct opaque `while` conditions still fail the engine’s concrete Boolean read; the bounded-loop witness uses a supported `if` decision inside a concrete loop.

## Verification and React status

The [validation receipts](boolean-snapshot-exploration-validation/summary.json) record 28 focused cases, including both branch orders, repeated decisions, unused inputs, forced collection, limits, reentrancy, and cleanup failures. Two shared-prefix reports use one prefix and three forks each. Their specializations match 16 fresh native executions.

An actual React update reaches an opaque context decision. A rejecting owner then stops capture and receives its release callback before any branch observation. This test does not produce a React tree or bypass the missing owner. React Test Renderer’s `toJSON` omits hidden instances and separates children from props; the observer remains responsible for snapshot meaning and serialization.

The public-export predecessor fails all 28 cases because the API is absent. That baseline proves missing integration, not an engine semantic regression. Final local verification passes 2,143 tests across 79 files, typecheck, relocated builds, and the unchanged 74-case smoke gate. Engine bytes remain unchanged from `3e102175`.

General React ownership, guarded event/effect transitions, repeated-state families, automatic report production, and demo integration remain incomplete.
