# Selected constructor-tracking storage

Combined `createStateCheckpoint` capture now accepts constructor tracking on otherwise-supported objects. This removes the selected-property restriction found on the actual React fiber. It does not own the fiber’s referenced graph.

## Stored state and validation

Pinned engine262 appends constructor references to `ObjectValue.ConstructedBy` in `InitializeInstanceElements`. The list exists on every guest object, separately from its declared internal slots. React’s `FiberNode` constructor leaves one entry on the inspected fiber.

The checkpoint retains the original native list and a copy of its ordered references. Restoration preflights list identity before any selected writes, then repopulates that original list. Duplicate entries, aliases, and constructor identities survive. Branch-added entries disappear. Existing removal of branch-added private elements remains unchanged; capture of preexisting private instance elements still rejects.

Capture requires an array of same-Agent guest objects with callable `Construct` methods. These are trusted engine records, not a hostile-host validation boundary. The patch does not recursively select constructor properties, prototypes, lexical environments, or native captures. Those references remain separately owned. Class constructors remain outside the selected-function property policy.

The ordinary-only API still rejects nonempty constructor lists. Closed-data graph capture also rejects them rather than skipping constructor edges. Other object methods, internal slots, preview rules, shared LIFO access, and ownership checks retain their existing policies. No new public signature or scope identifier is introduced.

## Live and saved roots

`ObjectValue.mark` now marks live constructor-list references. Snapshot marking also visits the saved references, even after the live list changes. Restoring the list reconnects live roots; releasing the snapshot removes its additional roots. Branch-only constructors can become unreachable after restoration.

The engine records these references unconditionally under its proposed pattern-matching extension. The GC checks verify that declared engine references remain live. They do not assert that native V8 has this metadata or identical constructor WeakRef liveness. This patch does not establish complete rooting for every field reachable through a constructor.

## Actual React and validation

Source inspection uses React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, specifically `ReactFiber.js:FiberNode` and `createFiberImplClass`. The executable fixtures use installed React and Test Renderer 19.3.0, not a build of that checkout.

The numeric React tests now capture and release the fiber, queue, and eager update inside the owner callback. Closed-data graph capture still rejects. The owner explicitly rejects general ownership, and the same decision remains pending. Subsequent execution still matches ten native sequences. These tests do not restore React or explore two React branches from one prefix.

Thirty constructor tests cover seven instance forms, both branch orders, ordered and duplicate constructor references, native-list replacement preflight, private stamps, nested snapshots, foreign references, and live/saved/released roots. The first twenty-seven cases had twenty-four failures and three existing rejection passes. Independent native comparisons cover twenty-eight property-branch observations and fourteen baselines. Two selected-instance Agent fixtures add four native comparisons, both orders, forced GC, and one prefix execution per order. They explicitly restore the context-stack list, not arbitrary execution-context fields.

Embedded test programs across the analyzer now use readable multiline templates. Intermediate formatting failures exposed expression terminators, automatic semicolon insertion, comma grouping, and statement/expression boundaries. The fixes preserve the original assertions and execution limits. Two checks of the final readable fixtures against the preceding engine yield twenty-nine failures and three existing rejection passes. Each includes one React test timeout at the unchanged five-second limit, not twenty-nine specific correctness failures. Both timeout reports remain archived. All thirty-two cases pass with this patch, with identical test-source hashes across the comparisons. The failure logs remain in the [validation receipts](constructor-checkpoint-validation/summary.json).

The final local suite passes 1,466 tests across forty-five files. The unchanged smoke passes 74/74. New-expression, subclass, WeakRef, and FinalizationRegistry selections pass 487/487 in both engines with matching input hashes, compiled hashes, and verdicts. Typechecking, two relocated builds, frozen offline installation, and root checks pass. Engine SHA-256: `624b460e0ced4b1062a490812a0283d2e0bd6d7de690f9487626cc2760ad39db`.

[Linux CI](constructor-checkpoint-validation/ci.json) passes all 1,466 units and 74/74 smoke, with a matching clean-build hash. E2E and publish also pass. Historical timeout receipts remain evidence; this does not establish stable Linux timing. The preceding owner-storage revision passes 1,436 Linux units but fails both numeric `substr` smoke variants at the unchanged timeout. Its [failure receipt](owner-storage-capture-validation/ci-failure.json) preserves logs and diagnostic profiles. Separate E2E and publish workflows pass.

## Remaining ownership work

Intrinsic graphs, native function captures, environments, execution-context fields, modules, queues, and host effects still need explicit ownership or rejection policies. Guarded React reports, shared-prefix React branching, event/effect transitions, repeated state families, and symbolic demo integration remain incomplete.
