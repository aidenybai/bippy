# Selected Map and Set checkpoints

`createStateCheckpoint({ objects })` now restores selected engine Maps and Sets. It preserves collection identity, insertion order, and the original internal lists. This is selected storage restoration, not transitive ownership or React branch isolation.

## Engine records

Engine262 stores Map entries in `MapData`. Each entry has mutable `Key` and `Value` fields. Deletion clears these fields but retains the entry record. Set uses a `SetData` list, with native `undefined` marking deleted positions. Guest `undefined` is a different engine value.

`collection-checkpoints.patch` extends the existing object snapshot. Capture saves Map entry identities and their field values, or Set list values. Restore updates the original entry records and repopulates the original lists. It removes branch-only entries without calling guest methods, iterators, getters, or traps.

The existing property-table, prototype, extensibility, binding, and checkpoint-stack policies remain in effect. Saved Map keys and values, and saved Set elements, enter the existing checkpoint marking protocol. Release removes those saved roots. Restored collections retain their own reachable entries independently.

Capture accepts ordinary internal methods with exactly `Prototype`, `Extensible`, and the corresponding data slot. Extra internal state and existing private elements still reject. Restore checks internal method identities and collection-list identity before changing any selected data. Replaced lists reject with `Checkpoint collection data list changed`.

The scope remains `selected-objects-and-bindings-v1`. `objectCount` includes selected collections and removes duplicate identities. `createOrdinaryObjectCheckpoint` still rejects Maps and Sets.

## Set zero correction

Independent V8 comparisons exposed a concrete engine bug before any restoration. Set stored `-0` instead of canonical `+0`. Its check used `R(value)`, which converts negative zero to mathematical zero before testing the sign.

`set-zero.patch` calls the existing `CanonicalizeKeyedCollectionKey` operation. It does not add comparison semantics. Four direct regressions cover construction, addition, duplicate keys, and delete/reinsert through values, keys, entries, and callbacks. All four failed before this correction.

The pinned published engine also retains negative zero. Both engines pass the existing Test262 zero-normalization case, which checks size but not stored sign. Green conformance alone did not cover this behavior.

## Verification

The 23 checkpoint tests cover:

- Three mutation scripts for each collection, in both visitation orders, with independent V8 comparisons.
- Native-list and Map-entry identity, deleted positions, NaN, zero, guest undefined, symbols, aliases, and self references.
- Clear, delete/reinsert, property descriptors, prototype changes, integrity changes, and frozen collections.
- Six Object/Symbol root cases through capture, clearing, restoration, release, and final removal.
- Nested Map/Set/array snapshots and selected binding cells.
- List replacement, preview, foreign-Agent, LIFO, weak-collection, proxy, and private-state rejection.
- Explicit evidence that unselected iterator positions and referenced object mutations do not rewind.

All 23 initial cases failed before implementation. The first implementation passed 21 but exposed the two Set sign mismatches. The final local suite passes 1,315 tests across 37 files. The unchanged smoke passes 74/74. Full Map/Set Test262 paths pass 1,169/1,169 in both engines. [Validation receipts](collection-checkpoint-validation/summary.json) retain reports, source hashes, intermediate failures, and the interrupted first conformance run.

## Remaining ownership work

A selected collection does not select its entries recursively. [WeakMap selection](weak-map-checkpoints.md) now reuses these snapshots with saved-key retention. WeakSet, iterators, native host containers, jobs, modules, Promise state, and Agent control metadata remain outside this extension. The tests do not resume a paused collection callback or isolate actual React branches.

React checkout `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` provides two relevant uses. `ReactChildFiber.js:mapRemainingChildren` maps child keys to fibers. `ReactFiberWorkLoop.js:attachPingListener` stores lane sets in a possibly weak cache. These uses motivate collection restoration but do not verify branch-safe reconciliation or Suspense.

Bound stored entries, including deleted positions, rather than only live collection size. Syntax-step budgets do not bound native snapshot work. Do not change engine record metadata through host code while a checkpoint is open. The [React completion checklist](symbolic-react-status.md) remains incomplete.
