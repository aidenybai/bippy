# Builtin behaviour references

Builtin objects now expose their existing `nativeFunction` through `ObjectValue.mark`. A continuation owner using the engine’s marking protocol can follow that reference into existing native-capture metadata. This closes a missing discovery edge, not a complete execution-ownership gap.

`CreateBuiltinFunction.from` still constructs its adapter with `Reflect.apply.bind(null, steps, null)`. It now registers the original `steps` reference through the existing private capture-manifest API. The binding is read-only. This does not instrument an otherwise unregistered target or discover its closure variables.

The patch changes two existing engine modules. It does not replace function calls, implement binding semantics, add a heap scanner, or change `captureControl`.

## Preserved behaviour

Ten tests fail on the exact predecessor and pass now. They verify target identity, frozen targets, naming, argument order, exception identity, and the async flag. The adapter retains its native own keys, descriptors, prototype, `toString`, and nonconstructibility. Reading metadata does not invoke the target.

Two controlled Agent tests seed a builtin into an owner’s selected references. The owner now finds and rejects an unregistered callback before capture or branch execution. The exact pending decision remains usable. A separate regression proves that selected builtin property restoration still does not rewind an unregistered callback’s counter.

## Actual React discovery

The same diagnostic runs on the exact predecessor and maintained build, in both branch orders:

| Discovered records               | Predecessor | Maintained |
| -------------------------------- | ----------: | ---------: |
| Distinct references              |      19,623 |     21,429 |
| Guest objects                    |       2,199 |      2,199 |
| Native arrays                    |       1,853 |      1,858 |
| Native functions                 |         684 |      2,471 |
| Functions with capture manifests |         635 |      2,406 |
| Unregistered functions           |          49 |         65 |

No `from` adapter is discovered in this React fixture. Its expanded references come from builtin behaviour marking. The adapter tests cover that separate factory path. React’s interpreted `dispatchSetState.bind` and `dispatchReducerAction.bind` calls are guest ECMAScript binding, not this host adapter.

Both versions execute one prefix, capture one concrete timer, and reject the first branch-created timer before returning observations. The additional references include unregistered classes, host callbacks, and native functions. Their names are diagnostic labels, not an identity whitelist or proof that they are immutable.

## Remaining boundaries

The collector still ignores native functions. Emitting a function from `mark` does not make the collector traverse its capture manifest. Controlled capture can follow registered manifests and root their values through its existing mechanisms; this is not general live-closure GC coverage.

Mutable native arrays, records, callback state, class methods, module state, and ambient references still need ownership policies. Builtin property snapshots do not restore these references’ contents. The host-effect guard remains enabled. There is still no complete React owner, guarded transition API, repeated-state report, or symbolic demo.

[Validation receipts](builtin-capture-edge-validation/summary.json) retain the exact predecessor tests, before/after React reports, driver source, hashes, and raw logs. All 1,751 units across 59 files, types, relocated builds, and the unchanged local 74-variant smoke pass. New source and published runs agree on 536 of 538 Function apply/bind/call/toString variants. Both time out on the default and strict builtin `toString` test under the unchanged gate.
