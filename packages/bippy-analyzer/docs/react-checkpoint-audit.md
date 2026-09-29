# Actual React checkpoint capture audit

The numeric React fixture now attempts ownership capture at its first abstract `Object.is` decision. This exposed a storage-capture bug and identified a constructor-tracking restriction. The later [constructor checkpoint increment](constructor-checkpoints.md) removes that selected-property restriction. The inventory below records the preceding owner-storage build. It does not establish React branch isolation.

## Storage capture inside the owner callback

`PropertyKeyMap.entries()` is a lowered iterator. The control checkpoint lock correctly prevents it from resuming during owner capture. Storage snapshots used that iterator through property-table spreads and graph traversal, so creating a storage checkpoint inside `owner.capture` failed.

`owner-storage-capture.patch` uses the property table’s existing native `forEach` instead. Descriptor order and identities remain unchanged. The patch does not relax the control lock or permit guest execution during capture.

Two storage regressions now create selected and transitive data checkpoints inside an Agent owner callback. Both restore and resume Boolean choices. Direct property-iterator resumption still rejects under the lock. The strengthened numeric React tests also create and release selected queue/update snapshots inside the owner callback. All four checks failed before the fix and pass afterward.

## Observed React records

The fixture uses installed React and Test Renderer 19.3.0. Source inspection uses React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, not a build of that checkout. `ReactFiberHooks.js:dispatchSetStateInternal` stores eager state on an update before its `Object.is` bailout decision.

The test-only record inspector finds one fiber, hook queue, and eager update among direct control roots and data-valued environment bindings. At the owner-storage revision, it verified:

- The queue retains the original unknown Number state.
- The update has `hasEagerState = true` and the expression `amount + 1`.
- The bound dispatch arguments reference that same fiber and queue.
- Selected queue/update property capture succeeds inside the owner callback.
- The closed-data graph rejects the update’s broader references.
- Selected fiber capture rejected its nonempty constructor-tracking state. The later constructor checkpoint increment captures the fiber, queue, and update together.

The inspected fiber has one `ConstructedBy` entry and no private elements. The queue and update have neither. Constructor checkpoints now restore that list explicitly rather than treating the fiber as plain data. This does not establish ownership of its referenced graph.

The owner then rejects general ownership explicitly. The exact decision remains pending. Resuming afterward still matches ten independent native mount/update/unmount observations, including committed trees, render counts, effects, and Number state. This verifies failed-capture recovery, not a shared-prefix React fork. The queue/update snapshots are released without attempting React rollback.

## Root inventory and its limits

The archived probe records 7,775 root references, 839 distinct direct values, and 188 control-owned objects. The latter are 94 frame/local pairs, not 188 independent continuations. Distinct direct roots include 680 native functions, 23 native arrays, eight execution contexts, six ReferenceRecords, one Agent, one realm, and one global environment.

Following the explicitly inspected environment links visits 22 environments and finds 433 guest objects in direct roots and data-valued bindings. This is not a transitive heap census. It does not classify every native function, descriptor record, array element, module, or queued job. These counts describe this pinned fixture and build, not stable API limits or ownership proof.

The initial diagnostic used `properties.keys()` inside the owner and hit the same iterator lock. The corrected inspector uses `forEach` and reads native data descriptors rather than guest getters. A standalone probe also failed because its fixture helper imports Vitest; the recorded driver runs as a temporary test file. The [audit receipts](owner-storage-capture-validation/react-roots.json) retain the driver, observations, source hashes, and iterator failure.

## Validation and remaining work

The full local suite passes 1,436 tests across forty-four files. The unchanged smoke passes 74/74. Object.create, Reflect.ownKeys, Map.set, and Set.add pass 736/736 in both engines with matching input hashes, compiled hashes, and verdicts. Typechecking, two relocated builds, frozen offline installation, and the root check pass.

The engine SHA-256 is `dd42a5734a8bcde1055fd819f207a1b8f6e478f04ee611d3bc23fbac34036c33`. [Linux validation](owner-storage-capture-validation/ci-failure.json) passes all 1,436 units and reproduces that hash, but fails both numeric `substr` smoke variants at the unchanged timeout. E2E and publish pass. The longer diagnostic profiles are not gate passes. The preceding data-graph revision passed 1,434 Linux units but failed both numeric `substr` smoke variants at the unchanged timeout. Its [failure receipt](data-graph-checkpoint-validation/ci-failure.json) retains logs and diagnostic profiles; longer diagnostic runs are not smoke passes.

Transitive constructor ownership, native captures, intrinsic and environment graphs, execution contexts, and queued work still need ownership policies. Guarded React trees, transitions, repeated state families, and demo integration remain incomplete.
