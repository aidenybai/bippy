# Promise.finally capture roots

`promise-finally-roots.patch` retains the value or reason forwarded after cleanup and the selected species constructor. It uses engine262’s existing `HostCapturedValues` slot. It does not change cleanup ordering, constructor selection, Promise resolution, or rejection forwarding.

## Explicit captures

The outer fulfillment and rejection callbacks already retained `onFinally`. Both now retain the constructor returned by `SpeciesConstructor` too. This matters when a custom receiver’s `then` method stores only one callback and releases the receiver.

The inner value thunk now declares its captured fulfillment value. The inner thrower declares its rejection reason. These callbacks can remain pending while cleanup awaits a Promise, or escape through a custom constructor’s `then` method. Existing builtin-function marking keeps their declared values reachable.

No new queue, collector, or closure-discovery mechanism was added. Retained callbacks retain their captures. Once they become unreachable, the collector can remove those roots. Rejected cleanup discards the unused forwarding callback without retaining its original value.

## Verification

The 16 cases cover:

- Object and Symbol values and reasons while cleanup remains pending.
- Both detached outer callbacks retaining their species constructor.
- Existing cleanup callback captures, which passed before this patch.
- Both detached inner thunks, without a Promise queue.
- Release when cleanup rejects, and release of discarded pending cycles.

The baseline had 12 failures and four passes. All 16 now pass, including twelve independent V8 comparisons. Observers and cleanup functions stay outside the target’s lexical scope where needed, so unrelated environments cannot hide a missing capture.

The final local suite passes 1,364 tests across 40 files. The unchanged smoke passes 74/74. The finally/WeakRef/FinalizationRegistry Test262 selection passes 208/210 in both engines, retaining two matching failures. [Receipts](promise-finally-root-validation/summary.json) include source hashes, reports, baseline failures, and boundary probes.

The six tracked pending-reaction, all, allSettled, any, and finally probes now match V8 `[true,7]`. The unregistered manual-evaluator probe still loses its live target. These results do not establish complete GC coverage, automatic collection policy, or Promise rollback.

## React and ownership boundaries

React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` uses `transition.finished.finally(callback)` in `ReactFiberConfigDOM.js:addViewTransitionFinishedListener`. This source inspection establishes a concrete use, not view-transition or symbolic-rendering parity.

Keyed combinators, module/cache records, saved continuations, host diagnostics, and other undeclared captures still need explicit policies. A marked capture is not a branch-owned snapshot. Agent control metadata, transitive ownership, guarded React reports, and shared-prefix exploration remain incomplete in the [completion checklist](symbolic-react-status.md).
