# Reject unowned host effects during checkpoints

The [partial-owner React timer probe](context-checkpoints.md) exposed four branches’ callbacks executing after restoration. Covered host entry points now reject effects while an Agent evaluation checkpoint is open. They also reject during capture and restore callbacks, before the first checkpoint frame exists or restoration finishes.

## Guarded operations

`Agent.assertCanPerformHostEffect()` checks the existing checkpoint stack and capture/restore flag. It throws `TypeError: Host effects are unsupported during evaluation checkpoints`.

The guard runs before these operations:

- Concrete timer registration and cancellation, including handles, capture arrays, job budgets, and event-loop insertion.
- Concrete microtask insertion and console recording.
- Concrete Promise-rejection and uncaught-exception tracking, and runtime disposal.
- Engine Promise-job enqueueing and finalization cleanup hooks or scheduling.
- Builtin event-loop enqueueing, async registration, async completion/cancellation, run-mode changes, and draining.
- [Shared host clock reads and Math.random](checkpoint-nondeterminism.md), before hook lookup, entropy use, or Realm random-state mutation.
- [Six module operations](checkpoint-module-effects.md), before their host lookups or `FinishLoadingImportedModule` writes. Cached meta reads remain available. This does not own already-started loader callbacks or native caches.

Capture rejects existing pending async host jobs before invoking the owner. Queued synchronous jobs are distinct from pending async registration. Existing queued jobs are not copied or restored, and the guarded event-loop entry points cannot drain them while a checkpoint is open. Release all checkpoints before disposal or supported host work.

When a guest call reaches a guarded operation, the host error bypasses guest catch clauses. Agent resumption stores and rethrows the same failure. Restoring the evaluation checkpoint also rethrows it. Release remains available; discard the failed Agent rather than attempting to recover its partially advanced execution contexts or guest state.

## Boundaries

This is rejection, not queue ownership or rollback. It does not implement branch-local queues, timer histories, or callback captures. It does not reverse guest mutations performed before the rejected host call.

Direct host access to queue collections and their enqueue/shift methods remains outside these guards. Custom event loops, custom host hooks, arbitrary native callbacks, module caches, and other native records still require ownership policies. Hosts can also mutate records directly. This API is not a sandbox or a proof that every host effect is guarded.

The concrete installer wraps only receiver-independent host steps, using `OmitThisParameter<NativeSteps>`. The initial implementation typed these as receiver-dependent steps and failed typechecking with TS2684. The corrected type preserves the installed arrow callbacks’ contract; the failed log remains in the receipt.

[Selected web-queue snapshots](web-queue-checkpoints.md) now restore macrotask membership inside the existing engine event loop. They do not own timer closures or microtasks and do not disable these guards.

## Verification

`tests/checkpoint-host-effects.test.ts` contains eighteen cases. All eighteen fail on the exact predecessor and pass with the guard changes. They check concrete storage before and after rejection, catch bypass, retained failure identity, capture/restore callbacks, three builtin event loops, pending async registration, finalization hooks, and disposal. Existing context and evaluation checkpoint cases also pass.

The actual React diagnostic runs each branch order until its first user timer call. Both runs execute one prefix, reach the timer after the React update, and reject before returning a branch observation. This replaces the prior leak with an explicit unsupported result. It does not demonstrate restored timers or complete React ownership.

All 1,696 unit tests across 55 files pass, along with typechecking, relocated builds, and the unchanged local 74-variant smoke. Source and published engines match 367/373 selected Promise, finalization, and async-function variants. Both exit 1 with the same six failures in the two Promise next-abrupt cases and async-function evaluation-body case. Input hashes, compiled hashes, and verdicts match.

[Linux CI](checkpoint-host-effects-validation/ci-status.json) passes 1,696 units and 74 smoke variants with the matching engine hash. E2E and publishing pass. These results do not remove earlier timing, conformance, or publishing failures.

[The receipt](checkpoint-host-effects-validation/summary.json) preserves exact baselines, intermediate type failure, reports, driver source, and hashes. React source research inspected `scheduleImmediateRootScheduleTask()` at revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. React schedules microtasks or Scheduler callbacks there, so supporting symbolic event/effect transitions still requires real queue ownership rather than bypassing these guards.
