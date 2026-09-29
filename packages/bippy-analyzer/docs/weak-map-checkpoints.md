# Selected WeakMap storage

`weak-map-checkpoints.patch` lets `createStateCheckpoint` select WeakMaps. It reuses the existing Map entry snapshots, restore loop, and checkpoint roots. The patch adds a storage selector for `MapData` or `WeakMapData`, not another collection algorithm or collector.

Capture saves the original list, entry records, keys, values, and tombstones. Restore changes the original list and records in place. Branch-added entries disappear. Guest properties, prototype, extensibility, and constructor tracking use their existing snapshots. Replacing the collection list rejects before selected writes.

Referenced keys and values remain shallow. Select their objects separately if their properties must restore. Ordinary-only and closed-data APIs still reject WeakMaps. WeakSets, proxies, and private-instance storage remain unsupported.

## Saved entries retain their keys

Open checkpoints strongly root saved keys and values through the existing Map snapshot roots. This keeps deleted entries available for restoration. It can delay weak-reference clearing and finalization, so it is not a native-GC lifetime equivalence claim.

Entries created only in the current branch do not gain those snapshot roots. Release removes saved roots. The existing ephemeron collector can then clear keys and values that have no other roots. Tests distinguish saved object/symbol keys from branch-only cycles, and verify collection after release. No GC algorithm changed.

## Actual React state discovery

The React source checkout at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` shows relevant weak caches. `shared/ReactComponentStackFrame.js` stores component frames in a WeakMap when available. `ReactFiberWorkLoop.js` creates a WeakMap-backed ping cache. This does not establish ownership of their callbacks or scheduling state.

The original React/Test Renderer 19.3.0 diagnostic now accepts all 2,197 visited guest objects. Its three WeakMap rejections are gone. That diagnostic follows marking methods and native arrays, which omit some ownership edges.

An expanded diagnostic also follows Map/WeakMap entry keys and values, plus each CallSite’s original context. Its four input assignments produce identical reports:

- 65,644 root references and 19,616 distinct visited objects.
- 2,199 guest objects, all accepted by selected capture.
- 97 declarative environments, 40 function environments, one global environment, and one object environment.
- 1,852 native arrays, 20 execution contexts, 24 CallSites, and 684 native functions.

One combined selected checkpoint captures 2,199 objects, 138 environments, and 814 binding cells. It is released without restoration. The owner then throws the same rejection sentinel, and execution resumes the original decision.

Neither diagnostic implements transitive ownership. Native records, context fields, undeclared captures, queues, modules, and host effects still require policies. Marking edges are not a complete reference graph. There is no shared-prefix React restore or guarded tree API.

## Verification

`tests/weak-map-checkpoint.test.ts` contains 16 cases. The exact final source fails all 16 against the preceding engine, without timeouts, then passes with the patch. The previous blanket WeakMap rejection in `collection-checkpoint.test.ts` is replaced by this positive coverage.

Object, symbol, self-key, and public-subclass cases run both branch orders. Sixteen branch observations and ten baseline comparisons match independent V8 runs. Tests preserve original list/record/property-table identities, tombstones, undefined values, aliases, and mutations after freezing. Other checks cover nested snapshots, shallow values, validation before writes, saved roots, release, and strict rejection boundaries.

Two Agent runs compare four branches with independent V8 programs, one prefix per run, and GC at each restore. These are WeakMap cache forks, not React forks.

Local gates pass 1,664 tests across 53 files, typechecking, and the unchanged 74-variant smoke. Source and published engines pass the same 411 selected WeakMap/WeakRef/Map get-set-delete conformance variants. Input hashes, compiled hashes, and verdicts match. Both commands exit zero. Two relocated builds produce SHA-256 `4b41a77cd0e4a12995624c7c9e9f51bc17c22e69bc59c50af5691981d98aaac6`.

[Validation receipts](weak-map-checkpoint-validation/summary.json) retain baselines, logs, hashes, both diagnostic drivers, and their reports. General React ownership, guarded reports, transitions, repeated families, and demo integration remain incomplete.
