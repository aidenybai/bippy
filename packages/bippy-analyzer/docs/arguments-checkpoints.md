# Arguments and parameter-map checkpoints

`arguments-checkpoints.patch` exposes engine262’s existing arguments storage to `createStateCheckpoint`. It does not replace argument access, binding, descriptor, or enumeration algorithms.

## Existing storage and implicit selections

Mapped arguments already use a guest `ParameterMap`, parameter binding cells, and a native `pendingMappings` table. Lazy map methods install the existing getter/setter functions when an index is accessed. The map switches to ordinary methods when no pending entries remain.

The patch exposes these references through a frozen `ArgumentsParameterMapData` record on the existing map. It retains the original environment, realm, pending table, and lazy methods. The checkpoint uses existing object/property and environment/binding snapshots. It also saves pending entries and the map’s current two method references. Restoration fills the original table and restores the original methods; it does not construct replacement argument objects, maps, or environments.

Selecting mapped arguments implicitly selects their parameter map and its parameter environment. Selecting that map directly also selects its environment. Identity deduplication applies across explicit and implicit selections. One mapped arguments object therefore counts as two objects and one environment. Unmapped strict/default-parameter arguments count as one object and select no environment.

The environment selection restores all its binding cells, not only the mapped parameters. Referenced objects, outer environments, initialized receiver objects, realms, and other native records remain unowned. Environment disposal and uninitialized-receiver restrictions still apply. Ordinary-only and closed-data graph checkpoints continue to reject arguments storage.

## Roots and validation

Live lazy-map metadata marks its environment and realm while pending mappings remain. Materialized accessors now populate their existing `Name` and `Env` slots. These slots were declared but unfilled, so the collector previously missed a reachable parameter value. Detached getter coverage verifies the accessor’s own root path.

Saved checkpoints retain their original environment and realm even after a branch consumes or deletes every mapping. Saved binding values use the existing snapshot roots. Releasing a checkpoint removes these saved roots. The fixture also checks that a live map with no remaining aliases does not retain the parameter value through unused lazy metadata.

Capture requires canonical slot layouts and methods. Restoration validates the original parameter-map/data identities and the current lazy-or-ordinary method state before selected writes. Changed metadata or methods reject. Standard Agent, preview, environment, constructor, prototype-cycle, and last-in-first-out checks remain in force. This contract assumes trusted engine metadata, not hostile host mutation.

## Evidence

`tests/arguments-checkpoint.test.ts` contains 22 cases. The preceding engine fails 21, with one existing rejection case passing. The final engine passes all 22 with identical test-source hashes. Coverage includes:

- Duplicate parameters, absent arguments, writable changes, deletion, accessor replacement, freezing, and prototype changes.
- Lazy, partially initialized, debugger-eager, strict, and default-parameter arguments.
- Original object, map, method, and getter identities, nested capture, and metadata preflight before writes.
- Parameter/accessor GC roots, saved roots, and release after alias removal.
- Both Agent branch orders, one prefix per order, forced GC, and four independent V8 branch observations.

The mapped matrix compares 18 branch observations with V8 and restores the baseline after each branch. Two initial empty-arguments comparisons exposed a V8 own-key discrepancy. Node 26.4.0 and 24.19.0 omit a newly defined non-enumerable index from `Reflect.ownKeys`, despite reporting an own descriptor. Published engine262 includes the index. The native-comparison matrix now creates that index by assignment before redefining it. A separate checkpoint test preserves the original non-enumerable-index case. The original failures and the published/native probe remain in the receipts.

The real React tree probe now accepts the 16 mapped arguments and 13 lazy parameter maps that previously rejected capture. It accepts 2,187 of 2,197 visited guest objects. Ten still reject: two intrinsic prototypes, three WeakMaps, four Errors, and one RegExp. Native arrays, context fields, queues, and omitted captures still need ownership policies. The probe only captures and releases selected storage, then rejects broader ownership. It never restores React state.

Local verification passes 1,552 unit tests across 49 files, typechecking, 74/74 unchanged smoke, and two relocated clean builds. The engine SHA-256 is `c81d30b77544165445520709ff6559e6059ee702e0b369de0f9039d7c95d13f2`. Arguments/Reflect.ownKeys/WeakRef conformance passes 542/544 in both source and published engines with matching source/compiled hashes and verdicts. The two retained failures are `10.6-13-a-2.js` and `10.6-13-a-3.js`; this is not a green conformance result. See the [validation receipt](arguments-checkpoint-validation/summary.json).

General React ownership, shared-prefix React trees, guarded reports, transitions, repeated families, and demo integration remain incomplete.
