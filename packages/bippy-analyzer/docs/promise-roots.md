# Promise reaction and job roots

The collector now retains pending Promise reactions and queued reaction/thenable-assimilation jobs. The original pending-reaction probe returns `[true,7]` in engine262 and V8. General Promise root coverage and symbolic React branching remain incomplete.

## Reuse engine records

`PromiseCapabilityRecord.mark` visits its Promise, resolve function, and reject function. `PromiseReactionRecord.mark` visits its capability and handler callback. Callback host data remains `undefined` in this engine. Neither method walks arbitrary host objects or functions.

Reaction jobs declare their argument, handler, and capability values through the existing `Job.capturedValues` field. Thenable-assimilation jobs declare the result Promise, thenable receiver, and callback. `HostEnqueuePromiseJob` accepts this optional list and preserves its existing realm selection and queue behavior. There is no new scheduler or Promise implementation.

Resolve and reject functions share a `HostCapturedValues` list containing their pending Promise. Both clear that list when they consume the shared resolving cell. The current evaluator then retains the Promise while it settles or schedules assimilation. Keeping the sibling resolving function does not retain an already-consumed Promise through this list.

These changes establish reference paths, not rollback. Restoring reaction lists, shared resolving cells, queue order, and host effects remains separate work.

## Verification

`tests/gc-promises.test.ts` contains nineteen cases. Fifteen of the initial sixteen cases failed before the patch; the unreachable-cycle check already passed. The tests cover:

- Object and Symbol captures in pending and queued fulfillment/rejection handlers.
- Queued arguments through empty handlers and custom species capabilities.
- Result Promises, thenable receivers, and detached assimilation callbacks.
- Resolving-function lifetime, sibling calls, and unselected-reaction release.
- Unreachable pending cycles and independent Agents.

Four pending-handler observations match independent V8 runs across a task boundary and explicit GC. Release checks use deterministic engine collection. The full local suite passes 1,247 tests across thirty-three files. The unchanged smoke passes 74/74.

The expanded Promise and weak-collection Test262 selection passes 2,011/2,061 in both engines. All input hashes, compiled hashes, and verdicts match. Fifty failures remain in the receipts; they are not excluded or treated as passes. The [validation summary](promise-root-validation/summary.json) links gzip-compressed per-variant reports, logs, and probe sources. Clean relocated builds reproduce engine SHA-256 `122d99522fb6ac0ae431e355de57a8614fa5bb90042b0218cb59be8bafd1c38a`.

React source inspection uses checkout `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `ReactFiberThenable.js` attaches fulfillment/rejection closures to pending thenables and mutates their status and value/reason. This confirms that callback reachability matters. It is not symbolic Suspense verification.

[Linux CI at `4c8b2670`](promise-root-validation/ci.json) passes all jobs, including 1,247 units and 74/74 smoke. The separate E2E and publish runs also pass. Earlier timing failures remain recorded; this does not establish stable Linux timing.

## Remaining root gaps

An unregistered external evaluator still loses a live weak target. The original partial `Promise.all` probe returned engine `[false,7]` versus V8 `[true,7]`. [Declared accumulator roots](promise-all-roots.md) now fix that probe. Partial `Promise.allSettled` results and `Promise.any` errors still produce that mismatch.

The accumulator probe attaches its observer outside the target's lexical environment. An initial version attached it inside that environment, which conservatively retained the target and masked the missing native capture. Both observations are recorded. Reaction marking does not discover every builtin's native captures. The remaining combinator and `finally` closures, module records, diagnostics, and saved continuations still need explicit policies and tests.

The [state inventory](engine-state-inventory.md) and [React completion checklist](symbolic-react-status.md) remain open. These root corrections do not implement transitive state ownership, shared-prefix React forks, or guarded reports.
