# Declared native-capture roots

The engine collector now follows bindings declared by `getNativeCaptures` when it reaches a native function. It reuses the existing marking set and weak-collection algorithm. The patch changes only `src/api.mts`; it adds no collector, closure scanner, or heap model.

## Marking contract

The marker records each function before reading its manifest. This handles self-references and mutual cycles and reads each reachable manifest once per collection. Each collection reads current binding values, rather than caching earlier captures.

Declared references then use the existing traversal for guest objects, Markable records, arrays, and weak collections. A newly discovered WeakMap key participates in the existing ephemeron fixed point. A callback reachable only as a dead WeakMap entry’s value does not become a root.

Unregistered functions remain opaque. Function properties are not scanned, including properties named `mark`. Arbitrary plain native records are not traversed. Ambient names do not identify roots. Read-only bindings can still reference mutable state, which this change does not snapshot.

Manifest factories and binding getters are trusted host code. Their failures propagate before the collector clears weak targets. A native temporal-dead-zone failure is not swallowed. This ordering does not roll back effects performed by a host getter or provide a sandbox.

## Evidence

The focused pair of suites has 24 cases. The exact predecessor fails 10 and passes 14; the maintained build passes all 24. Twelve cases are new. The earlier live-builtin negative GC case now asserts retention followed by collection after removing the builtin root.

Coverage includes from-adapter targets, cycles, current-value reads, macro/microtask jobs without duplicate capture arrays, selected snapshot release, weak chains, dead weak cycles, getter failures, and unsupported captures. Three independent Node GC observations cover a bound native closure, a changed binding, and an ephemeron chain.

Two fixture corrections are retained in the logs. Creating a new configurable property could not overwrite a nonconfigurable guest `var`; the corrected setup assigns through the guest reference. A pushed context prevented the real event loop from draining. The corrected test drains with an empty context stack, asserts empty queues, and restores the fixture context before observing collection.

The actual React diagnostic passes in both branch orders with forced GC. It still executes one prefix, captures one existing timer, and rejects its first branch-created timer before observations. Root retention is not execution ownership; host-effect guards remain enabled.

All 1,775 units across 61 files, types, relocated builds, and the unchanged local 74-variant smoke pass. New source and published runs pass all 603 selected WeakRef, WeakMap, WeakSet, and FinalizationRegistry variants. [Receipts](native-capture-root-validation/summary.json) preserve hashes, failures, corrections, commands, and reports.

Native record contents, unregistered callbacks, class methods, module state, and transitive restoration remain incomplete. There is no general guarded React explorer, transition/repeat report, or symbolic demo yet. Collector traversal and manifest allocation are not covered by the syntax-node/job budgets.
