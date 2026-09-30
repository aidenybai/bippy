# Agent idle-notification membership

`Agent.captureEvaluation(owner)` now automatically saves and restores its `onNoEvaluator` Set membership and order. It preserves the original Set identity. No caller-selected list or additional checkpoint API is required.

Previously, a callback that removed itself disappeared from the sibling branch. Callbacks appended during one branch could also remain for the next branch. Both-order regression tests now match four independent Node observations with one Script prefix per order.

## Capture and restoration

The lazy additional-root provider snapshots membership after `owner.beginCapture`. Saved callbacks then enter the existing control discovery and GC-root paths. Additions made by `beginCapture` are included.

Capture requires a native Set with its standard prototype, no own properties, and function-valued members. It reads the Agent field through its own data descriptor and uses native Set traversal, not a supplied iterator. Validation records the field flags, Set identity, prototype, and extensibility. A frozen native Set remains mutable internally, so its membership is still snapshotted.

Membership and metadata must remain unchanged through discovery and owner capture. Validation runs before `owner.capture` and again before checkpoint publication. Changes that persist to either check reject capture. Trusted hook mutations are not rolled back, and mutations undone before validation are not detected. A throwing hook preserves its original exception. If an owner creates resources before failure, the caller still owns their cleanup.

Restore validates metadata before control or owner restoration. It validates again afterward, then clears and repopulates the original Set in saved order. Thus a successful owner restore cannot leave a different membership. Metadata or restoration failures use the existing poisoned-checkpoint protocol; repairing metadata does not clear the stored failure.

Release clears saved membership without rewinding current subscriptions. Nested checkpoints retain the existing Agent and LIFO rules. Saved callback referents remain rooted through the existing discovery roots until release.

## Ownership boundary

This owns subscription membership, not arbitrary callback state. The negative control restores a self-removing callback but leaves its unowned native counter at two. Callback code, captures, mutable referents, future additions, ambient capabilities, and effects still need policies.

External Set iterator positions are not restored. Capture remains prohibited during Agent notification, so this does not rewind a running engine notification loop. Native reflection, builtin implementations, and engine representations remain trusted. The new snapshot and validation loops add no general work or allocation budget. Host-effect guards remain enabled.

React’s `ReactFiberRootScheduler.js` delegates scheduling and cancellation to Scheduler callbacks at reference revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. Those callbacks are not the Agent’s idle subscription Set. This change adds no React scheduler ownership or accepted shared-prefix React branches.

## Verification

`tests/idle-membership-checkpoint.test.ts` has 27 cases. They cover both branch orders, live insertion/reordering, exact Set identity, nested release, capture-time mutation, readonly metadata, poisoning, failure identity, GC retention, frozen Sets, and the incomplete-owner control. The final predecessor fails 24 cases and passes three existing-behaviour controls: saved-root retention and two throwing-hook cases. The initial two branch regressions also fail against the predecessor.

The first GC fixture removed its callback during setup evaluation, before checkpoint capture. Moving registration after that evaluation fixes the fixture; the failed run remains archived. Review found a catch-only assertion that could accept a missing throw. The final test requires a throw and checks exact identity. A build-list indentation failure and its correction also remain recorded.

Final local verification passes 96 focused cases, 2,411 units across 100 files, types, two relocated builds, frozen offline installation, and the root check. The unchanged 74-case smoke passes. Fresh WeakRef/yield conformance passes 181 variants in both maintained and published engines, with matching input, compiled, and verdict hashes. Unit, Test262, worker, and CI limits remain unchanged. See the [validation receipt](idle-membership-validation/summary.json).

Predecessor `c0457092` CI, E2E, and publishing all pass. Its analyzer log confirms 2,384 units and 74 smoke cases. This does not erase earlier timeouts or deadline cancellations.

The automatic execution owner remains incomplete. In the aliased-closure Script, native completion-callback admission is unresolved; closure and context dependencies also reach unowned Realm/Script state. General React isolation, automatic reports, transitions, repeated families, and demo integration remain missing.
