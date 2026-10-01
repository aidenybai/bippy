# WeakMap marking dependencies

`ephemeron-roots.patch` corrects dependency propagation in engine262's existing collector. It adds no analyzer heap walker, interpreter, or snapshot API. The [state inventory](engine-state-inventory.md) identifies the larger ownership and root work still required.

## Failure and correction

A reachable WeakMap conditionally retains each value when its key is live. This relation is called an ephemeron. A retained value can itself be another entry's key, so marking must reach a fixed point.

The original loop processed each entry once. For entries ordered as `middle → target` followed by `root → middle`, it skipped the first entry before marking `middle`. It then cleared a WeakRef to the still-live target. The independent published engine reproduces this failure. Native V8 retains the target.

The corrected loop retains unresolved entries for another pass. Each pass marks values whose keys are live, including values that reveal more WeakMaps. Processing stops when a pass adds no marked objects. Unrooted cycles terminate without retaining their keys or values.

This uses the engine's existing marked set, weak-entry queue, and marking callback. It does not mark weak keys unconditionally or alter the sweep phase. Reversed chains can require repeated scans with quadratic worst-case work. Existing evaluation budgets do not bound this native GC work.

## Evidence

`tests/gc-ephemerons.test.ts` adds fourteen regressions:

- Object and Symbol key chains, in forward and reverse order, within one map and across separate maps.
- WeakMaps discovered while processing another weak entry.
- Rooted and unrooted weak cycles.
- Removal of the strong root, deleted weak entries, and WeakSet membership.
- No premature finalization for a live target reached through a reversed chain.

Twelve initial observations compare against independent V8 processes after a task boundary and explicit GC. Deterministic engine-only checks cover root removal, deletion, and finalization scheduling. The corrected prepatch fixture run passed eight cases and failed six. After the patch, all fourteen pass.

The full local suite passes 1,196 tests across thirty files. Typechecking, relocated reproducible builds, and the frozen offline install pass. The unchanged smoke passes 74/74. The WeakMap, WeakSet, WeakRef, and FinalizationRegistry Test262 selection passes 603/603 in both source-built and published engines. Their input hashes, compiled hashes, and verdicts match.

The published engine passes that selection while failing the independent dependency probe. The selection therefore does not establish complete weak-reference correctness. [Validation receipts](ephemeron-root-validation/summary.json) retain both observations and the initial fixture error, where an arrow body returned `undefined` instead of an object.

The engine SHA-256 is `da89eb16aa62b210bd0a705b63a7e45c9390ca0e8b2faa7e28ec02d48dd3d2cd`. No worker count, smoke selection, or timeout changed. [Linux CI at `e696d70a`](ephemeron-root-validation/ci.json) passes all jobs, including 1,196 units and the unchanged 74-variant smoke. Earlier Linux timeout failures remain recorded; this pass does not establish stable runner timing.

## Remaining gaps

At `e696d70a`, the suspended-array probe still returned `[false,7]` in engine262 and `[true,7]` in V8. The weak-entry correction did not add evaluator roots. The later [suspended-evaluator correction](suspended-control-roots.md) fixes that probe while retaining separate external-driver and host-callback failures.

General engine-state ownership, shared-prefix React forks, guarded React reports, and the integrated symbolic demo remain incomplete. The [completion checklist](symbolic-react-status.md) remains open.
