# Read-only script syntax validation

An opt-in engine policy records finalized `ParseScript` syntax and detects later changes. It preserves the original nodes, descriptors, accessors, and parser algorithms. It does not freeze syntax, copy an execution heap, or supply a general state owner.

## Enable and validate

Set `agent.hostDefinedOptions.scriptSyntax = {}` before parsing. Successful `ParseScript` calls register their syntax after parent linking and before publishing a `ScriptRecord`. Default parsing remains untracked.

`getScriptSyntaxRegion(value)` returns the region for a registered member, or `undefined` for an unregistered value. A foreign Agent lookup throws. The frozen region exposes:

- `scope: "read-only-parsed-script-syntax-v1"`
- The original Script root.
- Record and entry counts, configured limits, and the number of Parser source owners.
- Borrowed native prototype references.
- `validate()`, which checks the finalized baseline without restoration.

Validate before using syntax as a read-only dependency, before continuing a captured branch, and before accepting its report. A failed validation must abort exploration. Do not repair syntax and treat the failed branch as valid.

Registration and lookup are not validation. The Boolean snapshot driver does not automatically validate regions. Its supplied owner can validate during capture and restoration. A no-fork evaluation creates no owner, so the caller must also validate before accepting that result.

Validation checks state when called. It is not a write barrier and cannot detect a change that was undone between checks. Native callbacks must respect the read-only syntax contract. Metadata, reflection, parser implementations, and ambient built-ins remain trusted, not sandboxed.

## Covered storage and provenance

Parser allocation sites privately record original node getters and arrow-info methods. Finalization follows registered nodes, syntax lists, locations, positions, parent cycles, and the known functions’ own properties. Lists with a `location` property remain original arrays. Runtime argument accumulators remain separate mutable lists.

The baseline records own-key order, prototypes, extensibility, property values, flags, and accessor identities. Validation does not invoke property getters. Unknown references, accessors, list fields, and noncanonical prototypes reject registration. Membership does not come from a field name, frozen status, or `instanceof ScriptRecord`.

The Script and ScriptBody getters need a separate rule. They close over `Parser` and read its `source` field. The policy validates that original own data property as a projection. It does not register the Parser as a region member or own its scopes, tokens, or other fields. Other node getters retain their original source string and node location.

The region explicitly borrows `Object.prototype`, `Array.prototype`, `Function.prototype`, and `String.prototype`. It does not own those objects or authorize calls through them. Function-property validation does not grant permission for arbitrary execution effects.

Private registration is an API boundary, not a security boundary against native capture introspection or modified parser implementations.

## Limits and lifetime

The default limits are 100,000 syntax records and 1,000,000 own-property entries. Set `maxRecords` and `maxEntries` explicitly to change them. Both accept safe integers starting at zero. Their maxima are 1,000,000 records and 8,000,000 entries.

A limit failure publishes no region or ScriptRecord. These limits apply to registration, not preceding parsing, source allocation, or native execution. Parser source projections are counted separately from syntax records.

Regions are metadata, not checkpoint leases. They have no restore or release operation. Weak membership does not root an otherwise unreachable region. Holding a region or member retains its baseline graph and source owners. There is no eager-reclamation guarantee.

## Evidence and boundaries

The [validation receipts](script-syntax-region-validation/summary.json) retain these cases:

- Both branch orders execute one prefix. An owner that omits syntax permits a changed trailing literal to affect its sibling. The sibling returns `101` or `102`, instead of native `11` or `12`.
- With region validation, mutation after either the first or final observation aborts the forked report. A separate no-fork test validates before accepting its result.
- Descriptor, literal, list, location, position, function-property, prototype, and Parser source changes reject. A substituted getter is not called during validation.
- Eight tracked programs match fresh Node results, including destructuring, arrows, private fields, generators, templates, loops, async declarations, and optional chaining.
- Actual React mounts, drains, and reaches an opaque update decision. Its registered syntax lists are recognized and validate. The owner then rejects remaining execution state, with one prefix and no branch observations.

The React bundle exceeds the default 100,000-record registration budget. Its test explicitly requests 500,000 records and 4,000,000 entries. The original failed run remains in the receipts. Defaults and existing execution gates are unchanged.

The exact final-source predecessor has 38 failures and six untracked controls. Those failures establish the absent region API and policy, not 38 independent engine bugs. An earlier probe omitted runtime argument accumulators and incorrectly reused the first call’s arguments. The final fixture snapshots those accumulators through the existing native-list API before testing syntax integrity.

Direct `Parser` results, modules, failed parses, and runtime-generated refinements do not gain region membership. `ScriptRecord`, `LoadedModules`, the Agent parse registry, parser state beyond `source`, native closures beyond the recognized accessors, and borrowed prototypes remain separately owned or unsupported. Tracking a new parse during a branch does not roll back its registry writes or authorize effects.

General React branch isolation, transitions, repeated-state families, and integrated report production remain incomplete. This policy supplies one syntax integrity check, not a complete transitive execution owner.
