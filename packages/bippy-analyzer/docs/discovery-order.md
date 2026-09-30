# Owner inspection before native capture expansion

`captureControl` now calls `owner.references` before expanding each non-control object’s native capture declaration. An owner can reject that object before its capture factory or binding getters execute through this discovery path. The API remains caller-owned and unverified.

Previously, discovery called `getNativeCaptures` first. Public capture factories could execute code before the owner examined their source provenance or storage. Rejecting the object in `references` came too late to prevent that direct metadata access.

## Discovery order

For each previously unvisited non-control object, discovery now:

1. Calls and iterates `owner.references`, if supplied.
2. Records each returned reference in the live discovery-root array and a temporary reference list.
3. Expands the object’s current native capture declaration and records its bindings.
4. Appends the saved owner references to the pending traversal stack.

The last step preserves the original LIFO priority between owner-derived and metadata-derived descendants. Returned references enter the root array earlier, before native metadata can mutate bindings or force collection. Agent-managed capture retains those values through its existing [discovery root scope](scoped-gc-roots.md). Standalone control capture still requires caller-provided GC retention.

Owner inspection can change native registration or bindings. Discovery now observes those changes before reading capture metadata. The root array records owner references before metadata-derived values. These are deliberate ordering changes, not a promise that discovery callbacks are pure.

A thrown owner callback, reference iterator, or metadata getter aborts capture. No evaluation checkpoint is published, and temporary discovery roots release. The original exception and pending decision remain available. Trusted callback effects are not rolled back.

## Limits

This is a local ordering rule, not whole-graph preflight. An allowed parent’s metadata can execute before an unsupported descendant is discovered. Omitting `references`, or returning no edges for an unexamined value, still does not establish ownership.

Other access paths remain separate:

- GC marking can invoke native capture declarations before or during discovery.
- Control-frame capture uses its existing trusted callbacks.
- Direct `getNativeCaptures` calls do not consult the owner.
- Restore-time getters and setters do not re-run reference inspection.
- Future execution, allocations, and host callbacks are not admitted by this rule.

Tests explicitly demonstrate metadata execution during GC in `beginCapture`, even when later reference inspection rejects the callback. Host-effect guards remain enabled. Native source labels still do not certify mutable storage, referents, ambient capabilities, or effects.

## Evidence

`tests/discovery-order.test.ts` covers finish, idle, scoped, and transitive notification references. Rejection now precedes capture factories, manifest fields, and binding getters. Public replacement of compiler-issued metadata also rejects before its replacement factory runs.

Other tests check iterator failure and recovery, duplicate/cyclic references, current metadata replacement, preserved descendant priority, and host-effect rejection. A partial iterator yields a guest object, triggers GC on its next call, then throws. The object survives during discovery and becomes collectible after failed-capture cleanup. Another case retains owner references through collection inside a later capture factory.

Two shared-prefix forks retain binding restoration in both orders. Each prefix executes once, and four observations match independent Node executions. The omitted-inspection and GC cases remain negative controls against interpreting this behavior as fail-closed ownership.

`tests/discovery-order-react.test.ts` rejects a caller-supplied Agent completion notification at an actual React update pause. Its public metadata factory does not run through discovery. The test preserves the exact pause with one prefix, no owner capture, and no branch observations. It does not establish React scheduler or branch ownership.

Final local checks pass:

- 17 new cases and 73 focused cases
- 2,361 unit tests across 97 files
- Types, two relocated builds, and frozen offline installation
- The unchanged 74-case smoke selection
- 181 fresh source/published WeakRef and yield variants, with matching input hashes, compiled hashes, and verdicts

The identical-final-source predecessor fails 13 cases and passes four controls. The initial nine-case reproduction failed eight cases. The first typecheck failed on a self-referencing getter’s inferred return type; an explicit `unknown` return type fixes it. All raw results are retained in the [validation receipt](discovery-order-validation/summary.json). Existing tagged-template failures from earlier receipts are not reclassified by this selection.

The preceding argument-storage CI run exceeded its ten-minute job limit. Browser/dependency installation used about six minutes; unit tests were interrupted, and smoke/profiling steps were skipped. E2E and publishing passed. An interrupted unit run is not a pass, and no gate timeout changed.

The automatic execution owner, shared-prefix React isolation, automatic reports, guarded transitions, repeated-state families, and integrated demo remain missing.
