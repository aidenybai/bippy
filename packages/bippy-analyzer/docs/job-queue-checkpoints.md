# Selected engine job-queue storage

`BasicJobQueue.captureQueue()` and `ByTypeJobQueue.captureQueue()` snapshot the engine’s existing native Sets. The scope is `selected-job-queue-membership-v1`. Both classes share capture, restore, lifecycle checks, and saved-job marking in the existing job-queue module. There is no new queue implementation or analyzer adapter.

## Contract

Capture requires a canonical builtin queue installed on the current Agent. Basic selection snapshots its existing Set. Typed selection snapshots `#all` and the four existing category Sets, preserving membership in multiple categories and original insertion order. `jobCount` counts the main queue, not duplicate category memberships.

Restore writes the original Sets through native Set operations. It neither enqueues through public methods nor calls `onNewJob`. Shadowed instance methods do not intercept snapshot operations. Capture and restore reject debugger preview or a different Agent/queue installation. Nested snapshots require LIFO access. Release remains possible after queue replacement, under the original Agent and LIFO position.

Saved job references use the same marking helper as live jobs until release. The snapshot does not copy Job records or their contents. These remain unowned:

- Job fields and callback capture arrays.
- Native callback state, Promise counters, and timer records.
- Notification callback membership and prior notifications.
- Macrotasks, event-loop execution state, guest state, and evaluator control.

A consumed job can be restored to queue membership without rewinding its callback. A test demonstrates two callback executions and a retained capture-array mutation. This API is not safe event replay, complete root discovery, a host sandbox, or permission to bypass evaluation-checkpoint host-effect guards.

## Verification

Fourteen tests fail on the exact predecessor and pass now. They cover both queue classes, both branch orders, stable Job identity, ordering, shared category membership, restoration without notifications, LIFO, Agent/preview checks, replacement, native Set access, saved roots, and release. Callback state and notification membership explicitly remain outside restoration.

The React diagnostic captures and restores its macro/microtask memberships with selected guest/context storage. It still rejects the first user timer after one prefix in each order, before returning a branch observation. This verifies composition under the existing guard, not complete scheduling ownership.

All 1,728 tests across 57 files pass, along with types, relocated builds, and the unchanged local 74-variant smoke. A new source conformance run is compared with the unchanged published baseline used by the preceding increments. [The receipt](job-queue-checkpoint-validation/summary.json) records exact results, hashes, logs, and diagnostic source.

Concrete timer maps/handles and native callback captures still need explicit ownership. Keep the host-effect guard until an execution owner can restore those records as well as queue membership.
