# Declared host-job roots

Pending timers and microtasks now retain their declared guest values through engine262's existing job records and collector. The runtime does not add a scheduler, inspect native closure contents, or change React's scheduling behavior.

## Job metadata and lifetime

`Job.capturedValues?: readonly Value[]` declares guest references held by a host callback. Basic and by-type job queues mark this list. Event loops mark it for queued and deferred registrations. The build exports upstream's existing `ByTypeJobQueue` so its path can be tested without implementing another queue.

For a running realm job, `runSingleJobInQueue` assigns the same list to `ExecutionContext.HostCapturedValues`. Context marking and shallow context copies preserve that reference. This keeps values live while the host job factory runs, before an engine evaluator takes ownership of its arguments.

A nonempty capture list requires a caller realm. Otherwise execution throws the host TypeError `Captured job values require a caller realm` before invoking the factory. Missing and empty lists preserve legacy realmless-job behavior. The concrete runtime treats this host failure as fatal and rejects further execution.

These are trusted host annotations. Supply values from the owning Agent. The list does not discover undeclared captures, validate arbitrary host graphs, or establish branch ownership.

## Concrete timers and microtasks

Timer registrations retain a mutable list containing their callback and arguments. Jobs reference that list rather than a separate copy. Starting the callback transfers those references to engine call arguments and clears the registration list. Cancellation and disposal also clear the list in place.

Canceled timers remain queued no-op jobs and still consume the existing job budget. They no longer retain callback values while waiting to dequeue. Microtasks declare their callback as a captured value and release the job's root after execution. Runtime disposal still cancels timers; it does not promise to purge all microtask or Promise state.

## Verification

`tests/gc-host-jobs.test.ts` adds twenty-one cases. All thirteen initial cases failed before the patch. Six Object/Symbol observations match independent V8 callback-queue models after a task boundary and explicit GC. The models verify closure/argument liveness, not browser scheduling parity.

Engine tests cover pending callbacks, completion, cancellation before dequeue, timer disposal, job-factory execution, shallow context copying, deferred-registration cancellation, all five queue paths, and realmless-job rejection/compatibility. The original timer probe now returns `[true,7]` in both engines.

The full local suite passes 1,228 tests across thirty-two files. The unchanged smoke passes 74/74. The weak-collection and `Promise.prototype.then` Test262 selection passes 745/749 in both engines, with matching input/compiled hashes and verdicts. Both engines fail the default and strict variants of `rxn-handler-fulfilled-next-abrupt.js` and `rxn-handler-rejected-next-abrupt.js`, reporting an unhandled Promise rejection. These failures are retained, not excluded.

[Validation receipts](host-job-root-validation/summary.json) retain the thirteen-case baseline, the initial missing-export typecheck failure, conformance results, and current probes. Engine SHA-256: `15d0f9a0459edd4f027e6dc8a717e171096b3de1d4c27a298495cdb7e0f3d34d`. No worker limit, timeout, or smoke selection changed. [Linux CI at `60d0a6ed`](host-job-root-validation/ci-failure.json) passes 1,228 units but fails both numeric smoke variants at the unchanged timeout.

## Remaining root and ownership gaps

An unregistered external `ScriptEvaluation` suspension still loses a live weak target. At `60d0a6ed`, a pending-Promise probe also reported engine `[false,7]` versus native V8 `[true,7]`. The later [Promise-root correction](promise-roots.md) fixes that reaction, marks capabilities, and annotates intrinsic reaction/assimilation jobs. A partial `Promise.all` result still loses a live target.

Saved snapshots, native captures, module state, diagnostic host values, and branch-owned queues still need explicit treatment. The [state inventory](engine-state-inventory.md) and [React completion checklist](symbolic-react-status.md) remain open. This correction is not general React branch isolation or a guarded transition API.
