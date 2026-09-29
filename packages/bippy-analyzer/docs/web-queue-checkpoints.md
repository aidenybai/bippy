# Selected web event-loop queue storage

`WebLikeEventLoop.captureQueue()` snapshots the existing macrotask queue’s membership and order. Its scope is `web-event-loop-macrotask-membership-v1`. It restores the original `queuedJobs` Map, type-index record, and per-type Sets in place. It does not add a scheduler or copy job execution state.

## Contract

Capture requires the canonical web event loop, its owning Agent, no debugger preview, and an idle manual or stopped loop. Automatic running, active flushing, and pending async registrations reject. The returned checkpoint reports `jobCount` and provides `restore()` and `release()`.

Restore checks lifecycle state, storage identities, native Map/Set prototypes, and type-record data descriptors before writing. Changed Maps, type records, original type Sets, accessors, frozen type records, and shadowed Set methods reject. It removes branch-added type indexes and restores saved jobs in their original order and original Sets. Nested checkpoints require last-in-first-out access.

Release removes saved roots without restoring queue contents. Release still works after an unsupported lifecycle or storage change, provided the owning Agent and LIFO position match. Saved jobs use the engine’s existing job-reference marking paths until release. Checkpointing does not change job dispatch or queue priority.

## What it does not own

The snapshot owns macrotask collection membership, not everything reachable from a Job record:

- Job fields, callback closures, capture-array contents, and callback counters remain unowned.
- Concrete timer maps, handles, cancellation state, and diagnostics remain unowned.
- The Agent’s microtask queue, pending async registrations, automatic-flush state, and Node-like phase queues are not selected.
- Guest heap state and evaluator control require separate owners.

A caller can consume a saved job, restore its membership, and consume it again. Its callback state does not rewind. A regression test records both executions and preserves a capture-array mutation across restore. Queue membership restoration alone is not safe event replay.

[Host-effect rejection](checkpoint-host-effects.md) remains unchanged. Capturing queue storage inside an evaluation owner does not grant permission to schedule or drain jobs while that evaluation checkpoint is open. These snapshots have no whole-heap discovery or work-budget guarantee and are not a hostile-host sandbox.

## Verification

Eighteen tests check both branch orders, original identities, branch-added indexes, nested snapshots, strict preflight, lifecycle rejection, Agent ownership, preview, roots, and release. They also verify that microtasks and callback state remain outside selection. The exact final file fails all eighteen cases on the preceding engine. All eighteen pass now.

The first GC release test lost its Realm root, so the collector could no longer visit the WeakRef observer. Its failed log is retained. The corrected test keeps the observer Realm rooted during collection, consumes jobs through the event loop, and verifies saved-target retention, discarded-branch collection, and release.

The actual React partial-owner diagnostic captures and restores one pending macrotask together with its selected guest/context storage. Both branch orders execute one prefix, reach the first user timer after the React update, and reject that timer. No branch observation returns. This does not establish ownership of the queued callback or enable event transitions.

All 1,714 unit tests across 56 files pass, along with types, relocated builds, and the unchanged 74-variant local smoke. The new source-engine run matches the unchanged published-engine baseline from the host-effect increment: 367/373 variants, identical input/compiled hashes and verdicts, and exit 1. The six Promise/async-function failures remain. The published baseline was reused, not rerun.

[The receipt](web-queue-checkpoint-validation/summary.json) stores hashes, reports, logs, and the React diagnostic. General queue ownership still needs microtask storage, timer records, native captures, and explicit effect permissions tied to a validated execution owner.
