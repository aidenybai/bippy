# Selected Error properties

`error-checkpoints.patch` lets `createStateCheckpoint` select initialized engine Error objects. It reuses the existing property, prototype, extensibility, constructor-tracking, and read-only metadata checks. It adds no exception or stack-formatting algorithm.

The four engine constructor implementations now share their existing `ErrorData` and `ErrorHostInternalSlots` list. The checkpoint uses that same list to identify supported storage. Error, native errors, AggregateError, SuppressedError, and public-field subclasses use this layout. Private instance state still rejects.

## Read-only diagnostics

Guest changes to `message`, `cause`, `stack`, and other properties restore in the original property table. The original object and property references keep their identities. Cause objects, aggregate error arrays, and other referenced values remain shallow unless selected separately.

`ErrorData` and the four host diagnostic slots remain read-only metadata. Capture saves their data descriptors, including absent properties. Changed values, presence, flags, slot layout, or internal methods reject before selected writes. Capture and validation do not call guest stack or message getters. Incomplete diagnostics reject rather than permitting a checkpoint across Error initialization.

This boundary follows the engine implementation. `setErrorHostInternalSlot` initializes cached strings during construction. The engine’s stack getter reads those strings. Its stack setter creates a guest property instead of changing the cache. A host that recomputes diagnostics after capture violates the read-only contract.

Diagnostic arrays and CallSite/context records are separate storage. Selection neither copies nor restores their contents. Tests explicitly mutate a stack list and verify that property restoration leaves that mutation unchanged. Saved diagnostic message arrays root their guest values while a replaced slot is detached. This does not establish a GC or restoration contract for CallSite contexts.

The ordinary-only and closed-data APIs still reject Error storage. Canonical metadata is trusted engine state, not a hostile-host sandbox.

## React evidence

The React source checkout at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` contains the relevant use in `shared/ReactComponentStackFrame.js`. It throws control and sample errors, then reads their stacks to determine component frames. This source inspection does not claim native stack-text parity.

The existing React/Test Renderer 19.3.0 diagnostic now accepts all four previously rejected Error objects. Four input assignments each accept 2,193 of 2,197 visited guest objects. Three WeakMaps and one RegExp still reject. Native arrays, contexts, queues, host effects, and omitted capture references remain outside this ownership proof.

The diagnostic only captures and releases selected storage, then rejects broader ownership. It never restores React. These counts do not establish a general React checkpoint or shared-prefix tree.

## Verification

`tests/error-checkpoint.test.ts` has 40 cases. The exact final test source fails all 40 against the preceding engine, without timeouts. All 40 pass with the patch.

Ten Error forms run both branch orders. Forty branch observations and twenty initial baselines match independent V8 runs. Native stack text and native own-stack layout differ, so they are excluded from those cross-engine observations. Restored engine stack text compares against its original engine baseline.

Other checks cover read-only metadata, getter rejection, validation before writes, nested checkpoints, shallow references, GC roots and release. Two Agent runs compare four branches with independent V8 executions. Each run executes one prefix and forces GC at restoration. These are selected Error forks, not React forks.

Local validation passes:

- 1,614 unit tests across 51 files and typechecking.
- The unchanged 74-variant smoke selection.
- 468 Error/native-error/AggregateError/SuppressedError conformance variants in both source and published engines. Input hashes, compiled hashes, and verdicts match. Both commands exit zero.
- Two relocated clean builds with SHA-256 `f08528aa501861de4e4e0a5a245855eb91e9cbd82616a94368cefc6da1a0ff9d`.

[Validation receipts](error-checkpoint-validation/summary.json) retain commands, source hashes, failures, and probe results. The first patched build failed because the method validator required a second argument. The corrected build passes. No gate, timeout, worker count, or oracle was relaxed.

[Linux CI for this revision](error-checkpoint-validation/ci-failure.json) passes 1,614 units with the matching engine hash. Both numeric `substr` smoke variants time out, leaving 72/74 passing. E2E and publish pass. Archived 30-second diagnostic profiles do not satisfy the unchanged ten-second gate.

General React state ownership, guarded tree reports, event/effect transitions, repeated families, and demo integration remain incomplete.
