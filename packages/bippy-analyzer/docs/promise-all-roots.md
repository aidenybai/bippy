# Promise.all accumulator roots

`promise-all-roots.patch` retains partial `Promise.all` results through reachable element callbacks. It also covers `SafePerformPromiseAll`, which uses the same helper. This fixes the retained accumulator counterexample without changing Promise scheduling or resolution algorithms.

## Declared callback state

`CreatePromiseAllResolveElement` already closes over a shared values list and result capability. The callback previously declared only its `AlreadyCalled` and `Index` slots. The collector could therefore clear objects held only by the native values list.

The patch adds `Values` and `Capability` slots containing those exact existing records. `ObjectValue.mark` visits declared slots. The existing collector visits native array elements, and `PromiseCapabilityRecord.mark` visits the Promise and both resolving callbacks. There is no generic native closure walker, new queue, or second accumulator.

All element callbacks share the original mutable list. An entry written by one callback remains reachable through another pending callback. Retained callbacks also retain the capability’s custom callback environments. Discarding all relevant callbacks and results removes those roots. The patch does not promise eager release while a consumed callback remains reachable.

## Verification

All eight initial regressions failed before the patch. Nine final cases cover:

- Partial Object and Symbol results in both input orders, compared with independent V8 executions.
- A custom `then` method that retains only the fulfillment callback.
- A custom capability’s callback environment.
- Shared accumulator identity across detached callbacks and duplicate-call rejection.
- Partial `SafePerformPromiseAll` results.
- Collection after reachable callbacks and results are discarded.

Observers remain outside the target’s lexical scope. This prevents a retained environment from masking the missing accumulator root. The original probe now returns `[true,7]` in the maintained engine and V8. It previously returned engine `[false,7]` versus V8 `[true,7]`.

The final suite passes 1,324 tests across 38 files, with 74/74 unchanged smoke variants. The Promise.all/WeakRef/FinalizationRegistry selection passes 334/348 in both engines. Fourteen unhandled-rejection failures remain recorded. [Receipts](promise-all-root-validation/summary.json) include source hashes, intermediate failures, conformance reports, and boundary probes. An initial SafePerform test wrapped a generator instead of executing it; the corrected test drives `CreateDataProperty` through `skipDebugger`.

## Remaining root and ownership gaps

Partial `Promise.allSettled` results and `Promise.any` errors still lose live targets. Both new probes return engine `[false,7]` versus V8 `[true,7]`. Their observers also avoid the target’s lexical scope. Keyed combinators, remaining `finally` captures, modules, saved continuations, and unregistered external evaluators still need explicit policies.

React source at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, `ReactLazy.js`, stores the resolved module in its payload through a `then` callback. Keeping actual Promise records alive is necessary for async application execution. This inspection and these engine tests do not verify symbolic lazy rendering, shared-prefix React forks, or branch-safe Promise restoration. The [React completion checklist](symbolic-react-status.md) remains incomplete.
