# Immutable-prototype and string-object properties

`intrinsic-checkpoints.patch` lets `createStateCheckpoint` select canonical immutable-prototype and string-exotic objects. This includes `Object.prototype`, `String.prototype`, and boxed strings. It reuses engine262’s existing methods, property tables, constructor tracking, and checkpoint validation.

The patch exports the method tables already used by `makeObjectPrototype` and `StringCreate`. The shared method checker accepts their canonical overrides. No prototype-setting, string-indexing, descriptor, or enumeration algorithm is copied or replaced.

## Storage contract

Property descriptors, key order, extensibility, and mutable prototypes restore in the original objects and tables. String indices remain virtual. Capture reads the stored property table, not `OwnPropertyKeys`, and does not materialize character properties or invoke guest getters.

An immutable-prototype object’s `Prototype` slot and a string object’s `StringData` slot are read-only metadata. The existing function-slot descriptor comparison now also checks these slots. Changed values, descriptor flags, accessor metadata, or noncanonical methods reject before selected writes. String prototypes may change normally; the existing projected-prototype check rejects restoration that would create a cycle.

This is selected storage, not an intrinsic whitelist or transitive ownership. Referenced constructors, properties, closures, realms, and host state still require separate ownership. Existing private-state, Agent, preview, constructor-list, and last-in-first-out restrictions remain. The ordinary-only and closed-data graph APIs still reject these exotic objects.

## React relevance

The existing React checkout at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` supplies the source reference. `shared/hasOwnProperty.js` caches `Object.prototype.hasOwnProperty`. `ReactChildFiber.js` calls `Object.prototype.toString` when describing invalid children. Intrinsic objects are reachable mutable storage, not safe omissions from a React checkpoint.

The installed React/Test Renderer 19.3.0 probe now accepts the two intrinsic prototypes it previously rejected. It accepts 2,189 of 2,197 visited guest objects. Eight still reject: three WeakMaps, four Errors, and one RegExp. The probe captures and releases selected storage, then rejects broader ownership. It never restores React. Marking-based discovery also omits state and does not establish ownership of native arrays, contexts, queues, or host effects.

## Verification

`tests/intrinsic-checkpoint.test.ts` contains 22 cases. The exact final fixtures fail 19 cases against the preceding engine, while three existing rejection cases pass. All 22 pass with the patch; no timeout limit changed.

Five targets cover both prototypes and empty, ASCII, and surrogate-containing boxed strings. Both visitation orders check 20 branch observations against independent V8 runs, then restore the original engine baseline. Full intrinsic key order compares against that engine baseline, since native intrinsic installation order can differ. Other checks cover:

- Getter-free capture, virtual UTF-16 indices, symbols, descriptors, aliases, freezing, and prototype changes.
- Original object/table identities, read-only metadata, rejected metadata getters, and cycle preflight before any writes.
- Saved property GC roots and release.
- Both Agent branch orders for each prototype, eight native branch comparisons, one prefix per order, and GC at each restore.

Local gates pass 1,574 tests across 50 files, typechecking, the unchanged 74-variant smoke, and two relocated clean builds. Source and published engines pass the same 403 string/prototype/own-property-name variants with matching input hashes, compiled hashes, and verdicts. The engine SHA-256 is `e125a2a1cca5d228477d763e04a661fc9ac619d6eb64a30bd4c4ce2ce640dde7`. [Validation receipts](intrinsic-checkpoint-validation/summary.json) retain baselines, commands, hashes, and probe results.

General React ownership, shared-prefix React trees, guarded reports, transitions, repeated families, and demo integration remain incomplete.
