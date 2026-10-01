# Selected iterator-record checkpoints

`createStateCheckpoint({ iteratorRecords })` now restores the `Done` flag in selected engine `IteratorRecord` objects. It preserves each original record and validates its `Iterator` and cached `NextMethod` references. Iterator algorithms and record allocation remain unchanged.

## Reproduced branch leak

An array pattern pauses in its first default initializer. The remaining pattern consumes the iterator and sets its native record’s `Done` flag. Restoring the continuation without this record leaves `Done` true. The second branch skips the remaining values even though guest bindings and the iterator cursor were restored.

The retained binding and assignment cases return `[null]` for the rest array under native execution. The predecessor’s second branch returns `[]` and calls `next` once instead of three times. Both exploration orders reproduce this leak. An abrupt initializer also loses its `return` call when it follows an exhausted branch.

Eight fork cases cover binding and assignment patterns, both orders, and normal or throwing initializers. Each case executes its prefix once, forces collection while saved, and compares both branches with fresh Node execution. Restoring `Done` fixes the missing values and cleanup without replaying the prefix or replacing iterator operations.

## Record contract

Selection accepts the engine’s existing plain record layout:

- The prototype is the current native `Object.prototype`.
- Exactly `Iterator`, `NextMethod`, and `Done` are own writable, enumerable, configurable data fields.
- `Iterator` is a guest object. `NextMethod` is an engine `Value`. `Done` is a native Boolean.
- Direct guest objects belong to the current Agent.

`NextMethod` need not be callable. The original engine also creates close-only records with `Value.undefined`, and its existing algorithms handle invalid `next` values. Selection does not change those rules.

The snapshot saves field values and deduplicates record identity. `iteratorRecordCount` reports the number selected. Restore validates all selected layouts, types, Agent references, and immutable references before writing state. It then restores only `Done`. Metadata changes reject rather than being silently repaired. Existing Agent, last-in-first-out, release, and debugger-preview checks apply.

Open snapshots explicitly root saved and current iterator and next-method references. Release removes those roots. The collector does not invoke `next`. This does not add general marking for every live, unselected plain iterator record.

## Ownership limits

Selection is shallow. It does not restore iterator properties, generator control, callback captures, native counters, async-from-sync state, or referenced object contents. Select those through their own supported policies or reject them. There is no allocation brand on the original plain record. A matching layout is not proof of complete ownership or provenance.

Native getters, proxies, capture declarations, and other host metadata remain trusted. These checks are not a sandbox. The selected-record API neither permits host effects nor changes the limits of an Agent evaluation checkpoint.

## Validation and React status

All 28 final tests fail against the exact predecessor engine and pass with this patch. Six fork failures expose incorrect branch observations; two abrupt-first cases reach the missing count assertion instead. The remaining cases cover storage, preflight rejection, lifecycle, Agent boundaries, and saved/current roots. The initial four-case leak and intermediate TypeScript errors remain in the receipts. Those errors required an explicit type predicate and the existing `debugger_scopePreview` API, not a weakened oracle.

All 2,083 units across 76 files pass. Types, two relocated builds, offline installation, and the unchanged local 74-case smoke also pass. Fresh source and published Test262 runs each pass 313 variants covering selected array binding and assignment patterns. Input hashes, compiled hashes, and verdicts match. Test262 does not exercise the new checkpoint API; the fork and storage tests do. See the [validation receipts](iterator-record-checkpoint-validation/summary.json).

React source inspection used `ReactChildFiber.js:reconcileChildrenIterator` at revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. React advances its guest iterator through `next` calls and checks the returned `done` field. This is separate from engine262’s native `IteratorRecord.Done` field. No React reconciliation code was changed.

The current React ownership diagnostic selects zero native iterator records at its pause. Both orders still execute one prefix and reject the first branch timer, with no branch tree observations. Its 2,199 guest objects and 21 unregistered native functions remain unchanged. This diagnostic does not prove iterator ownership inside React or a sound shared-prefix owner. General React isolation, transitions, repeated families, and the integrated demo remain unfinished.
