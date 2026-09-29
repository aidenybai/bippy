# Selected guest function properties

`createStateCheckpoint` now accepts selected ECMAScript and bound function objects under a restricted metadata policy. It restores their guest properties, prototype, and extensibility with the original function identity. It does not copy functions or replace engine call semantics.

## Accepted functions

ECMAScript functions must use the engine’s canonical call and construction methods and declared internal-slot layout. They must have no private environment, class-constructor state, field-initializer name, or stored class elements. Ordinary functions, arrows, object methods, generators, and async functions can meet these requirements.

Bound functions must use the canonical bound call and construction methods and the declared bound-function slot layout. Their argument list must be a native array. The checkpoint preserves the target function, receiver, argument-list identity, and argument value identities as read-only metadata.

The implementation reuses the slot definitions from `OrdinaryFunctionCreate` and `BoundFunctionCreate`. The combined checkpoint still reports scope `selected-objects-and-bindings-v1`. Its ordinary-only counterpart still rejects functions.

The original private-element, construction-tracking, ordinary-method, Agent ownership, preview, prototype-cycle, and LIFO rules remain. Class constructors, private-environment functions, direct native builtins, and callable proxies remain unsupported. A bound function can refer to an unsupported target; selecting the wrapper does not select or validate that target’s state.

## Restoration and references

Capture saves data-property descriptors for declared function metadata and call/construction methods. Restore requires the same metadata identities, descriptor flags, and property presence before changing any selected object. It also checks the bound argument entries and empty class-element lists. Metadata changes reject with `Checkpoint function metadata changed`; they are not rewound.

The existing property table restores guest property descriptors and insertion order. Function aliases, call behavior, and constructor behavior continue to use the original function. Snapshot marking visits saved property descriptors, declared metadata references, and saved bound arguments through the existing collector. Release removes those saved roots.

Environment records, home objects, bound receivers, argument objects, function prototypes, realms, and script/module records are not selected recursively. Select supported environments separately to rewind captured bindings. Select receiver and argument objects separately to rewind their properties. Referenced parser and engine metadata remain trusted; this is not hostile host-record validation or a deep metadata snapshot.

Generator function selection does not restore generator instances or iterator positions. Async function selection does not restore pending async execution, Promise state, or queued work. Native closures and their captures still need separate policies.

Bound argument count contributes to capture and restore work even when the function has no guest properties. Callers must bound selected functions, properties, bound arguments, environments, and checkpoint depth. The syntax-step budget does not bound this native work.

## Evidence and React relevance

`tests/function-checkpoint.test.ts` has 33 cases. Before implementation, 25 of the initial 29 cases failed; four unsupported-state cases already passed. The first patched run passed 28/29; the remaining fixture incorrectly expected an Agent field from `withFixture`. It now uses the current Agent. The receipts retain both failures.

Twenty-eight native V8 branch observations and fourteen baseline observations cover seven function forms in both branch orders. Tests preserve aliases and property-table identity across descriptor changes, deletion/reinsertion, prototype changes, and freezing. They also exercise bound construction, selected versus unselected closure bindings and bound objects, read-only metadata preflight, same-length argument replacement, class-list changes, and saved Object/Symbol property lifetimes. The async case observes the returned object, not async scheduling parity.

React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` uses a bound dispatch in `ReactFiberHooks.js:mountState`. It binds the current fiber and queue into `dispatchSetState`, then stores the dispatch in `queue.dispatch`. Restoring a dispatch function’s properties alone does not restore those referenced React records. No shared-prefix React fork is verified by this increment.

The final local suite passes 1,411 tests across forty-two files. The unchanged smoke passes 74/74. The bind/toString/function-expression selection passes 842/844 in both engines. Input hashes, compiled hashes, and verdicts match. Both `toString/built-in-function-object.js` variants fail with matching diagnostics. The [validation receipts](function-checkpoint-validation/summary.json) retain those failures.

Typechecking, two relocated clean builds, frozen offline installation, and the root check pass. The engine SHA-256 is `93084a26080e082aed0b34a62194602b1d8effcba0558b102c06267901a8d0a4`. Linux validation for this increment remains pending. A rejecting transitive owner, general guarded React output, transitions, and demo integration remain incomplete.
