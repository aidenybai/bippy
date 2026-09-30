# Selected native-list checkpoints

`createStateCheckpoint({ nativeLists })` now restores indexed storage in explicitly selected native arrays. It preserves each original array, its length, holes, and element identities. `nativeListCount` counts distinct selected arrays.

These are engine implementation arrays, such as argument accumulators, not guest Array objects. Guest arrays already use the engine’s property-table checkpoints. The patch extends the existing selected-state checkpoint, marker, validation phase, and release stack. It does not replace JavaScript argument evaluation or introduce a generic heap copier.

## Reproduced argument leak

`ArgumentListEvaluation.mts` appends values to `precedingArgs` and tagged-template substitutions to `restSub`. A control checkpoint saves references to these arrays, not their contents.

Before this change, branching inside `record("prefix", enabled ? "left" : "right")` left an earlier argument in the second branch. With false explored first, the next call received `["prefix", "right", "left"]` instead of `["prefix", "left"]`. Reversing the order produced the corresponding extra `"left"`. Both failures occurred with one prefix, selected ReferenceRecords, restored guest state, and forced GC.

The tests now explicitly select the argument accumulator through the owner callback. Ordinary calls, spread calls, construction, and tagged templates each match native execution in both branch orders. This is not automatic discovery or ownership of every array reachable from a continuation.

## Accepted storage

- The array must have the current native `Array.prototype`, be extensible, and have writable length.
- Its other own properties must be canonical indexed data properties: writable, enumerable, and configurable.
- Holes and explicit `undefined` entries stay distinct. Extra names, symbols, accessors, altered attributes, sealed arrays, and read-only length are rejected.
- Direct guest ObjectValue and EnvironmentRecord elements must belong to the current Agent.
- Arrays have no engine Agent brand. Frame ownership comes from the current Agent at selection, not proof of allocation provenance.
- Capture and restoration reject debugger preview. Existing Agent, LIFO, and released-checkpoint checks apply.

Restoration validates all selected lists before writing selected state. It then removes indexed entries and reconstructs the saved length and occupied slots in each original array. It does not invoke instance array methods or entry getters. These checks do not provide a hostile-host or native-Proxy sandbox.

The snapshot keeps live arrays and saved element values reachable through the existing collector. Plain native record contents remain outside collector traversal. Nested lists and callback state are not restored unless separately owned. Tests retain mutations to an unselected nested list, object, and callback counter.

The API imposes no list-size or collection-work budget. Sparse capture visits occupied properties, but the existing collector’s live-array traversal can visit holes.

## Evidence and remaining limits

All 28 final cases fail on the exact predecessor and pass with this patch. Eight fork cases produce 16 independent Node comparisons and assert one prefix per case. The original two-case leak probe and the initial descriptor-typing build failure remain in the [validation receipts](native-list-checkpoint-validation/summary.json).

All 1,831 units across 63 files, types, relocated builds, and the unchanged local 74-variant smoke pass. New source and published call/new/template-literal selections each pass 397 of 403 variants. The same six tail-call cases fail, but their errors differ: source times out; the published runner reports file-location errors. Input and compiled hashes match. These failures do not establish complete conformance.

The actual React diagnostic selects 1,842 native arrays and rejects 16 layouts per order. The [follow-up layout audit](react-native-array-audit.md) identifies twelve mutable parser argument lists with `location` fields and four frozen string-only slot tables. The audit preserves the rejections rather than treating syntax records as owned. It still rejects its first branch-created timer after one prefix, with no branch observations. React’s `trackedThenables` is a guest array; its source inspection is not proof of native-list ownership.

General execution ownership remains incomplete. Other native records, callback policies, module state, and host effects still require validation. There is no general guarded React report, transition/repeat output, or integrated symbolic demo. Host-effect guards remain enabled.
