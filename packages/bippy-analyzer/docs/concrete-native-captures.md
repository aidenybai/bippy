# Declared concrete callback captures

The concrete host now declares references held by its installed callbacks and queued timer/microtask jobs. It uses engine262’s existing `registerNativeClosure` metadata API, newly exported from the engine bundle. There is no new closure registry or snapshot algorithm.

## Declared references

A shared manifest supplies conservative read-only bindings for the runtime, engine namespace, error constructor, and manifest factory. Callback-specific bindings add:

- The original installed `steps` callback behind the host-effect guard.
- Each console callback’s original method name.
- Each timer job’s handle and original capture array.
- Each microtask job’s original guest callback.

The factory declares its own self-reference. Existing continuation traversal deduplicates that cycle. The declarations are conservative dependencies, not a claim that every callback directly reads every shared binding.

Registration preserves function identity and native own properties. Timer and microtask jobs keep their original `job` names. Timer execution, queue operations, work budgets, and host-effect guards remain unchanged. [Concrete host snapshots](concrete-host-checkpoints.md) restore the same timer capture arrays exposed by these declarations.

Read-only bindings preserve reference identity, not the referenced objects’ contents. The runtime, engine namespace, and constructor still require explicit ownership or shared-code policies. Agent observers, rejection trackers, module-loader callbacks, and arbitrary host callbacks are not all registered by this change.

## Verification and limits

Twelve tests fail on the exact predecessor and pass now. They verify lazy registration, identity and descriptor preservation, all seven installed callbacks, queued job references, restored capture-array aliases, and a rejecting continuation owner. That owner can now find the concrete runtime before capturing or executing a branch. Failed capture preserves its exact pending decision.

The initial negative GC regression declared a guest target behind a live builtin callback and observed its premature loss. [Declared native-capture marking](native-capture-roots.md) now fixes that case and verifies collection after removing the root. Registration still requires complete trusted declarations; unregistered functions and arbitrary native records remain outside traversal. Runtime marking and declared Job captures remain supported.

The actual React diagnostic discovers 2,476 native functions, including 2,418 registered functions and 58 unregistered functions. Compared with the previous diagnostic, seven unnamed callbacks and one timer job gain declarations; the error constructor adds one unregistered function. Each order still executes one prefix, captures one timer, and rejects the first branch-created timer before observations.

The diagnostic’s former `adapters` metric counted any manifest binding named `steps`. That name cannot identify `CreateBuiltinFunction.from` adapters. The current report calls the metric `functionsWithStepsBinding`; its three matches are the concrete guard wrappers. Names and counts are not safe identity whitelists or ownership proofs.

This API accepts trusted host declarations. It does not inspect arbitrary JavaScript closures, verify declaration completeness, provide a sandbox, or authorize effects. Native records, arrays, class methods, ambient state, and full guest execution still lack a transitive owner. General guarded React reports, transitions, repeated-state families, and the symbolic demo remain incomplete.

[Validation receipts](concrete-native-capture-validation/summary.json) contain exact source hashes, predecessor failures, diagnostics, commands, and logs. All 1,763 units across 60 files, types, relocated builds, and the unchanged local 74-variant smoke pass. The new source run matches the unchanged published Function apply/bind/call/toString baseline at 536/538, with two matching builtin-toString timeouts.
