# Private object storage plans

The existing checkpoint builder now uses a private `getObjectStoragePlan` helper for guest-object storage. It separates the original schema validation and snapshot construction from selection of additional records. This prepares the automatic execution owner without adding a public checkpoint API or another heap copier.

## Reused storage and reference views

Each plan contains the original object-state snapshot and implicit mapped-argument object/environment selections. The existing checkpoint builder still validates selected descriptors and environments, publishes one frame, and performs restoration and GC marking. A standalone plan does not perform those later checks or publish a checkpoint.

`visitReferences(scope, visitor)` emits labelled references one at a time. A throwing visitor stops before later references are read. It does not first allocate an array of every edge.

The `data` view preserves the closed guest-data traversal:

1. The saved guest prototype.
2. Property keys and descriptor `Value`, `Get`, and `Set` fields in original property order.
3. Saved Map keys and values, including tombstones.
4. Saved Set entries, including tombstones.

The `execution` view also exposes schema-known dependencies:

- Agent, native prototype, method implementation, property-table, internal-slot-list, and private-element-list references
- Original constructor lists and their saved entries
- Original property descriptor records
- Function metadata, including Environment, Realm, ScriptOrModule, syntax, Call, Construct, nativeFunction, and bound arguments
- Arguments parameter-map records, environments, Realm, pending mappings, current methods, and retained lazy methods
- Error, RegExp, string, and immutable-prototype metadata
- Original collection storage arrays and Map entry records

Reference kinds distinguish data, native metadata, implementations, weak keys, and weak values. They describe edges, not ownership decisions or runtime value types. WeakMap key/value pairs retain their entry indices and weak-edge labels. They are not converted into ordinary strong data edges, and the existing closed-data API still rejects WeakMap storage.

## Boundaries and compatibility

No reference is admitted because it appears in a plan. Native functions, Realm, Script, environment, implementation, and storage-container dependencies need their own policies. Neither view is a complete native-heap schema, allocation-provenance check, confinement mechanism, or stable ownership certificate.

The plan mixes saved references with live native metadata. Property and collection selections, function slot descriptors, and other existing snapshot fields retain their original representation. Some additional metadata references, such as `internalSlotsList`, are read when visiting the execution view. A test replaces that native reference after planning and observes the replacement. Native reflection and engine representation integrity remain trusted.

Plans do not become collector roots. Another test retains a plan in the host while its unrooted guest target is collected. Callers must arrange roots and complete all remaining validation before accepting execution ownership.

Object-count checks remain before the next object’s schema inspection. Schema validation precedes entry charges, and entry charges precede property/collection copying. Property, Map, and Set sentinels verify these boundaries. Object snapshots now precede data-edge traversal; a native copy failure can therefore occur before an invalid outgoing-reference error. No claim preserves arbitrary trusted native-hook ordering. No new general work or allocation budget is added.

The helper is not exported by the engine API. Tests access its compiled capture binding, so “private” does not mean inaccessible to trusted capture introspection. Existing host-effect guards, collector algorithms, restore algorithms, and public checkpoint contracts remain unchanged.

## Evidence and remaining owner work

Thirty-one tests cover property and Symbol edges, non-executed accessors, bound functions, builtin callbacks without capture-factory execution, mapped arguments, metadata, collection ordering/tombstones, budget precedence, unsupported schemas, foreign roots, streaming failure, and mixed saved/live references. Existing checkpoint tests exercise the shared planner’s restoration path.

At the actual aliased-call pause, the test inspects the closure and finds its Environment, Realm, ScriptOrModule, syntax, and native Call dependencies. The ordinary state object retains its intrinsic prototype edge. A test-only rejecting owner stops at the native completion callback before reaching the accumulator or publishing a frame. The prefix and exact pause remain intact. This is dependency visibility and rejection evidence, not an implemented automatic owner or a successful Script fork.

React reference `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, `ReactFiber.js: FiberNode`, stores parent/child/sibling links, state, and queues in ordinary objects. This refactor does not establish ownership of those graphs or add accepted shared-prefix React branches.

Final local checks pass 130 focused cases, 2,442 units across 101 files, types, two relocated builds, frozen offline installation, and the root check. The unchanged 74-case smoke passes. Fresh Object.create/Reflect.defineProperty conformance passes 664 variants in both maintained and published engines with matching input, compiled, and verdict hashes. All existing timeout and worker limits remain unchanged.

The identical-final-test predecessor records 25 missing-private-helper failures and six existing data-graph rejection/budget controls. This is not evidence of 25 semantic fixes. Review prompted collection-order, budget-precedence, and mixed-metadata tests. Eager edge-array construction was replaced with streaming visitation. The [validation receipt](object-storage-plans-validation/summary.json) retains the intermediate and final results.

The preceding idle-membership commit passes CI, E2E, and publishing, including 2,411 units and 74 smoke cases. Earlier failures remain separate evidence. Automatic execution ownership, general React isolation, reports, transitions, repeated families, and integrated demo output remain incomplete.
