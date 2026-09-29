# Engine262 reuse audit

The project should extend engine262, not build another JavaScript or React runtime. Inspection confirms that execution and React behavior already use their implementations. The main custom costs are abstract-value representation, guarded alternatives, and resumable control with selected-state restoration.

This audit uses engine262 `a600354c2954300d62d108bf9ed3459a8e4a289b`. React inspection uses `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. The installed React/Test Renderer fixture runs version 19.3.0, rather than building that research checkout.

## Who owns each behavior

| Behavior                                                      | Existing implementation                                         | Custom responsibility                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Parsing, references, calls, coercion, exceptions, descriptors | Engine262 parser, evaluator, and abstract operations            | Validate supported input scope and intercept abstract operands           |
| Concrete expression results                                   | Engine262 `Evaluate_*` algorithms                               | Distribute guarded scalar alternatives and record observations           |
| Number addition and predicates                                | Engine Number operations and `Object.is` intrinsic              | Record unknown terms and predicates without concrete substitution        |
| Conditional and logical evaluation                            | Engine262 runtime-semantics algorithms                          | Resolve an opaque Boolean only where the algorithm needs its truth value |
| Hooks, state queues, reconciliation, effects                  | Actual React                                                    | Supply host facilities, drive decisions, and observe results             |
| Modules and jobs                                              | Engine `ModuleCache`, module records, job queue, and event loop | Resolve supplied artifacts and register bounded host timers/microtasks   |
| Common-prefix continuation                                    | Lowered engine evaluators                                       | Expose and restore suspended control state                               |
| Branch storage                                                | Existing engine object/environment records                      | Restore selected records in place; general ownership remains missing     |

`src/symbolic/scalar-operation.ts` lists operand fields and delegates to engine algorithms. It does not implement arithmetic or JavaScript short-circuit rules. `src/symbolic/evaluate.ts` distributes finite guarded alternatives. That is a second abstraction frontend beside the newer opaque-value protocol, so it should not grow into a statement interpreter.

The numeric domain records expression and predicate graphs. Its SameValue cache uses operand identity, canonical concrete Number strings, symmetry, and reflexivity. It is not a general equivalence or feasibility solver. The engine still performs argument evaluation, type checks, and ordinary concrete comparison.

## What upstream cannot replace directly

### Debugger preview is not rollback

`Agent.debugger_scopePreview` enables mutation checks and tracks objects created during preview. Writes to an existing object can return an EvalError. Ending preview resets preview bookkeeping; it does not restore arbitrary prior state.

`tests/engine-reuse.test.ts` checks the published engine directly. A write before preview remains visible after a rejected preview write. Normal writes work after preview exits. Replacing checkpoints with this API would change the contract from branch execution to mutation rejection.

### ExecutionContext.copy is shallow

`ExecutionContext.copy()` copies the `CodeEvaluationState`, lexical/variable environments, and other references. It clones call-site metadata, not the underlying evaluator continuation or heap.

The published-engine test suspends a real guest generator, copies its context, and advances it twice. The copy shares the exact control iterator and environments. The guest mutations remain visible. This is not an independent branch snapshot.

### GC marking is not ownership discovery

`Agent.mark`, `ExecutionContext.mark`, and `api.gc` provide existing roots and traversal conventions. They are useful implementation inputs, but they do not describe all state that must rewind. The retained [suspended-control counterexample](control-validation/gc-control-gap.json) exposed a missing root path. [Engine marking extensions](suspended-control-roots.md) now fix that case. Declared [host-job roots](host-job-roots.md) also fix the timer probe. [Promise roots](promise-roots.md) fix the pending-reaction probe. External-driver and partial `Promise.all` probes still prove incomplete reachability marking.

Do not infer a complete state owner from this traversal. The [engine state inventory](engine-state-inventory.md) identifies existing records, capture conventions, and missing roots. Native captures, internal collections, execution records, jobs, module state, and host resources still need explicit treatment or rejection. The [weak-entry propagation correction](ephemeron-roots.md) fixes order-dependent marking, not continuation roots or rollback.

## Size and maintenance cost

At the original audit (`0dbcb0e9`), the two control runtime extensions contained 640 lines: `execution-machine.mts` has 592 and `native-captures.mts` has 48. Six control build helpers contain another 520 lines. The later machine marking method adds fourteen lines, bringing those extensions to 654 lines. These counts include interfaces and formatting. They exclude patches, general build/integrity tools, tests, and third-party implementations, so they are not a total project size.

Babel performs generator lowering. The project adds capture metadata and a modified execution driver. This is not another application-language interpreter, but it still creates generator-protocol, GC, and performance obligations. Delegation regressions required corrections, and repeated Linux smoke timeouts remain unresolved. Those observations do not establish a controlled slowdown relative to upstream.

The finite scalar adapter has 549 lines across `evaluate.ts`, `guards.ts`, `scalar-operation.ts`, and `validate-expression.ts`. Replacing its evaluator table alone would not remove the abstraction frontend. A new skip-hook API or extra dispatch layer would add another engine contract without solving ownership or report compatibility. This audit does not add one.

## Implementation boundaries after this audit

- Keep concrete JavaScript and React behavior in their existing implementations. Do not add React hook emulation or an analyzer statement interpreter.
- Keep new abstraction at engine boundaries where its value/result types are explicit. Do not return symbolic objects from helpers whose callers require host Booleans.
- Do not extend the legacy scalar frontend with mutation, calls, statements, or scheduling. Preserve its existing contract until a shared engine-driven path can replace it with parity evidence.
- Reuse engine objects, binding cells, module records, and queues. Do not introduce parallel representations of their runtime state.
- Do not add a generic heap clone and call it a complete state owner. Establish record ownership, restoration, lifecycle, GC roots, and rejection behavior first.
- Do not switch the conformance gate to an unlowered engine to hide continuation overhead. Preserve the current selection, timeout, and worker limit.
- Do not replace no-prefix-replay exploration with fresh runs under the same contract. Fresh runs would simplify control and ownership, but replay the prefix and require explicit approval.

The in-progress numeric predicate increment follows these boundaries: engine `Object.is` produces an abstract Boolean, and actual React performs its state update. Its single-path React fixture does not claim general branch isolation. No continuation or state-owner implementation was expanded during this audit.
