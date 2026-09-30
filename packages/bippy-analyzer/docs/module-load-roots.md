# Pending module capability roots

The garbage collector (GC) now follows capabilities held by outstanding engine module-load requests. It also follows the existing module references in `GraphLoadingState`. These roots preserve values needed by pending import reactions; they do not snapshot module state.

## Reproduced loss

A pending import can hold the only live reaction that uses an object or symbol. The predecessor clears a WeakRef to that value during explicit collection, even though the loader can still complete. Static graph loading and nested dependency loading have the same gap.

The new tests create a value inside a guest closure, attach import reactions, and discard the guest Promise handle. They collect while loading remains pending, after nested loading advances, and after completion queues reaction work. They then run the reactions, check object identity through the WeakRef, and collect after draining the jobs.

## Reuse of engine records

`Agent.mark` now asks the existing pending-request registry to mark each payload’s `data`. Dynamic imports provide an existing `PromiseCapabilityRecord`. Graph requests provide an existing `GraphLoadingState`, whose new marker visits:

- `PromiseCapability`.
- Modules in `Visited`.
- Modules in `PreviouslyImportedNames`.

The collector already handles capability records, module records, guest functions, environments, cycles, and queued reactions. The patch uses those paths rather than traversing arbitrary native objects. The existing completion protocol removes finished requests from the registry; the roots follow its current membership.

## Validation

All 16 final cases pass. The exact predecessor fails 14 engine cases and passes the two independent Node controls. Twelve cases cover object and symbol retention through dynamic, static-graph, and nested loads, with successful and rejected completion. Two cases isolate the graph’s module-reference lists using namespaces, then remove those edges and check collection. The two Node controls use actual pending data-URL imports under `--expose-gc`.

An initial assertion read `.Type` directly from `Module.Link()`, whose public type also permits `void`. The final assertion uses `EnsureCompletion`. The initial type error and the same-final-source predecessor run remain in the [validation receipts](module-load-root-validation/summary.json).

All 1,962 units across 69 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. The new source Test262 run passes 675 variants. Its input, compiled, and verdict records match the combined, reused published weak-reference and module selections. Those published runs were not repeated for this patch.

## Boundaries

Pending-load admission checks and host-effect guards remain enabled. Retention is not restoration, and a correct WeakRef observation is not proof of branch ownership.

This patch adds no referrer, native module-cache, arbitrary callback, or host-metadata roots. Other module-record fields and asynchronous evaluation still require a separate audit. The synthetic namespace tests isolate named graph edges; they do not establish complete module-graph reachability.

Registry entries retain their capabilities until successful protocol completion. Abandoned or failed requests can therefore retain values while their Agent remains reachable. There is no cancellation or eager-collection guarantee. Payloads and marker callbacks remain trusted host data, not a sandbox or a bound on collection work.

General React execution ownership, guarded tree reporting, transitions, and repeated-state families remain incomplete.
