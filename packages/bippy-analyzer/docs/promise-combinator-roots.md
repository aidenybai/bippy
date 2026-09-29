# Promise.allSettled and Promise.any roots

`promise-combinator-roots.patch` retains partial settlement records and rejection reasons through reachable element callbacks. It follows the [Promise.all root policy](promise-all-roots.md), without replacing Promise algorithms or copying accumulators.

## Existing records

Both `allSettled` callbacks now expose their shared `Values` array and result `Capability` through declared slots. The fulfillment callback already declared these slots but did not populate them. The rejection callback now declares and populates them too.

The `any` rejection callback declares its existing `Errors` array and result `Capability`. Existing native-array traversal and capability marking retain their guest values. `AlreadyCalled` sharing, counters, input order, scheduling, and resolution behavior remain unchanged. These additions do not define rollback policies for mutable callback state.

Callbacks retain their original records. A callback stored by a custom `then` method can retain the result Promise and custom capability environments. Retained consumed callbacks can also retain captures. The contract does not require eager release while those callbacks remain reachable.

## Verification

All 24 regressions failed before implementation and pass afterward. They include 21 independent native V8 comparisons:

- Object and Symbol partial results in both input orders, for fulfilled and rejected allSettled entries and rejected any entries.
- Result capabilities reachable only through one selected element callback.
- Custom capability environments.
- Shared accumulators with duplicate calls, including opposite allSettled callbacks sharing `AlreadyCalled`.

The detached-callback cases discard the unused sibling callback before collection. This checks each annotated accumulator path independently. Three additional cases verify collection after pending aggregates, inputs, and resolving functions are discarded. Observers remain outside the target’s lexical scope.

The final local suite passes 1,348 tests across 39 files. The unchanged smoke passes 74/74. The allSettled/any/WeakRef/FinalizationRegistry Test262 selection passes 532/548 in both engines. Sixteen matching failures remain recorded. [Receipts](promise-combinator-root-validation/summary.json) retain source hashes, reports, initial failures, and boundary probes.

## Remaining ownership and root policies

The prior allSettled and any probes now return `[true,7]` in the maintained engine and V8. Two new `finally` probes still return engine `[false,7]` versus V8 `[true,7]`. They cover a fulfilled value and rejected reason held while cleanup awaits a pending Promise.

Keyed combinators, remaining builtin captures, modules, saved continuations, and unregistered external evaluators still need explicit policies. No generic native-object walker or new collector was added. General branch ownership and Promise restoration remain incomplete.

At React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, `ReactFiberThenable.js` stores thenable state and attaches completion callbacks. This source inspection motivates correct Promise retention. It does not verify symbolic Suspense or shared-prefix React branches. The [React completion checklist](symbolic-react-status.md) remains open.
