# Selected ordinary-object checkpoints

`engine/patches/object-checkpoint.patch` adds `createOrdinaryObjectCheckpoint(objects)` to the maintained engine API. It captures explicitly selected objects, not a realm or a complete execution state. The analyzer does not yet use it to fork symbolic execution.

## Captured state

Each accepted object must use ordinary internal methods and have only the `Prototype` and `Extensible` internal slots. It must have no existing private elements or constructor tracking. Arrays, functions, proxies, collections, buffers, boxed primitives, promises, and other objects with additional state are rejected.

The checkpoint stores:

- Original object identity and owning agent.
- Own property keys, insertion order, and descriptor records.
- Prototype identity and extensibility.
- The initially empty private-element and constructor-tracking lists.

Descriptor fields retain engine value identities, including object aliases, symbols, getters, and setters. The engine treats these descriptor records as immutable. Capture and restore do not call guest getters, setters, or proxy traps. No JSON serialization or generic deep clone is used.

Restore repopulates the existing property table rather than replacing it. It restores the prototype and extensibility, including before a branch froze or sealed the object. It also removes private brands and constructor records installed after capture. Capturing objects with existing private state remains unsupported.

## Lifecycle and ownership

`ObjectValue.ownerAgent` records allocation ownership. All selected objects must belong to the current agent. Objects from different realms within that agent are accepted. Cross-agent capture, restore, and release fail.

A checkpoint reports scope `selected-ordinary-objects-v1` and the number of distinct selected objects. `restore()` can run repeatedly until `release()`. Nested checkpoints require last-in-first-out access. Releasing a checkpoint keeps the current state and removes its saved roots; it does not restore automatically.

Keep the owning agent current and release the checkpoint in cleanup. Restore only at a host-controlled execution boundary. Existing debugger preview restrictions still apply. The engine checks all selected objects before restoring any of them during preview.

Restore also checks the projected ordinary prototype graph before changing objects. If an unselected prototype mutation would introduce a cycle, restore fails without applying the snapshots. Exotic prototype boundaries do not invoke traps during this check.

Open checkpoints participate in engine garbage collection. Saved descriptor values, accessor functions, symbol keys, objects, and prototypes remain reachable. Release removes these roots and clears the stored snapshots.

## Unsupported state

The API does not discover reachable objects. Mutating an unselected child or prototype remains a mutation after restore. Captured lexical bindings are not restored either. A regression explicitly checks this boundary.

Execution contexts and suspended generators are not checkpoints. This API cannot clone or rewind a continuation. It does not capture module bindings, promises, jobs, timers, host resources, external effects, or native collection iterators. It does not make a poisoned concrete runtime safe to resume.

Callers must bound selected objects, property counts, and open checkpoints. Syntax-step budgets do not bound this native snapshot work.

These limits prevent treating the API as branch isolation for React. React’s circular update links are ordinary properties, but its captured bindings, scheduler state, and host effects still need isolation.

## Verification

`tests/object-checkpoint.test.ts` contains 31 checks. They cover aliases, repeated restoration, nested order, cyclic queue links, descriptors, property order, prototypes, integrity, private-brand installation, cross-agent rejection, same-agent cross-realm objects, preview atomicity, prototype-cycle rejection, and garbage-collection roots.

The branch-mutation cases compare observations with unmodified engine262 and V8. They execute the setup once in the checkpointed realm, restore between branches, and repeat with reversed branch order. Getter counts remain zero. This verifies selected object restoration, not symbolic branch execution or continuation resumption.

[Validation receipts](object-checkpoint-validation/summary.json) retain 797 passing local tests across 15 files and the 74/74 smoke. The historical selection remains 301/306; the parameter/arguments selection remains 557/559 with identical inputs and verdicts. Logs retain the two initial source-typecheck failures and the final passing checks. Relocated builds match `da115b2eeb8743868db509c127cdccfa49832490e61dce7a720a42eac8959d29`.

Run the focused checks with:

```sh
pnpm --filter bippy-analyzer test --run tests/object-checkpoint.test.ts
```
