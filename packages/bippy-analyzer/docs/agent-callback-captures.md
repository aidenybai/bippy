# Agent notification callback captures

Agent checkpoints now discover completion and idle callback captures before invoking the state owner. Previously, the Agent appended callback references after control discovery. The owner received those references, but their declared bindings missed the existing traversal and restoration.

This closes a discovery gap. It does not supply a transitive owner or permission to run arbitrary callback effects.

## Discovery order

`captureControl(iterator, owner, getAdditionalRoots?)` accepts an optional synchronous root provider. The default returns no additional roots. Discovery runs in this order:

1. Enter the existing control checkpoint guard.
2. Call `owner.beginCapture`.
3. Call `getAdditionalRoots` and add its values to the existing worklist and root list.
4. Traverse control frames, registered native captures, and owner-supplied references.
5. Call `owner.capture` with the collected values, ambient names, and control-owned objects.

The Agent supplies its evaluator, completion callback, and current idle callbacks through this provider. Reading idle callbacks after `beginCapture` includes callbacks installed by that hook. Duplicate objects and cycles use the existing visited set.

Registered callback bindings now use the original binding validation and restoration. Captured references reach `owner.references` before `owner.capture`. Saved values join the Agent checkpoint’s GC roots, including values a callback later replaces.

Root-provider or capture-getter failure publishes no Agent checkpoint. The original decision remains available. Capture failure does not undo mutations made by discovery hooks. Reentry and direct continuation resumption reject during root discovery. Native metadata, getters, root providers, and owner callbacks remain trusted code, not sandboxed code.

## Regression evidence

Four selected-state forks cover completion and idle callbacks in both branch orders. A callback calls another registered closure that increments a native binding. Before this change, the sibling observed count two instead of one. The maintained engine matches eight independent Node observations with one prefix per fork and forced GC.

Two GC cases replace a captured guest object with `undefined` after completion. The open checkpoint retains the saved object even though the current getter no longer returns it. Releasing the checkpoint permits collection in these detached fixtures; it does not promise eager collection generally.

Other cases verify:

- rejection of an unowned captured record before owner capture;
- original getter-error identity and recovery after failed capture;
- read-only capture validation before owner restoration;
- root-provider failure and reentry guards;
- cyclic metadata, ambient dependencies, and callbacks added by `beginCapture`.

Two deliberate incomplete-owner controls still leak a mutable record, with and without capture registration. Restoring a binding reference does not restore its referent. Registration does not prove execution ownership.

An actual React update reaches its first opaque decision. A fixture owner detects a known unowned record through the completion callback and rejects before `owner.capture`. The prefix runs once, no callback executes, and the pending decision survives. This checks callback discovery at a React pause, not a complete React dependency census or successful React forks.

## Remaining boundaries

Idle callback Set membership and registration changes do not rewind. Unregistered closures, mutable referents, ambient effects, native classes/proxies, and arbitrary callback behavior remain the owner’s responsibility. Omitting `references` is still a caller assertion, not an automatic coverage check.

This change does not alter live completion/idle callback marking outside saved checkpoints or during notification execution. That lifetime coverage remains a separate GC audit gap. Standalone control checkpoints still have no automatic Agent GC roots.

The host-effect guard remains enabled. Checkpoints still cannot span separate registered evaluations or job drains. General React ownership, guarded transitions, repeated-state families, automatic report production, and the integrated demo remain incomplete.

[Validation receipts](agent-callback-capture-validation/summary.json) retain the final-source predecessor’s thirteen failures and two controls. All fifteen new cases and 56 focused cases pass. The failures demonstrate the missing discovery path and API behavior, not thirteen independent engine bugs. The initial TypeScript errors involved an internal callback Set omitted from declarations and a completion value requiring `EnsureCompletion`; both remain archived.
