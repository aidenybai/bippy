# Engine state and root inventory

General React branching still needs an engine-state owner. This inventory identifies records already used by the current runtime. It is not an exhaustive internal-slot catalogue or proof of complete garbage collection (GC).

The source reference is engine262 `a600354c2954300d62d108bf9ed3459a8e4a289b`, with the maintained patches. Paths starting with `src/` in the table refer to upstream engine sources. Preserve these records and their identities instead of constructing a parallel runtime heap.

| Record              | Existing engine representation and GC route                                                                                                                                    | Missing ownership or root coverage                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest objects       | `src/value.mts`: `ObjectValue.properties`, `internalSlotsList`, and `PrivateElements`; descriptors have `mark` methods                                                         | Selected ordinary-object checkpoints exist. Exotic methods, internal slots, private elements, buffers, and weak state need separate policies.                                                              |
| Environments        | `src/execution-context/Environment.mts`: binding cells, outer links, object/global/function/module environments                                                                | Declarative and selected function environments restore in place. Indirect/deferred bindings, global declaration bookkeeping, disposal, and uninitialized receivers remain excluded.                        |
| Collections         | `src/api.mts`: explicit strong Map/Set traversal and weak-entry processing                                                                                                     | Collection rollback is absent. Native container identity and iteration order must survive restoration. Weak entries must not become unconditional strong roots.                                            |
| Execution contexts  | `src/execution-context/ExecutionContext.mts`: environment references, realm, function, module, generator, and evaluator state                                                  | `mark` omits `CodeEvaluationState` and `Generator`. `copy()` shares control and environments. Context-stack selection is not transitive ownership.                                                         |
| Lowered evaluators  | `engine/extensions/execution-machine.mts`: locals, delegate, cached next method, resume values, receiver, handlers, and captured bindings                                      | Control capture exists, but the machine has no engine GC marking method. Active nested drivers, external suspension, completed creator frames, and saved control states need explicit roots and lifetimes. |
| Native closures     | `engine/extensions/native-captures.mts`: private capture metadata; upstream `HostCapturedValues` slots retain selected iterator/builtin captures                               | The collector ignores native functions during traversal. Capture manifests are not registered GC roots. Methods without capture metadata remain outside the capture contract.                              |
| Promise state       | `src/abstract-ops/promise-operations.mts`: capabilities, reactions, callback records, and resolving-function cells                                                             | Capability and reaction classes have no `mark` methods. Reaction arrays and native closure cells need explicit traversal and restoration. This is source evidence, not a complete Promise GC test matrix.  |
| Jobs and event loop | `src/host-defined/job-queue.mts` and `event-loop.mts`: queue membership, pending jobs, caller realm/module, native job callback                                                | Existing marking visits `job.job`, but the collector ignores functions. Queue order, pending/flush state, callback captures, and cancellation must restore together.                                       |
| Modules and realms  | `src/modules.mts`, `execution-context/Realm.mts`, and `utils/module.mts`: environments, namespaces, loaded modules, evaluation status, capabilities, and private cache entries | Existing marks are partial, not snapshot APIs. `ModuleCache` has no marking/checkpoint API. Native pending promises and loader callbacks need an explicit boundary.                                        |
| Host resources      | Analyzer `src/concrete/runtime.ts`: timer handles, callback/argument closures, console entries, errors, and rejection tracking                                                 | No branch owner or external-effect rollback exists. Capture metadata generated for engine sources does not cover analyzer-authored host callbacks.                                                         |
| Saved state         | `object-checkpoint.patch`, `binding-checkpoint.patch`, and `captureControl`                                                                                                    | Selected state snapshots have Agent-owned roots and LIFO release. Control snapshots are separate host closures. Their saved values are not automatically Agent roots.                                      |

## Reuse existing capture support

`ObjectValue.mark` reads the declared internal slots. It traverses the elements of `HostCapturedValues` explicitly. Array, Map, Set, and string iterators already use this convention. `Promise.prototype.finally` also uses it for selected builtin captures.

Reuse this convention where it fits instead of discovering closure state through arbitrary host-property traversal. It does not expose every evaluator temporary, Promise reaction, or host callback. A static list of captures also does not establish mutable-state restoration.

React source inspection at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` confirms a concrete weak-collection use. `ReactFiberWorkLoop.js:attachPingListener` stores wakeables and lane sets in `root.pingCache`; `pingSuspendedRoot` deletes resolved wakeables. Keep React's cache and scheduling behavior unchanged. This inspection does not prove branch-safe Suspense execution.

## Collector correction from this audit

A reachable WeakMap retains a value only when its key is live. That value can make another weak key live. The collector must continue processing these dependencies until marking stops changing.

The original collector discarded entries whose keys were not yet marked. Reversed dependency chains lost live targets and scheduled finalization prematurely. [Ephemeron validation](ephemeron-roots.md) records the source-level correction and independent V8 comparisons. No new heap walker or owner was added.

The [suspended-array counterexample](control-validation/gc-control-gap.json) remains unresolved. Re-running it after the weak-entry correction still produces `[false,7]` in engine262 and `[true,7]` in native V8. Fixing collection propagation does not supply missing evaluator roots.

## Conditions for a general owner

1. Register roots by Agent and lifetime. Include active, suspended, external, and saved continuations without retaining unrelated Agents.
2. Add explicit reference policies for native captures, lists, records, and weak edges. Do not treat every object-valued field as a strong reference.
3. Restore engine records in place. Preserve aliases, descriptor order, internal-slot state, context stacks, queue order, and host cancellation state.
4. Reject unsupported records before branch mutation. A partial traversal must not produce a supposedly complete React result.
5. Verify both branch orders, release, nested/reentrant execution, GC while suspended, pending async work, and independent concrete specialization.

The current implementation does not meet these conditions. General symbolic React forks remain unimplemented. Do not substitute prefix replay or ignore unowned state.
