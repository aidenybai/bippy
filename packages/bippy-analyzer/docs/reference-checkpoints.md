# Selected ReferenceRecord checkpoints

`createStateCheckpoint({ referenceRecords })` now restores selected engine ReferenceRecords in place. It uses their existing constructor and marker, within the existing Agent-owned checkpoint stack. The returned `referenceRecordCount` counts distinct selected records.

## Why the record needs restoration

Engine262 stores a computed key in `ReferenceRecord.ReferencedName`. `GetValue`, `PutValue`, and property deletion can replace that value with its converted property key. Restoring a continuation’s reference to the record does not restore this field.

This matters when a decision occurs between evaluating an assignment target and writing its value:

```ts
object[key] = enabled ? ((choice = "left"), 11) : ((choice = "right"), 22);
```

The test’s `key.toString()` reads `choice` and increments a counter. Before this change, the second branch used the first branch’s property key and skipped conversion. Both branch orders failed against independent Node execution despite restoring the selected guest objects and bindings. The original two-case probe and failures are retained in the receipts.

The patch restores the original `ReferencedName` reference. It does not clone the record or rerun key conversion. `Base`, `Strict`, and `ThisValue` remain read-only metadata and must retain their original identities or values.

## Selection contract

- Records must have the canonical ReferenceRecord prototype and four writable data fields, without extra own properties.
- Each field must contain its supported engine value. Object and environment references must belong to the current Agent.
- The record has no Agent provenance brand. A structurally valid record containing only primitive engine values can be selected under the current Agent.
- Capture and restoration reject debugger preview. Existing Agent, LIFO, and released-checkpoint guards apply.
- Restoration validates all selected references before writing selected state. Accessor replacements are rejected without invoking the getter.
- Existing `ReferenceRecord.mark` roots both live and saved fields until release.

Selection is shallow. It does not own an object’s contents, environment bindings, PrivateName contents, other native records, or the context stack. The tests confirm that unselected object mutations and newly created environment bindings survive restoration. Closed-data checkpoints remain unchanged.

## Validation

The exact predecessor fails all 28 final tests. The maintained build passes them, plus all 1,803 units across 62 files. Eight continuation cases cover assignment, destructuring defaults, super assignment, and Symbol keys in both branch orders. They produce 16 independent Node comparisons, force GC, and assert one prefix per case.

Tests also cover aliases, deduplication, read-only metadata, invalid layouts and field values, foreign references, preview, LIFO, release, and saved/live weak roots. Initial TS2673 errors and a failed attempt to call macro-only value constructors remain in the logs. The final tests use the engine’s `Value` factory.

Types and two relocated source builds pass. The unchanged local smoke passes 74 variants. New source and published assignment, property-access, computed-super, and delete selections pass 394 variants each, with matching input and compiled hashes. [Validation receipts](reference-checkpoint-validation/summary.json) retain the reports and intermediate failures.

The actual React diagnostic selects 20 ReferenceRecords in each branch order. It still rejects its first branch-created timer after one prefix, with no branch observations. React’s tracked-thenable indexing was inspected in the pinned source, but this diagnostic does not prove that React itself exercises the coercion-cache failure. Application-level computed assignments demonstrate that failure independently.

General React execution ownership, guarded reports, transitions, repeated-state families, and the symbolic demo remain incomplete. Host-effect guards stay enabled.
