# Selected descriptor initializer storage

`createStateCheckpoint({ descriptorInitializers })` restores the mutable record used by engine262’s `ToPropertyDescriptor`. This fixes the selected-state branch leak documented in [final Descriptor validation](descriptor-checkpoints.md).

## Keep the conversion algorithm

`DescriptorInitializer` extends the original `Descriptor` class. It reuses the six-field constructor and collector marker, while declaring its fields writable. `ToPropertyDescriptor` allocates that record instead of a plain object. Its property checks, getter calls, field assignments, validation order, and final `Descriptor(desc)` call remain unchanged.

The initializer now starts with six own fields containing native `undefined`, rather than an empty native object. The algorithm reads these fields by value. It does not expose the initializer as a guest object. The original constructor accepts partial input through a protected signature so the initializer can call `super({})`. The first build rejected that call under the previous intersection type; the failure is retained.

This does not replace property conversion with a new algorithm or turn mutable assignment into immutable copies. One initializer object remains live through conversion and restoration.

## Selection contract

The checkpoint reuses the existing descriptor slot snapshots and saved roots. `descriptorInitializerCount` counts distinct selected initializers. `descriptorCount` still counts final read-only descriptors separately.

Initializers require their exact prototype and an extensible record with six writable, enumerable, configurable data fields. Capture and restore validate guest values, attribute types, callable accessors, and same-Agent direct object references. Frozen, sealed, accessor-backed, foreign-object, extra-field, and altered-prototype storage rejects before selected writes.

An intermediate initializer may contain both data and accessor fields. `ToPropertyDescriptor` owns the eventual guest TypeError and its ordering. A checkpoint must not reject that legitimate intermediate state as if it were a final descriptor.

Restore writes saved values into the original record after preflight. It preserves record identity and aliases. Existing Agent, preview, release, and last-in-first-out restrictions apply. Selection copies and deduplicates the supplied identities.

The final `descriptors` policy rejects initializer records. The mutable policy rejects final descriptors. When discovering references, classify `DescriptorInitializer` before its base `Descriptor` class.

Selection remains shallow. It does not restore referenced objects, captured environments, native prototypes, or arbitrary native records. It does not authorize host effects or add an automatic transitive owner. An unselected initializer can still leak across restoration.

## Branch and collector checks

Five programs cover value presence, accessor presence, data/accessor switches, attributes, and abrupt conversion. Each runs both branch orders with one shared prefix and forced collection. All 20 branch results now match independent Node execution, including throws and `finally` effects.

The exact predecessor fails 30 of the 31 final tests. Failures include stale values, stale attributes, and invalid mixed descriptors left by another branch. The registered-evaluator collection control already passed before this patch. It is not evidence of a previously failing GC case. The new class reuses the existing marker, and selected snapshot tests verify retention and release without claiming ownership of referent contents.

The actual React probe selects zero initializers at its current pause. Its 5,998 final descriptors remain accepted, and its first branch timer still rejects. Both orders execute one prefix, retain one timer, and produce no branch observations. This fixture does not prove React initializer coverage or general branch isolation.

## Validation

All 1,921 units across 66 files, typechecking, two relocated builds, and the unchanged local 74-variant smoke pass. New source and published property-conversion selections each pass 1,190 variants. Input hashes, compiled hashes, and verdicts match.

The first combined conformance command exceeded the tool’s 240-second limit after source completed. Its partial published report is retained and is not counted. A separate complete published run supplies the comparison. Test262’s ten-second timeout and two workers were unchanged.

[Validation receipts](descriptor-initializer-validation/summary.json) retain the exact predecessor, build failure, reports, test hashes, and diagnostic sources. General React execution ownership, guarded reports, transitions, repeated-state families, and the integrated demo remain incomplete.

```sh
pnpm --filter bippy-analyzer test --run tests/descriptor-initializer.test.ts
```
