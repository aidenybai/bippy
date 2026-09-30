# Live Agent notification roots

The Agent now retains declared callback captures while callbacks are registered or executing. It also retains completion values through notification processing. These are GC roots, not snapshots or execution ownership.

The earlier [callback-discovery fix](agent-callback-captures.md) covered saved checkpoints. It did not retain live completion callbacks outside checkpoints. Clearing the paused evaluator before notification also removed the collector’s path to the completed evaluation.

## Root lifetimes

`Agent.mark` now visits the paused evaluator’s completion callback and the current idle callbacks. The existing native-capture registry supplies declared references. Marking reads current binding values; it does not pin values from registration time.

A private stack retains explicit roots during these synchronous operations:

- the completion callback while the Agent clears its paused registration and reads the result;
- the normalized completion throughout the finish callback and idle notification phase;
- each executing idle callback, even if it removes itself from the live Set;
- an Agent-managed synchronous fallback evaluator and its callback during `skipDebugger`;
- the fallback completion while its callback runs.

Nested notifications add stack entries without removing outer roots. Each entry is removed in `finally`, including when a callback or result getter throws. Completed and removed registrations no longer retain their targets through these paths. Detached test targets become collectible, but this is not a general eager-collection guarantee.

Completion records keep their original marker. Idle callbacks keep live Set iteration rather than a copied callback list. Calls retain their original receiver and argument behavior. Result getters run at the original lifecycle point, including the distinct synchronous fallback path.

No callback ordering, scheduling, completion algorithm, or guest heap representation is replaced. The implementation adds explicit Agent-held references and reuses the existing collector.

## Verification

`tests/gc-agent-notifications.test.ts` checks 25 cases:

- pending, paused, active, removed, and completed callback lifetimes;
- object and Symbol captures, current binding changes, and two deliberately unsupported capture controls;
- normal and throw completions across nested notifications and idle processing;
- exact exception identity and root cleanup;
- synchronous fallback callbacks and a partial evaluator accumulator;
- throwing and reentrant result getters;
- callback receivers, finish/idle argument counts, and live Set mutation order.

Two fresh Node GC observations confirm retained native closures keep their targets alive. A separate Node program checks live Set and nested notification order. The remaining cases test explicit engine-root lifetimes and protocol behavior; they are not a general native-heap equivalence proof.

`tests/gc-agent-notification-react.test.ts` adds two actual React updates, one per Boolean choice. A registered completion callback holds a detached guest object. Collection at each opaque pause and during completion retains it. After completion, the object becomes collectible in the fixture. Each run drains and unmounts independently. These are single-path GC checks, not React heap forks or new UI parity evidence.

The exact final-source predecessor fails 22 cases and passes five controls. The maintained engine passes all 27 new cases and 55 focused cases. [Receipts](agent-notification-root-validation/summary.json) retain those results, intermediate runs, source hashes, and broader gates.

Fresh source and published Test262 runs match for 181 WeakRef and yield variants. They cover concrete execution, not this native callback API. The fixed 74-case smoke and existing time limits remain unchanged.

## Ownership boundaries

Unregistered closures and arbitrary native record referents remain opaque. A function capture declaration does not grant transitive traversal of every object it references. The two negative controls retain that boundary.

Native capture getters and existing marker methods remain trusted. Rooting a callback does not make its effects reversible. Idle subscription membership still does not rewind, and standalone manually advanced evaluators remain outside Agent-managed root lifetimes.

The private root stack is not a checkpoint API. Host-effect guards and restrictions on checkpoints across separate evaluations or job drains remain enabled. General React execution ownership, guarded transitions, repeated-state families, automatic reports, and the integrated demo remain incomplete.
