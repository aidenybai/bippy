# Agent-owned abstract decisions

`Agent.resumeEvaluate` can now pause on an abstract Boolean and accept an explicit reply. The existing Agent evaluator slot retains suspended control for garbage collection (GC). There is no separate dispatcher or external-driver registry.

## Resume protocol

Register a same-Agent evaluator with `agent.evaluate(iterator, onFinish, false)`. Then call `agent.resumeEvaluate({ pauseOnAbstractBoolean: true })`. The return type is `IteratorResult<void | EvaluatorYieldType_AbstractBoolean, ValueCompletion>`.

A non-complete result contains either the exact abstract-decision record or `undefined` for an ordinary debugger pause. To answer a decision, call:

```ts
agent.resumeEvaluate({
  abstractBooleanDecision: {
    resume: "abstract-boolean",
    decision,
    value: choice,
  },
});
```

The pause mode persists for that registered evaluator. Calling `resumeEvaluate()` with a pending decision returns the same record without advancing. A valid reply can complete execution or reach another decision. The driver still owns feasibility and correlation across decisions.

Without opt-in, an abstract decision throws `Abstract Boolean decision requires an explicit resume`. The Agent retains that request, so a later explicit opt-in can retrieve it. `skipDebugger` still rejects abstract decisions.

The Agent validates reply kind, exact request identity, and a host Boolean choice before advancing. It reads the choice once and sends a validated data record to the existing engine protocol. Invalid, cloned, stale, and unsolicited replies do not consume a suspension. A throwing reply getter also leaves the decision pending.

## Lifetime and failure boundaries

Controlled execution rejects a different current Agent, reentrant resumption, and another `Agent.evaluate` while the controlled evaluator remains registered. This includes guest observation through `ManagedRealm.evaluateScriptSkipDebugger`. Tests inspect known data-property records directly while paused, without invoking guest getters.

The caller must register an evaluator from the owning Agent. The current-Agent check does not establish provenance for arbitrary host-supplied iterators. Low-level manual driving remains outside this lifecycle.

If `iterator.next` throws a host error, the paused record stores that error. Further Agent evaluation and resumption rethrow it. The existing mark protocol receives the stored error; it does not recursively inspect arbitrary native error fields. Discard the failed Agent; this does not unwind guest `finally` blocks, cancel resources, or roll back state. Validation errors occur before advancement and do not poison execution. Debugger notifications and completion callbacks remain host callbacks outside this execution-error catch.

Guest throws remain engine completions. Completion releases the registered evaluator before invoking the completion callback, so the callback can start another evaluation. Returned values and saved snapshots need their own roots after release.

The pending request, pause mode, failure state, and resume lock are Agent state. `captureControl` alone does not rewind them. Do not treat a saved iterator as a complete Agent or React checkpoint.

## React and regression evidence

`tests/agent-decisions.test.ts` adds twenty cases. All sixteen initial cases failed before the patch. Tests cover request identity, prefix execution count, invalid replies, throwing/getter replies, debugger pauses, nested/reentrant rejection, host failure, guest throws, completion callbacks, and current-Agent rejection. Two partial-array cases collect while paused and verify release after completion.

`tests/numeric-react.test.ts` now uses this Agent lifecycle instead of calling `ScriptEvaluation.next` directly. It clears kept-alive values and collects at every abstract decision. Actual React retains the unknown Number state, completes both bailout choices, and still matches ten independent native mount/update/unmount observations. The fixture no longer clears execution contexts through its manual-driver workaround.

React source inspection uses `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `ReactFiberHooks.js` computes eager state, stores it on the update, then compares it with `Object.is`. The engine pauses when React consumes the abstract comparison result. React still owns the update logic.

The full local suite passes 1,267 tests across thirty-four files. The unchanged smoke passes 74/74. The if/debugger/logical/conditional/generator selection passes 393/399 in source and published engines. All input/compiled hashes and verdicts match. Six strict-tail-call failures remain, with different source/published diagnostics. The [validation receipts](agent-decision-validation/summary.json) retain those failures and the intermediate test/typecheck corrections.

Engine SHA-256 is `92f7e382412f649f796ca889c1a7c6879d2b3e3ff4cb2b279c99af875d575d8a`. [Linux CI at `6eb84cf7`](agent-decision-validation/ci-failure.json) passes 1,267 units but fails both numeric smoke variants at the unchanged timeout. No timeout, worker limit, or smoke selection changed.

## Still missing

Unregistered manual evaluators still have a reproduced root gap. [Accumulator roots](promise-all-roots.md) fix partial `Promise.all` results, but partial `Promise.allSettled` and `Promise.any` probes still fail. The React fixture still starts a fresh runtime for each choice. No shared-prefix React fork, transitive state owner, guarded tree/transition report, or integrated symbolic demo exists. The [React completion checklist](symbolic-react-status.md) remains incomplete.
