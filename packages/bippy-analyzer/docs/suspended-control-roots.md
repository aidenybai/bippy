# Suspended evaluator roots

The engine now retains values held by reachable lowered evaluators. The maintained patch extends engine262's existing `mark` protocol. It does not add a second collector, heap walker, or state owner.

## Root paths

`ExecutionContext.mark` visits `CodeEvaluationState` and `Generator`. `Agent.mark` visits its private paused evaluator. This covers the evaluator registered through `Agent.evaluate`, including while that evaluator is running.

`ExecutionMachine.mark` supplies the engine marker with these references:

- Resume values and arguments.
- Receiver, delegate, and cached delegate next method.
- Own data values from the activation record, including Symbol-keyed locals.
- Saved completion arguments in handlers.
- Values read from the machine's capture bindings.

The method does not invoke local accessors while enumerating activation descriptors. Capture-binding getters remain trusted compiler-generated metadata. This does not make arbitrary host-modified frames or foreign native iterators inspectable.

The engine collector also traverses native list indices. Existing `mark` methods take precedence. The earlier weak-collection cases still run before this fallback, so a WeakSet's backing list does not become an unconditional root. Native functions, ordinary native records without marking methods, and native Map/Set instances do not receive generic property traversal.

## Validation

`tests/gc-control.test.ts` checks eleven cases. All ten initial cases failed before the patch. They cover suspended partial arrays/objects, call/constructor arguments, method receivers, return/throw through finally, nested delegation, finalization, and Agent-owned debugger suspension. A further test invokes GC during Agent-driven evaluation.

Eight guest-generator observations match independent V8 processes after a task boundary and explicit GC. The engine checks collection after discarding the generator, completion of the Agent-owned evaluator, and removal of the final guest reference. Keeping a completed generator object can retain its execution context; immediate reclamation in that state is not claimed.

The original [partial-array failure](control-validation/gc-control-gap.json) now returns `[true,7]` in both engines. Historical receipts retain the earlier `[false,7]` engine result. [Current receipts](suspended-control-root-validation/summary.json) record the correction and separate failing boundaries.

The full local suite passes 1,207 tests across thirty-one files. The unchanged smoke passes 74/74. The combined weak-collection and generator selection passes 815/815 in both source-built and published engines. Inputs, compiled hashes, and verdicts match. These selections do not prove complete GC coverage.

Engine SHA-256: `1c969c89415c808d77f8a1af13de37c0708b030dc0eaff3a16cf637af87e6140`. No test timeout, worker limit, or smoke selection changed. [Linux CI at `0a13888b`](suspended-control-root-validation/ci-failure.json) passes 1,207 units but fails both numeric smoke variants at the unchanged timeout. Other CI jobs, E2E, and publish pass.

## Reproduced boundaries

At `0a13888b`, two counterexamples still reported `[false,7]`: a weak target disappeared while later execution still read its object value.

1. An external caller drives `ScriptEvaluation` directly to a debugger pause without `Agent.evaluate`. A partial array held only by that unregistered evaluator is not an Agent root.
2. A concrete runtime timer holds a guest callback whose environment retains an object. Explicit host GC clears the weak reference before `drainJobs`, although the callback later reads the object. An independent V8 callback-queue model retains it and reports `[true,7]`. That model checks closure liveness, not browser timer scheduling.

No automatic collection policy was added. These probes invoke host GC explicitly. The later [declared host-job roots](host-job-roots.md) fix the timer counterexample without changing React's effects. [Promise roots](promise-roots.md) also fix the pending-reaction probe. The unregistered external driver and a partial `Promise.all` result still fail.

Saved control snapshots also require an owner that retains their saved engine values. The control checkpoint closure alone is not an Agent root. This increment does not establish complete saved-state, native-capture, Promise, module, nested-driver, or host-resource coverage.

Follow the [state inventory](engine-state-inventory.md) before enabling general branch isolation. Symbolic React reports, shared-prefix React forks, repeated-state families, and the integrated demo remain incomplete.
