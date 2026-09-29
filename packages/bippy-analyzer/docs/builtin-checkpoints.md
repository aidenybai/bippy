# Selected builtin function properties

`createStateCheckpoint` now restores properties on canonical guest builtin functions. It preserves the builtin’s identity and validates its metadata before restoration. Native closure state and referenced records remain separately owned.

## Reuse and capture policy

The patch extracts the existing builtin slot prefix from `CreateBuiltinFunction` into `builtinFunctionInternalSlots`. Creation and checkpoint validation share that frozen list. `hasBuiltinFunctionMethods` checks the engine’s original call/construct methods through data descriptors. It also checks that native behavior is callable and the async flag is Boolean.

Capture requires the canonical slot prefix, unique string slot names, and a false class-constructor marker. Additional declared slots must use data descriptors or be absent. The existing selected-function snapshot records each descriptor’s presence, flags, and value. It also records `nativeFunction` and `HostCapturedValues`, including when the latter is not declared as a slot. The saved slot-name sequence must match during restoration.

The implementation reuses existing property snapshots, Agent ownership, LIFO access, GC roots, and restoration preflight. It does not clone functions, replace their invocation methods, or dispatch calls itself. Ordinary-only and closed-data graph checkpoints still reject functions.

## Read-only metadata is not recursive ownership

Metadata values must retain their identity and descriptor shape. Replacing native behavior, call/construct methods, a declared record, or a capture array rejects before any selected property writes. Reordering or appending slot names also rejects. Metadata accessors covered by the tests reject without invocation.

In-place changes to referenced arrays and records do not rewind. Host closure counters do not rewind. The contract tests demonstrate both cases explicitly. Native function references do not expose their captures to the collector; selecting a builtin does not establish a complete root policy for undeclared captures. Capturing properties on a Promise callback does not restore its Promise, counters, jobs, or cleanup effects.

Metadata supplied by the host remains trusted engine state, not a hostile-host sandbox. The patch does not add a generic native-object walker or implicitly borrow an intrinsic graph.

## React relevance

The inspected React checkout is revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `packages/shared/objectIs.js` retains native `Object.is` when available. Executable fixtures use installed React and Test Renderer 19.3.0, not a build of that checkout.

At the first abstract bailout decision, the numeric React fixture now captures and releases selected fiber, queue, update, and intrinsic `Object.is` properties. The owner then rejects broader ownership. The exact decision remains pending, and normal resumption still matches ten native sequences. This is not React rollback or a shared-prefix React fork.

## Validation and retained failures

Thirty-nine builtin tests pass. The final unchanged fixtures have twenty-nine failures and ten existing rejection passes against the preceding engine. Seven builtin forms exercise calls, construction, array/Map methods, an iterator factory, and an accessor function in both branch orders. Independent native comparisons cover twenty-eight branch observations and fourteen baselines. Two Agent fixtures add four native comparisons with forced GC and one prefix per order.

Other tests cover metadata replacement, slot-layout changes, accessor rejection, malformed/foreign capture, saved property/slot roots, and explicit non-restoration of native captures. The previous `Math.max` rejection case is replaced by this positive matrix; other selected-function exclusions remain tested.

The first patched oracle failed four cases because V8 and engine262 install Object/Array intrinsic properties in different orders. The corrected oracle compares branch-created key order independently and verifies full restored order against each engine’s own baseline. The original failures remain archived rather than treated as checkpoint regressions.

The full local suite passes 1,504 tests across forty-six files. The unchanged smoke passes 74/74. Function.call, Function.apply, Function.toString, and Reflect.construct pass 356/358 in both engines, with matching input hashes, compiled hashes, and verdicts. Both `Function/prototype/toString/built-in-function-object.js` scenarios retain their ten-second timeouts. This selection is not fully passing conformance.

Typechecking, two relocated builds, frozen offline installation, and root checks pass. The engine SHA-256 is `330d9dd26093b2ec7b33f3d2fb686e31d8a863fd7c88fb95663bf62883778a4a`. [Validation receipts](builtin-checkpoint-validation/summary.json) retain baseline failures, corrected oracles, reports, source hashes, and cleanup evidence. [Linux CI](builtin-checkpoint-validation/ci-failure.json) passes 1,504 units and reproduces that build hash, but fails both numeric `substr` smoke variants at the unchanged ten-second timeout. E2E and publish pass. Diagnostic profiles remain archived and do not establish gate success.

The preceding constructor increment passes 1,466 Linux units and 74/74 unchanged smoke, with a matching relocated build hash. Its [CI receipt](constructor-checkpoint-validation/ci.json) also records successful E2E and publish workflows. That result does not erase earlier Linux timeouts or establish timing stability.

## Remaining goal work

A transitive owner still needs policies for intrinsic graphs, native captures, environments, contexts, modules, queues, and host effects. Guarded React trees, shared-prefix branches, event/effect transitions, repeated state families, and symbolic demo integration remain incomplete.
