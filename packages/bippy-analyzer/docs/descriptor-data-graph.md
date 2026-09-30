# Descriptor-to-data graph checkpoints

`createDescriptorGraphCheckpoint({ roots, maxObjects?, maxEntries? })` combines canonical descriptor storage with the existing closed guest-data graph traversal. Starting from final `Descriptor` or mutable `DescriptorInitializer` roots, it selects their supported guest-object dependencies automatically. Its scope is `descriptor-data-graph-v1`, not complete execution ownership.

## Selection and restoration

The planner uses the original `getDescriptorState` validator before following root fields. Guest objects in `Value`, `Get`, or `Set` enter the existing [data-graph traversal](data-graph-checkpoints.md). Flags and primitive engine values do not require separate mutable-object snapshots.

The guest traversal follows prototypes, own property descriptors, Map entries, and Set members. It includes non-enumerable and Symbol-keyed properties, aliases, and cycles. Functions and unsupported state reject; a function in a root’s `Get` or `Set` slot is not a leaf. Accepted guest graphs must remain within the existing null-terminated, data-only scope.

Only after validation and traversal succeed does the planner publish one existing state-checkpoint frame. It does not combine independent snapshots, copy an arbitrary native heap, or replace original collections. On rejection, the planner publishes no checkpoint frame. It does not roll back effects from trusted caller hooks.

The result exposes:

- `objectCount`, the selected guest objects
- `descriptorCount`, final records including selected guest property descriptors
- `descriptorInitializerCount`, mutable root initializers
- `entryCount`, the capture traversal charge
- `restore()` and `release()`

Final descriptor metadata must remain unchanged. Mutable initializer fields and the selected guest graph restore through their original schemas. Validation precedes writes; a changed final descriptor prevents restoration of other fields. Original Agent, preview, LIFO, GC retention, and release rules remain in effect.

## Limits and trust boundary

`maxObjects` defaults to 10,000 guest objects. `maxEntries` defaults to 100,000 entries. Both must be positive safe integers, as with the existing data-graph API.

The entry charge includes every input root reference, six fields per distinct explicit descriptor root, and existing guest-graph traversal entries. Duplicate roots consume input entries but do not duplicate record snapshots. Property descriptors reached through guest objects retain the existing per-property entry charge.

Root membership is copied once by index using its captured length. The planner pins the current Agent and rejects a root getter that leaves another Agent active. These limits do not bound arbitrary native reflection, callbacks, parsing, allocation, GC, or restoration work.

Canonical record validation is not allocation provenance. A native object with `Descriptor.prototype` and the canonical six data fields passes the existing record schema. A test preserves this boundary explicitly. Engine representations, native reflection, metadata, and implementation prototypes remain trusted. The planner does not certify hidden native state, protect against prototype spoofing, or own arbitrary native class instances.

External values still need caller-provided roots if callbacks trigger GC before checkpoint publication. A successful checkpoint retains its saved referents until release.

The graph covers selected schema fields and guest data reachable at capture. It does not own external aliases, future escaped allocations, execution contexts, environments, queues, modules, or effects. Capturing a graph does not authorize host operations. This API must not be promoted to a general execution owner without those additional policies.

## Evidence

Four fixtures pause inside the original `ToPropertyDescriptor` algorithm after its `value` getter returns a payload. Its later `writable` getter then chooses a normal or throwing suffix. The original initializer is the sole graph root; payload, aliased child, and target are selected without caller object lists.

Both branch orders run one prefix, force engine GC, preserve identities, and match eight independent Node observations. Context-stack restoration remains caller-supplied. The surrounding continuation graph is not declared owned.

Other cases cover collection entries, arrays and holes, cycles, symbols, removed-edge GC retention, final-record preflight, limits, root copying, foreign Agents, preview, and LIFO access. Unsupported ordinary prototypes, functions, hidden/Symbol-keyed callable dependencies, weak state, and malformed records reject. Native function roots do not execute their capture factories.

The React fixture wraps its actual application export in a descriptor at a paused update. The original data-only schema rejects unsupported storage, leaving the checkpoint stack and exact pause intact. It produces one prefix and zero branch observations. React’s `mountRef` stores an ordinary `{current: initialValue}` object; this limited null-terminated data policy does not establish ownership of such React state.

Final local checks pass:

- 23 new tests and 117 focused tests
- 2,384 unit tests across 99 files
- Types, two relocated builds, frozen offline installation, and the root check
- The unchanged 74-case smoke selection
- 664 fresh source/published Object.create and Reflect.defineProperty variants with matching input, compiled, and verdict hashes

The exact predecessor fails all 23 new tests because the API is absent. These are missing-feature baselines, not 23 semantic bugs. The first expanded run passed 114 cases but failed a React assertion that expected function rejection. The unchanged fixture instead reaches the broader unsupported-storage rejection first; the final assertion matches that actual boundary. Both results remain in the [validation receipt](descriptor-data-graph-validation/summary.json).

The preceding discovery-order CI run exceeded its ten-minute job deadline during unit execution. Browser/dependency installation took about five minutes forty seconds; smoke and profiling were skipped. E2E and publishing passed. No complete unit or smoke verdict is inferred, and no gate timeout changed.

Automatic execution ownership, general shared-prefix React isolation, automatic reports, guarded transitions, repeated-state families, and demo integration remain incomplete.
