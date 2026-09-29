# Controlled evaluator checkpoints

`Agent.captureEvaluation(owner)` coordinates lowered control with the Agent’s registered evaluator and pending decision. It requires an explicitly controlled, suspended evaluator and a caller-supplied state owner. It does not supply transitive heap ownership.

## Capture, restore, and release

Register and suspend execution through [Agent-owned decisions](agent-decisions.md), then call `captureEvaluation`. The returned `EvaluationCheckpoint` provides `restore()` and `release()`.

Capture delegates to the existing `captureControl`. It forwards the owner’s `beginCapture`, `references`, and `capture` callbacks. The owner receives control roots plus the evaluator, completion callback, and current idle callbacks. Callback references do not expose native closure captures.

Restoration proceeds in this order:

1. Check the current Agent, lifecycle phase, debugger-preview state, and last-in-first-out (LIFO) order.
2. Restore lowered control and captured bindings through `captureControl`.
3. Run the owner’s restoration through that same control checkpoint.
4. Restore the original evaluator registration, controlled mode, and exact pending-decision record.

A completed evaluator can therefore return to its saved decision without running its prefix again. Completion callbacks run for each completed branch. The driver remains responsible for correlation, feasibility, and observations.

Release removes the Agent’s saved roots and control handle without rewinding or canceling current execution. Both operations reject released handles. Release does not release caller-owned heap checkpoints or dispose host resources. Release those separately, in their required order.

Each Agent keeps a LIFO stack of these checkpoints. The existing `Agent.mark` visits their saved control-root lists and stored execution failures. This retains saved evaluator values after the current branch completes. It is not recursive discovery of every native record or function capture.

## Rejection and failure behavior

Capture requires controlled mode even at a debugger pause. It rejects absent or uncontrolled evaluators, foreign continuations, another current Agent, active execution, checkpoint reentry, completion notifications, and debugger preview. Owner accessors run under the checkpoint lock. The capture callback is read once.

Restore and release reject execution, checkpoint callbacks, completion notifications, debugger preview, foreign-Agent access, and non-LIFO access. An open checkpoint also prevents starting another evaluator after completion. This API does not yet support a checkpoint spanning separate registered evaluations or job drains.

A lowered-frame brand does not prove same-Agent provenance. You must register an evaluator from the owning Agent.

A failed capture does not register a checkpoint. Execution failures remain terminal: restoration cannot clear a stored `iterator.next` failure. A control or owner restoration failure poisons the registered evaluator, including after completion. Discard that Agent. You can still release a poisoned checkpoint to remove its saved roots.

Completion and debugger callbacks retain their existing host-error behavior. Their errors are not converted into iterator execution failures. Without open checkpoints, completion callbacks can still start another evaluation. Checkpoint access is blocked throughout completion and idle notifications.

## State the owner must cover

The owner must restore execution contexts, reachable mutable records, and any permitted host effects. Restoring the Agent registration does not restore those records. An empty owner remains an explicit caller assertion, not proof of isolation.

The tests select global-object properties and declarative bindings, and restore a saved context-stack list. They do not establish restoration of arbitrary context fields, function captures, jobs, modules, Promise state, React fibers, or host resources. Native marking still needs the explicit policies listed in the [state inventory](engine-state-inventory.md).

Capture and restoration perform native traversal outside the syntax-step budget. Callers must bound checkpoint depth, captured control, and owner work. This API is not a sandbox or an allocation bound.

## Evidence and remaining React work

`tests/evaluation-checkpoint.test.ts` has fourteen cases. All ten initial cases failed before implementation. Two additional tests exposed completion-callback reentry and debugger-preview access before those guards were added. An intermediate callback test compiled another evaluator during a control checkpoint; it now precompiles that evaluator. A TypeScript narrowing error was also corrected. The receipts retain these failures.

Four independent V8 comparisons cover both Boolean choices in both branch orders. An execution observer verifies one prefix evaluation. Tests also cover exact request identity, stale replies, nested LIFO behavior, saved-value GC and release, foreign Agents and continuations, owner getters, execution and restoration failures, and controlled debugger pauses.

React source inspection uses `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `ReactFiberWorkLoop.js:renderRootSync` changes the execution context, dispatchers, render lanes, and work-in-progress root state. These React records still require ownership. The source inspection is not a shared-prefix React rendering test.

The full local suite passes 1,378 tests across forty-one files. The unchanged smoke passes 74/74. The if/debugger/logical/conditional/generator selection passes 393/399 in both engines. Input and compiled hashes and verdicts match. Six strict-tail-call failures remain, with different source and published diagnostics. The [receipts](evaluation-checkpoint-validation/summary.json) retain both reports. Typechecking, two relocated clean builds, frozen offline installation, and the root check pass. [Linux CI at `07749fea`](evaluation-checkpoint-validation/ci.json) also passes 1,378 units and 74/74 smoke with matching clean-build hashes. E2E and publish pass. Historical timing failures remain recorded.

The engine SHA-256 is `bd4ed47d7231bb12483e79e03620a7ef44c40f164818f8445767bf2b477e0223`. A rejecting transitive owner, shared-prefix React forks, guarded reports, and the symbolic demo remain incomplete.
