# Reject checkpoints during pending module loads

`Agent.captureEvaluation()` now rejects while that Agent has an outstanding engine module-load request. The check runs before reading the state owner. It leaves the paused decision available and does not register a checkpoint.

## Why the completion guard was too late

The previous module-effect guard rejects inside `FinishLoadingImportedModule`. A delayed `ModuleCache.load` callback writes its cache before calling that operation. The composed loader can also push its saved execution context first.

The regression reproduces both changes on the predecessor. Capture succeeds, the owner runs once, the cache records a result, and the context stack grows by one. The callback then throws the existing host-effect error. Matching that error alone would miss the earlier writes.

The new policy refuses capture while the request is pending. It does not run the callback inside a checkpoint or claim to restore its writes.

## Tracking the existing protocol

A private native WeakMap associates each Agent with a Set of outstanding opaque payload identities. `HostLoadImportedModule` registers its payload before host-hook lookup. `FinishLoadingImportedModule` removes it after the original completion algorithm succeeds.

Each engine request has a separate payload, including nested requests that share one `GraphLoadingState`. Sets prevent duplicate completion from removing an unrelated request. Synchronous completion leaves no outstanding entry. A hook or completion failure leaves its entry pending, so capture stays disabled. There is no new cancellation API; discard an Agent whose loading protocol cannot finish.

The patch does not wrap callbacks, change loading order, enqueue placeholder jobs, or add a scheduler. The existing module-effect guards still reject new loads during capture, restore, and open evaluation checkpoints.

## Evidence

The final focused selection has 29 cases. The exact predecessor fails nine and passes 20; the maintained engine passes all 29. This includes ten new pending-load cases, one new React case, and 18 existing module-effect and tree-specialization cases.

Tests cover overlapping requests in both completion orders, nested graph requests, duplicate completion, failed completion, synchronous completion, absent loaders, Agent isolation, and the late cache/context counterexample. The React test mounts actual React, starts an explicit deferred import, pauses an update on an opaque Boolean, and verifies rejection before owner access. It does not explore React branches or establish lazy/Suspense parity.

The earlier module-effect fixture now completes its payload-producing request before capture. An initial React test getter inferred `void`; the final getter declares `never` because it always throws. The type error and exact final-source predecessor run remain in the [validation receipts](pending-module-load-validation/summary.json).

All 1,946 units across 68 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. The new source Test262 run passes 72 variants across 36 files. Its input, compiled, and verdict records match the reused published-engine run from the preceding increment.

## Limits

This is an admission check, not module-state ownership. Native cache maps, module graphs, callbacks, and pending Promise state remain unowned. Direct cache operations and custom host work outside `HostLoadImportedModule` are not tracked. Sharing native storage across Agents still requires a separate ownership policy.

The registry retains native payload identities until successful completion. It does not add guest GC roots or prove weak-lifetime behavior. Runtime disposal does not finish requests or cancel arbitrary external work. A stopped event loop is not proof that a loader has finished.

Capture with no pending requests still requires a sound state owner. General React branch isolation, guarded reports, transitions, and repeated-state families remain incomplete.
