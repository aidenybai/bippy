# Synchronous control delegation

The lowered host runtime now preserves the tested `yield*` protocol behaviors. Engine262’s separate guest iterator algorithms remain unchanged.

## Corrections

- Read `next` once when delegation starts. Save that method in control checkpoints, expose it to the owner’s root inventory, and restore it with the delegate. Clear it when delegation ends.
- Read `throw` and `return` when each abrupt resume occurs. Treat null methods as absent, including the closing method used when `throw` is missing.
- Forward a foreign iterator’s non-completed result object unchanged. Don’t read its `value` getter before the caller does. Read the completion value when `done` is true.
- Use the runtime’s `getControlIterator` instead of Babel’s permissive `regeneratorValues` helper. Require a callable `Symbol.iterator` and an object result. Call the method directly without reading its `.call` property. Reject legacy `@@iterator`, bare array-like objects, and non-callable methods.

The forwarding cast describes a validated protocol object for TypeScript. It does not normalize properties, accessors, or prototypes. Native iterator results can omit `value` or expose it through a getter.

These changes do not make foreign continuations checkpointable. Control capture still rejects foreign delegates and overridden continuation methods.

## Verification

Nineteen added programs compare lowered execution with independent V8 execution. They test method caching and replacement, setup failures, dynamic abrupt methods, null methods, result identity and getters, malformed iterables, primitive receivers, and Unicode iteration.

A checkpoint test verifies cached-method roots and restoration after multiple delegates complete. It resumes different values, restores after an abrupt return, and checks that completed delegation releases the method root.

The phased failing-before runs expose three caching failures, five result/null-method failures, and four iterator-helper failures. A primitive-receiver fixture initially changed the test process’s string iterator. Its returned trace then recorded unrelated compiler work. Native comparisons now run in isolated V8 contexts. The failed fixture log remains in the receipts.

[Validation receipts](control-delegation-validation/summary.json) record 937 passing local tests across 22 files, typecheck, root check, and matching relocated builds. The unchanged smoke passes 74/74. Generator variants pass 212/212, and parameters retain 557/559. Their input hashes, compiled hashes, and verdicts match the preceding receipts. Historical tests retain 301/306.

A combined command exceeded its outer process limit before historical testing completed. That interrupted run is not passing evidence. After verifying their working directories, two orphaned evaluator processes were killed. The standalone rerun completed with the unchanged per-test timeout and two-worker limit.

Engine SHA-256: `2e2c6b1a145c6b32e47432c493852ae35bb770f6a45be9636ef2e61cb5b1f3ce`.

## Scope and gates

The earlier docs-only revision `a3bc42e7` passes Linux CI, including 917 units and 74/74 smoke variants. Its engine bytes match `964f06c4`, whose AMD runner timed out on both numeric variants. Both results remain recorded. One passing run does not establish stable timing across runners.

[Linux CI at `e83442bc`](control-delegation-validation/ci-success.json) passes all jobs, including 937 units and 74/74 smoke. No test selection, timeout, or worker limit changed. These corrections do not establish complete generator conformance, general state ownership, control-local GC roots, or symbolic React execution.

The historical [GC comparison](control-validation/gc-control-gap.json) cleared a weak reference to an object held by a suspended generator’s partial array result. [Suspended-evaluator marking](suspended-control-roots.md) now retains that target, matching V8. Unregistered external drivers, host callbacks, and saved-state root ownership still need work.
