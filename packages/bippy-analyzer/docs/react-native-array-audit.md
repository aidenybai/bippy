# React native-array ownership audit

The partial React owner rejects 16 arrays at the current pause. This audit identifies their layouts and incoming references. It does not expand checkpoint acceptance or permit host effects.

## Four frozen slot tables

Four arrays are non-extensible, frozen, and string-only. Their length and indexed properties are non-writable. Capture bindings identify the original tables:

| Table                          | Entries | Source                                 |
| ------------------------------ | ------: | -------------------------------------- |
| `builtinFunctionInternalSlots` |       6 | `abstract-ops/function-operations.mts` |
| `regexpInternalSlots`          |       3 | `abstract-ops/regexp-objects.mts`      |
| `boundFunctionInternalSlots`   |       5 | `intrinsics/FunctionPrototype.mts`     |
| `errorInternalSlots`           |       5 | `intrinsics/Error.mts`                 |

Each source declaration uses `Object.freeze`. Bound functions also reference their table through `internalSlotsList`. These arrays are candidates for read-only leaves, not mutable-list snapshots. Their frozen string contents do not establish ownership of native prototypes, functions, or other reachable state.

## Twelve parser argument lists

The other twelve arrays are extensible and mutable. Each has a writable, enumerable, configurable `location` property. Each incoming parse-node reference is a `CallExpression.Arguments` field. Elements are parse nodes, not evaluated arguments. One list is empty but still has location metadata.

`ExpressionParser.parseArguments()` appends syntax nodes, then attaches the location with `Object.assign`. `getLocation()` creates mutable start/end records, and `markLocationEnd()` writes their fields. The audit records the actual property flags and incoming identities, rather than inferring provenance from a field name alone.

`ArgumentListEvaluation_Arguments()` reads the syntax list and builds a separate `precedingArgs` array. The existing native-list checkpoint restores that runtime accumulator. Accepting the syntax list would still leave its parse-node and location contents unowned.

The current native-list API correctly rejects the extra `location` field. A `location` property alone is not permission to treat an array as immutable. This audit neither freezes parser data nor introduces a generic native-object copier.

## Evidence and limits

Both visitation orders report four frozen tables and twelve parser lists. Each order executes one prefix, retains one timer, and rejects the first branch timer without observations. The engine bundle remains `16cb86ba3e7016f4220898f3de07e5cdc75559342ec0ed93c877a161c33e1720`.

[Audit receipts](react-native-array-audit/summary.json) contain the driver, complete reports, source hashes, and focused run. The driver scans incoming own data properties and trusted capture bindings without invoking property getters. This diagnostic is not a complete graph traversal or an ownership verifier.

The same discovery finds 2,477 native functions, of which 59 lack capture manifests. These include native constructors and helpers. That is a separate ownership problem; class names and reference counts do not prove safe execution. The later [class lexical-capture increment](native-class-captures.md) registers supported constructors but still reports class storage as unowned. Its expanded diagnostic retains 15 unregistered functions and rejects the first timer.

General React branch isolation remains incomplete. The next owner policy must distinguish immutable metadata, already-selected storage, and unsupported native state before enabling branch effects.
