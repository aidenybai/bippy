# Argument accumulator storage policy

`getArgumentAccumulatorStorage(value)` recognizes factory-allocated engine argument accumulators and validates their current storage. It does not infer ownership from an array’s shape or contents. The scope is `engine-argument-accumulator-storage-v1`, not complete execution ownership.

## Allocation and lookup

The original `ArgumentListEvaluation` algorithms now obtain two empty arrays from an internal factory:

- `precedingArgs` for ordinary, spread, and constructor arguments
- `restSub` for template substitutions

The factory creates an ordinary native array. A private WeakMap associates its identity with the current Agent and accumulator kind. The original algorithms still evaluate expressions, append values, perform spread iteration, propagate completions, and return their arrays. No wrapper, replacement array, or custom collection handles subsequent operations.

The factory and registry reader are control-support functions, outside capture instrumentation. Capture introspection can expose those functions, but not registry mutation. The factory only allocates fresh arrays. It cannot register an existing caller array, and it rejects unknown kinds. The reader returns frozen allocation metadata.

This establishes factory provenance, not exclusive call-site provenance. A host that obtains the factory through capture introspection can allocate a fresh registered array. The kind does not prove that a particular guest call executed. Build tools, native reflection, ambient builtins, and host callbacks remain trusted.

Unregistered values return `undefined` before storage inspection. This includes copied arrays, proxies around registered arrays, revoked proxies, and parsed syntax arrays. Registered values from another Agent reject. Debugger-preview inspection also rejects.

## Storage contract

After provenance checks, lookup reuses `getNativeListState`, the validator used by [selected native-list snapshots](native-list-checkpoints.md). It checks canonical array storage and direct foreign-Agent object/environment references without invoking array-index getters. Native referent checks retain the existing trusted-reflection boundary.

The frozen result contains:

- `scope` and `kind`
- `list`, the original mutable array
- `references`, a frozen copy of current own indexed values
- `borrowedReferences`, a frozen list containing the original `Array.prototype`

Pass `list` to the existing `createStateCheckpoint({ nativeLists })` API for restoration. No second snapshot implementation is added. Holes, length, aliases, and existing Agent/LIFO/GC rules retain that API’s semantics.

Lookup does not freeze the array or its referents. A native record in an entry appears in `references`; it is not an accepted leaf. A complete owner must classify every such dependency and validate borrowed prototype behavior. Array identity and factory provenance do not authorize mutation of referenced state or execution of callbacks.

Each result describes the current storage only. Later changes require another inspection. The result is not a write barrier, a stable graph certificate, or an engine GC root. Existing explicit root scopes and state checkpoints retain their separate contracts. Registry membership is weak and does not require release. It adds no execution, allocation, or traversal budget.

Completed template argument arrays such as `[siteObj, ...restSub]` are not registered. Other engine arrays, native containers, Realm state, and control-support dependencies still need policies. No source-name, shape, frozen-object, or registration-only allowlist accepts them.

## Evidence

`tests/argument-accumulator-storage.test.ts` includes eight shared-prefix forks covering call, spread, construction, and template substitution in both orders. Each prefix runs once. Original aliases and accumulator identities survive forced engine GC and restoration. Sixteen observations match independent Node executions.

These tests discover accumulators through the policy, without a sentinel-value or array-shape classifier. They still supply selected guest objects, environments, reference records, and stack restoration. They are not automatic execution-owner tests.

Other cases cover copied/proxied/syntax arrays, private allocator introspection, current references, foreign Agents and entries, debugger preview, invalid layouts, and unsupported referents. The incomplete-owner control restores an entry’s identity while its native record counter remains changed.

`tests/argument-accumulator-react.test.ts` selects registered accumulators at an actual React update pause. Their existing snapshot schema accepts the selection. The owner then rejects the remaining execution graph, with one prefix and zero branch observations. Host-effect guards remain unchanged.

Final local checks:

- 21 new tests and 90 focused tests pass.
- All 2,344 unit tests across 95 files pass with the existing five-second limit.
- Types, two relocated builds, frozen offline installation, and the unchanged 74-case smoke selection pass.
- Fresh call/new spread and tagged-template conformance covers 212 variants. Maintained and exact-predecessor builds each pass 211 and time out on strict `tco-call.js` at ten seconds. The published engine passes 210, failing `tco-call.js` and `tco-member.js`. Input and compiled hashes match across all three reports. These failures are retained, not gate passes.

Reversing the production patch reproduces predecessor engine bytes. All 21 new tests then fail because the policy or allocator dependency is absent. These are missing-feature baselines, not 21 independent semantic bugs. Initial TypeScript failures for readonly syntax arrays and descriptor-map typing are retained too.

The [validation receipt](argument-accumulator-storage-validation/summary.json) records hashes and raw logs. Native source provenance CI also remains failed: 2,323 units passed, but two numeric `substr` smoke variants exceeded ten seconds. Its longer diagnostic profiles do not change that gate result.

General React ownership, shared-prefix isolation, automatic reports, guarded transitions, repeated-state families, and demo integration remain incomplete.
