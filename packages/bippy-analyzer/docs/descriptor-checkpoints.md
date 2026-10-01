# Read-only engine Descriptor records

`createStateCheckpoint({ descriptors })` validates selected engine `Descriptor` records without replacing them or writing their fields. Object checkpoints also include every descriptor retained from their selected property tables. `descriptorCount` counts distinct explicit and implied records.

This is a read-only policy for the final engine record, not a property-descriptor interpreter or a general native-record snapshot.

## Reused engine representation

The pinned engine’s `Descriptor` constructor defines six fields and a collector marker. `ValidateAndApplyPropertyDescriptor` replaces property-table descriptors through that constructor. `CompletePropertyDescriptor` also creates replacement records. `OrdinaryGetOwnProperty` returns a new descriptor, not the original property-table record.

The patch derives field names from the original constructor. It reuses the existing read-only slot checks, Agent ownership checks, checkpoint stack, and collector traversal. It does not change property access, conversion, getter/setter invocation, or guest object restoration.

Capture accepts the exact `Descriptor` prototype and six own data fields. Frozen records are allowed. It checks:

- Native Boolean or absent attribute flags.
- Guest values and callable or guest-undefined accessor fields.
- No mixed data/accessor descriptor.
- Same-Agent direct guest object references.

The layout check does not invoke field getters. Restore checks field identities, native property attributes, prototype, and extensibility before any selected state writes. A changed record rejects instead of silently restoring a property table that refers to corrupted metadata. The host mutation itself is unsupported and remains in place.

Existing Agent, release, and last-in-first-out rules apply. Explicit descriptor selection rejects debugger preview. Implied property-table records keep their containing object’s preview restrictions. Records have no allocation-Agent brand; direct guest object references provide the ownership check.

The collector visits live records and saved field values until release. This roots values but does not restore their contents. A selected descriptor can still point to an unselected object whose mutations survive restoration. Native prototype contents, arbitrary host callbacks, hostile proxies, and transitive ownership remain outside this policy.

## A separate mutable initializer leak

The predecessor’s `ToPropertyDescriptor` first filled a plain native `desc` object. It constructed a final `Descriptor` only after conversion. That initializer was not covered by the read-only policy. [Selected initializer storage](descriptor-initializers.md) now gives the mutable record a separate policy.

The retained diagnostic pauses inside this guest getter:

```ts
var target = {};
var input = {
  get enumerable() {
    if (enabled) input.value = 11;
    else delete input.value;
    return true;
  },
};
Object.defineProperty(target, "value", input);
```

The driver restores guest objects, global bindings, contexts, and control, then forces collection. It executes one prefix per branch order. False then true matches native execution. True then false leaves `11` in the native initializer’s `Value` field, where the independent native result is `undefined`.

The original diagnostic does not select initializer storage. The new selected-initializer tests fix this leak through explicit selection, not through the read-only policy. A shape-only rule that treats an empty native object as immutable would miss this mutation. The [receipt](descriptor-checkpoint-validation/summary.json) includes the full driver and failed output. General native-record ownership must cover this initializer separately.

## Verification

The exact predecessor fails 36 of the 40 final cases. Its four getter/setter branch controls already pass. The maintained engine passes all 40, including read-only rejection, implied selection, deduplication, field/layout validation, preview, Agent/LIFO rules, and collector release.

Four shared-prefix getter/setter forks cover both orders and eight independent Node observations. They check original property-table identity after restore and force collection. The initial driver incorrectly expected the live descriptor copy to be the table’s original record. The corrected assertions distinguish both identities, matching `OrdinaryGetOwnProperty`.

The actual React diagnostic selects 5,998 descriptors per order and still rejects its first branch timer. Each order executes one prefix, retains one timer, and produces no branch observations. Counts do not prove full ownership.

All 1,890 units across 65 files, typechecking, relocated builds, and the unchanged local 74-variant smoke pass. Source and published descriptor-reflection selections each pass 706 variants with matching input and compiled hashes. The empty `Object/defineProperty/desc*.js` glob contributes no cases. Reflect.defineProperty is included; the full Object.defineProperty suite is not.

An initial source conformance command repeated the script’s `--threads=2` option. It exited zero without a report and is not counted as a pass. The corrected command omits that duplicate argument. The receipt also preserves the initial build failure from a lost `Agent | undefined` narrowing inside a callback.

Run the focused checks with:

```sh
pnpm --filter bippy-analyzer test --run tests/descriptor-checkpoint.test.ts
```
