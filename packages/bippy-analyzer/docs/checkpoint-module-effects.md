# Module effects during checkpoints

Evaluation checkpoints now reject six module operations before their first host lookup or completion-record access. This adds six calls to the existing `Agent.assertCanPerformHostEffect()` guard. It does not snapshot module state or permit symbolic module loading.

## Reproduced failures

The predecessor can call a loader during a checkpoint. In the concrete artifact test, it reaches `ModuleCache.load` before a later host-effect guard rejects execution. A cold `import.meta` read can also call its host hook and complete. Direct loader completion can append to `LoadedModules` before a later rejection.

The patch guards these entry points:

- `HostLoadImportedModule`, before host-hook lookup.
- `HostGetSupportedImportAttributes`, before reading host options.
- `HostGetModuleSourceModuleRecord`, before host-hook lookup.
- `HostGetImportMetaProperties`, before Realm callback lookup.
- `HostFinalizeImportMeta`, before Realm callback lookup.
- `FinishLoadingImportedModule`, before reading its opaque payload or changing `LoadedModules`.

The original loading algorithms, records, cache, and callbacks remain unchanged. A cached `import.meta` read does not call these operations and remains available. Outside evaluation checkpoints, the operations retain their previous behavior.

## Validation

The 14 final tests fail 12 cases on the exact predecessor and pass all 14 with the patch. The cached-meta and ordinary-operation controls already pass on the predecessor. Tests cover hook getters, loader calls, completion writes, cold and cached meta reads, capture/restore phases, release, and terminal evaluator failures. Guest `catch` cannot consume the rejection during registered evaluation.

An initial fixture constructed the opaque loader payload directly. Runtime tests passed, but declarations hide its internal `data` field. Type checking rejected that fixture. The final fixture obtains an actual engine-created payload through a loader hook. The failure and exact final-source comparisons remain in the [validation receipts](checkpoint-module-effect-validation/summary.json).

All 1,935 units across 67 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. Fresh source and published Test262 runs each pass 72 variants across 36 files. Input and compiled hashes match. The selection covers the top-level dynamic-import and import-meta directories, not their entire nested trees or all module proposals.

## React diagnostic and limits

The diagnostic adds an explicit application `import()` after `fixture.update`. The predecessor calls the loader once, then rejects later. The maintained engine rejects before the loader. Both visitation orders execute one prefix, retain one timer, and produce no branch observations. This is not evidence that the original fixture imports a module in its paused suffix.

The inspected React `ReactLazy.js` calls the supplied constructor and subscribes to its thenable. That source inspection does not establish symbolic lazy loading, Suspense transitions, or module ownership.

These guards do not restore module graphs, namespaces, native cache maps, Promise state, or already-started loader work. In particular, `ModuleCache.load` can write its private cache before calling a saved completion callback. The composed loader can change the context stack before reaching `FinishLoadingImportedModule`. Neither path is made transactional by this patch. The [pending-load admission check](pending-module-loads.md) now refuses checkpoint capture while an engine request remains outstanding, rather than attempting callback rollback. Arbitrary host callbacks and direct cache operations remain outside this guard contract.

Import argument evaluation, coercion, allocations, or earlier module work can occur before a guarded operation. The patch does not rewind those changes. Discard poisoned evaluators rather than treating rejection as rollback. General React execution ownership and guarded tree exploration remain incomplete.
