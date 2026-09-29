# Selected global environment bindings

`createStateCheckpoint` now accepts canonical `GlobalEnvironmentRecord` selections. It restores global binding storage through engine262’s existing object and declarative-binding snapshots. It does not implement another environment or recursively own the global heap.

## Reused engine storage

Engine262 stores global lexical bindings in `DeclarativeRecord.bindings`. Its `ObjectRecord.BindingObject` holds global properties, including `var` and function bindings. This pinned revision does not maintain a separate global variable-name list.

Selecting a global environment adds its backing object and declarative record to the existing selections. Identity deduplication applies across explicit and implicit selections. `objectCount` counts unique selected objects, including global backing objects. `environmentCount` counts global wrappers plus distinct declarative/function records; one global selection therefore reports two. `bindingCount` counts declarative cells, not object properties.

Restoration reuses the existing property table, binding Map, and original binding cells. It restores initialization state, presence, values, property descriptors, and order. Branch-only declarations disappear; original nonconfigurable globals can be restored through engine storage rather than guest deletion. No JavaScript declaration semantics change.

## Metadata preflight and roots

The global wrapper, object record, and declarative record must use their exact canonical prototypes and belong to the current Agent. Their outer-environment links must be null, and the object record cannot be a `with` environment. The global receiver must be a same-Agent guest object. Backing storage must satisfy the existing selected-object policy, so a proxy backing object rejects without invoking its guest traps.

Capture saves references to the wrapper, component records, backing object, and global receiver. Restoration rechecks canonical shape and reference identities before any selected writes. Replaced component records or receivers reject; they are not silently rewound. Existing disposal, preview, LIFO, and ownership checks still apply.

Saved global metadata uses the existing checkpoint GC hook. The backing object and declarative cells use their existing snapshot roots. Referenced values, intrinsics, closures, modules, and host captures remain separately owned. A global receiver distinct from the backing object is retained but not property-snapshotted unless explicitly selected.

This is trusted engine metadata, not hostile-host validation. Selecting the global environment does not own every object reachable from it, restore module records, or checkpoint queued work. It does not make a poisoned runtime recoverable.

## React relevance and tests

React source inspection uses revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `ReactFiberWorkLoop.js` keeps execution context, current root, work-in-progress fiber, and lanes in module-level bindings. A bundled global entry can reference those bindings through closures; global selection alone does not select those closures’ environments.

The installed React/Test Renderer 19.3.0 fixture now includes its global environment in selected fiber/queue/update/Object.is capture. This adds one backing object and two environment records. The owner still explicitly rejects broader ownership. The same pending decision resumes and matches ten native sequences. No actual React rollback or shared-prefix React fork is claimed.

Twenty-two focused tests pass, and all twenty-two final fixtures fail against the preceding engine. Native comparisons cover four global property/lexical branches with four baseline observations, plus four Agent branches. Both Agent orders force GC and execute the prefix once. They explicitly restore the context-stack list, not every context field.

The tests cover branch-only `var`, lexical, and function declarations; function replacement; original property tables and cells; non-writable descriptors; TDZ initialization; nested snapshots; shallow values; changed global metadata; multiple realms; foreign records; disposal; preview; proxy rejection; and saved roots. The first patched run exposed two native-oracle failures: Node’s contextified global changed an existing value when its writable flag changed. The corrected oracle uses `vm.constants.DONT_CONTEXTIFY`, and the original failures remain archived.

The final local suite passes 1,526 tests across forty-seven files. The unchanged smoke passes 74/74. Global-code, variable-statement, and let-statement conformance passes 671/671 in both engines with matching input hashes, compiled hashes, and verdicts. Types, two relocated builds, frozen offline installation, root checks, and cleanup pass. Engine SHA-256: `653ba15d733596c6625d1415bf233b397f9fec0eac6c40ca76e84890799ed56d`.

[Validation receipts](global-checkpoint-validation/summary.json) retain failures, source hashes, and commands. Linux validation for this increment is pending. The preceding builtin increment passes 1,504 Linux units but fails both numeric `substr` smoke variants at the unchanged timeout. Its [failure receipt](builtin-checkpoint-validation/ci-failure.json) preserves logs and diagnostic profiles; separate E2E and publish workflows pass.

## Remaining work

General ownership still needs closure environments, intrinsic graphs, native capture records, execution-context fields, modules, queues, and host effects. Guarded React output, shared-prefix branches, transitions, repeated state families, and symbolic demo integration remain incomplete.
