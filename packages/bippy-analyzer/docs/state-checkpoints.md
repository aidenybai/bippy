# Selected objects and bindings

`binding-checkpoint.patch` adds `createStateCheckpoint({ objects, environments })` to the maintained engine API. It restores selected ordinary objects, [arrays](array-checkpoints.md), [Maps and Sets](collection-checkpoints.md), [supported guest function properties](function-checkpoints.md), and selected declarative bindings together. It does not clone execution contexts or resume symbolic branches.

## Selection

Both lists are optional. The checkpoint copies their selections and removes duplicate identities. It reports scope `selected-objects-and-bindings-v1`, `objectCount`, `environmentCount`, and `bindingCount`.

Objects follow the [ordinary-object restrictions](object-checkpoints.md), with the combined API also accepting canonical engine arrays, Maps, Sets, and supported guest functions. The ordinary-only API still rejects these additional categories. Environment records must have exactly the `DeclarativeEnvironmentRecord` or `FunctionEnvironmentRecord` prototype. Capture rejects:

- Records owned by another agent.
- Module environments, including indirect and deferred bindings.
- Records with pending disposable resources.
- Function records whose `this` binding is uninitialized.

`EnvironmentRecord.ownerAgent` records allocation ownership. Different realms within the same agent are allowed. All operations require the owning agent to be current.

Select the records that own the bindings you need. A closure’s nearest environment can be empty. Parameter defaults can create separate parameter and body records. The API does not walk outer environments or discover reachable objects.

## Restoration

The checkpoint stores each selected environment’s ordered binding entries. Each entry retains its original cell identity, initialization flag, value identity, and value-field presence. Restoring the original cells also preserves their immutable mutability, strictness, and deletion flags.

Restore removes branch-only entries and reinstates deleted or replaced cells in the existing binding map. Closures and references still use the original environments. Object restoration preserves aliases between saved binding values and selected objects.

The collector marks saved values independently of current cells. Assigning a different value or deleting a binding cannot discard its saved value. Release removes the checkpoint’s roots.

`restore()` can run repeatedly. `release()` keeps current state and invalidates the checkpoint. Both require last-in-first-out access. `createOrdinaryObjectCheckpoint()` uses the same stack and retains its existing scope, `size`, and methods.

Before changing selected data, restore checks environment restrictions, unchanged internal methods, function metadata, and collection-list identities, debugger preview restrictions, and the projected ordinary prototype graph. Validation failures leave selected data unchanged. Binding restoration is forbidden during debugger preview. Host allocation failures are not rollback transactions.

## Excluded state

This is a storage checkpoint, not complete branch isolation. It does not restore:

- Unselected outer bindings, objects, or prototypes.
- Global object bindings or the global declaration-name set when only the global declarative record is selected.
- Mapped-argument properties, weak collections, promises, typed arrays, buffers, or other excluded internal state.
- Module loading, linking, caches, or evaluation state.
- Pending jobs, timers, host resources, or external effects.
- Execution stacks, suspended generators, or native collection iterators.

Ready function records are accepted because guest code cannot rebind their initialized `this` value. Mutations to the referenced receiver object still require object selection. The API does not rewind constructor initialization or disposal. Do not modify engine record metadata through host code while a checkpoint is open.

Use host-controlled execution boundaries and bound the number of records, bindings, properties, stored collection entries, and open checkpoints. Syntax-step budgets do not bound native capture or restoration work. These APIs do not make a poisoned concrete runtime safe to resume.

## Verification

`tests/state-checkpoint.test.ts` checks combined object/closure restoration, parameter and body records, global lexical declarations, temporal dead zones, constant assignment, deletion, insertion order, identity, nested order, ownership, and garbage collection. It also checks preview and disposal rejection, prototype-cycle rejection before binding changes, copied selections, and excluded outer state.

Branch tests execute their prefix once, restore between branch scripts, and reverse visitation order. Observations compare with separate V8 and published-engine executions. This verifies stored state restoration, not general continuation resumption or symbolic React rendering.

[Validation receipts](binding-checkpoint-validation/summary.json) record 16 new checks and 821 passing local tests across 17 files. The unchanged smoke passes 74/74. The parameter/arguments selection remains 557/559 with identical inputs and verdicts. The historical selection remains 301/306, and the WeakRef/FinalizationRegistry selection passes 152/152. Raw logs retain the initial nearest-environment test assumption, its typecheck correction, and the passing checks.

Run the focused checks with:

```sh
pnpm --filter bippy-analyzer test --run tests/state-checkpoint.test.ts tests/object-checkpoint.test.ts tests/gc-bindings.test.ts
```
