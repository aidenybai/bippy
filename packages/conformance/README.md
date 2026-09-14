# Conformance

The canonical home for Bippy's unit tests, React conformance tests, DevTools fixture, test dependencies, tooling, and audit findings. This is a private test package, not a React implementation or a guarantee of universal compatibility.

## Run

```sh
pnpm test:conformance
```

Runs library tests, DevTools fixture tests, conformance tests, TypeScript checks, a production Bippy build, and fresh-process ESM/CJS checks against development/production React. CI uses the same checks. Browser and Detox E2E remain separate.

Focused commands:

```sh
pnpm --filter conformance test --project unit
pnpm --filter conformance test --project conformance
pnpm --filter conformance typecheck
pnpm --filter conformance coverage
pnpm --filter conformance test:built
pnpm --filter conformance bench:use-fiber
pnpm --filter conformance bench
pnpm --filter conformance bench:smoke
```

Library coverage retains its original unit-test scope and writes reports to `coverage/` here. The normal test command runs all projects, including exact upstream stack assertions, without coverage instrumentation.

## Deterministic core scenarios

The core scenario corpus uses the fixed seeds `0`, `1`, `42`, `3735928559`, and `4294967295`, not fresh randomness on each run. `seeded-random.test.ts` pins the generator's output vectors and checks independent streams. Keep the lockfile pinned when replaying React behavior.

The shared-wakeable, hidden-deletion, and gated concurrent-traversal scenarios compute their entire operation or handoff schedule before executing it. Each runs twice with fresh fixtures and compares its complete logical event transcript. Fixed-case rejection/recovery, live commit lifecycle, reentrant render-phase observers, activation lifetimes/readiness, explicit-ID ownership, and portal ref lifetimes/failures also compare independent replay transcripts. Async traversal advances through explicit promise gates, not sleeps or timing thresholds. React tests require evidence that suspension and memo bailout occurred, but do not snapshot speculative render-attempt counts, timestamps, or absolute global Fiber IDs.

Retained-hook replays nest three activation-driven replacements with colliding renderer IDs, then delete roots in each of the six fixed orders. Old hook callbacks must preserve their own renderer/root association after the target points elsewhere. Exact unwind, reporting, listener, root-tracking, and ID-release traces are checked before comparing fresh replays.

Numeric ID boundary cases run twice in fresh Node processes through the checked-in TypeScript worker. Their exact allocation vectors cannot poison another test's global counter. The corpus includes the last safe integers, an unsafe integer, Infinity, NaN, and a negative explicit ID. Alternate-ownership replays independently select the committed root branch while interleaving explicit claims, inherited IDs, automatic allocation, reassignment, and deletion through either alternate.

Finalization replays use explicit weak-collection and callback schedules, not GC timing. They cover all four combinations of weak-reference/finalizer availability, stale notifications after ID transfer, lazy dead-entry cleanup, same-ID/zero-ID churn, retained handles, and deletion through either alternate. A separate native audit delegates registration and cancellation to the real built-ins while handles stay alive. Registration counts and lookup work are checked; this is not a native collection-timing or heap-size benchmark. Numeric-key ownership runs all 81 ordered pairs of NaN, signed zeros, infinities, signed minimum subnormals, and signed fractions through explicit claims, alternate inheritance, reassignment, deletion through either alternate, and fresh allocation. Fresh workers isolate these IDs from shared tests. An independent label-based oracle requires shared reverse ownership for signed zeros while exact forward reads retain their sign, and checks registration bounds across all five runtime modes.

Cleanup cascades run six fixed cases twice: either root initiates deletion, followed by a layout-driven state update, a passive external-store publication, or a publication with feedback into the receiving root. Exact traces distinguish guarded sync flushing from nested passive commits. Feedback advances a root again before its older post-commit callback runs, so both post-commit deliveries observe the latest `root.current`. Checks cover alternate reuse, retained/released IDs, root isolation, subscription cleanup, and throwing observers/reporters. Root-argument parity replays also mix `FiberRoot` and current root-fiber inputs during throwing and nested traversal. These live cases use pinned React 19, not the full version matrix.

Hydration replays generate real server markup with two failed Suspense boundaries, then hold client retries behind explicit wakeables. Both reveal orders and deletion of the still-pending boundary run twice. Exact traces cover dehydrated-fragment deletion, new fallback mounts, the unchanged-fallback retry commit, recovery errors reconstructed from server markup, and subsequent primary mounts/updates. A hydrated shell must retain its server DOM and identity through bailouts; component-body presence sets independently verify rendering without counting speculative attempts. A separate control root must survive recovery and cleanup. Settling a deleted boundary must not commit. Two small topology regressions also cover nested primary/fallback selection inside the newly mounted fallback. These use pinned React 19 `renderToString` hydration, not streaming SSR or a hydration version matrix.

Selective-hydration replays retain successful server content while both boundaries suspend on the client. Two blocked focus events exercise React's latest-event coalescing; the overwritten target hydrates first without receiving focus. The latest target either hydrates and receives one cloned event that updates its state, or is deleted before hydration and receives only a native replay on the detached server node. An explicit native-event gate waits for replay without sleeps. Late wakeable settlement must not render or commit, and a subsequent remount must use fresh host/boundary identity without inheriting focus state. Exact traces and identity checks cover root/fiber argument aliases, host lookup before/after hydration and detachment, observer/reporting failures, and a separate unaffected root. Four additional replay-error cases throw during the focus-triggered render after successful hydration. They require the original caught error and boundary instance, force-remounted error fallback, retired hydrated identity, and unchanged sibling/control roots. After changing fallback state, resetting the same boundary must retain that state and identity with matching type/key, but discard both with a distinct fallback key. This follows React's forced reconciliation on error entry versus ordinary reconciliation on reset; the initial reset oracle incorrectly expected both paths to remount. These pinned React 19/Happy DOM cases are not browser event-compatibility or streaming-SSR coverage.

Same-root commit replays run six explicit nested-commit schedules through both root argument forms. The first listener flushes an update, keyed replacement, or empty tree before the outer event reaches the later listener; two-flush cases also reuse the outer root alternate. An independent operation model checks exact layout/deletion/observer order, repeated mount/update/unmount notifications, live/released IDs, host detachment, and subsequent recovery. The later listener sees the newest tree with the outer event's original priority, not the nested synchronous priority. Throwing observers/reporters cannot suppress delivery, and another root remains unchanged. These cases test pinned React 19 commit callbacks, not immutable traversal snapshots or updates made from inside a traversal visitor.

Superseded-transition replays run all six assignments of three keyed rows to two suspension points and an urgent deletion. Cases either abandon both transitions or complete the newer one before deletion; obsolete wakeables are fulfilled or rejected. Each fresh-fixture replay proves that the second pending render reuses the first render's inactive fiber, while lookups still select the committed branch. Urgent deletion must release both alternates, and later remounting must create a fresh host, ID, and state token. Exact traces retain React's additional unchanged-tree commit while skipped updates are rebased; component-body presence sets independently prove that this commit renders no rows. When both transitions are abandoned, the earlier wakeable settles while newer work remains pending; the later one settles after the urgent update without rendering or committing. When the newer transition completes, the older wakeable stays pending through urgent deletion and settles afterward without reviving stale state. Exact alternate identities differ between these paths, while retained state/DOM and subsequent fresh remounts follow the same logical key model. Mixed root arguments, throwing deletion observers/reporters, memo bailouts, and another live root remain covered. These are pinned React 19 state-queue cases, not scheduler timing or version-matrix guarantees.

Replay one scenario from the repository root:

```sh
pnpm test --project conformance shared-wakeable-fuzz -t "seed 42$"
pnpm test --project conformance hidden-deletion-fuzz -t "seed 42$"
pnpm test --project conformance traversal-fuzz -t "early stop, seed 42$"
pnpm test --project conformance renderer-readiness-replay ref-failure-replay
pnpm test --project conformance fiber-id-ownership-replay fiber-id-boundary-replay
pnpm test --project conformance fiber-finalization-replay
pnpm test --project conformance cleanup-cascade-replay render-phase-reentrancy
pnpm test --project conformance hydration-fallback-replay
pnpm test --project conformance selective-hydration-replay
pnpm test --project conformance nested-commit-replay
pnpm test --project conformance superseded-transition-replay
```

Failures include the seed and operation/handoff index. Runner durations and stack paths are diagnostics, not expected outputs. The thenable-assimilation and in-flight dispatcher-replacement regressions use fixed case tables without generated inputs.

Run the core suites on Node 22 as well as Node 24. The current transformer left a `using` declaration inside the commit-lifecycle replay's `finally` block untransformed: Node 24 parsed it, but CI's Node 22 failed before collecting tests. That cleanup now explicitly calls the instrumentation disposer; lifecycle and identity assertions remain unchanged.

## Keep each contract in one place

- Add React behavior and adversarial regression tests in `tests/`. Extend an existing case rather than copying it into another suite.
- Keep implementation unit tests and their runtime helpers in `tests/unit/`, and DevTools facade tests in `fixtures/react-devtools-headless/`. `packages/bippy` contains library/build code, not a parallel test tree.
- `vite.config.ts` owns the project list used by both workspace and package test commands. Each project runs once. Unit tests have no shared setup hook so pre-installation, late-load, and frozen-hook cases keep their original load order.
- Test dependencies belong here or in the DevTools fixture package; only dependencies needed to build/type-check the library stay in `bippy`. Its existing test/coverage scripts delegate here.
- `upstream.json` is the sole upstream inventory. It records reviewed revisions, source hashes, direct ports, and DevTools definitions, including the local counterparts of disabled upstream cases. Complete direct suites reuse those definitions rather than maintaining another title list.
- `api-coverage.json` maps public runtime exports to their existing tests. Source and packaged-build checks share the same export reader.
- `scripts/test-inventory.ts` is the shared parser used by inventory tests, source verification, and DevTools synchronization. `tests/upstream-inventory.test.ts` owns port accounting; the fixture no longer has a parallel inventory checker.
- This README owns the audit findings. `NOTICE` contains the React license.

Matching test titles or export names is accounting, not proof of behavioral equivalence. Development and production runs, different renderers, and synthetic versus live fibers are distinct checks, not interchangeable duplicates. The React test-renderer inspection ports run in development; unreachable production snapshots are not retained or counted as production coverage.

## Upstream maintenance

Use a local `facebook/react` checkout at the main revision recorded in `upstream.json`:

```sh
REACT_SOURCE=/path/to/react pnpm --filter conformance check:upstream
```

This verifies source hashes and direct-port titles. Normal tests need no React checkout. The standalone hook-inspection suite ports all upstream development cases, retaining hook values, IDs, editability, nesting, debug information, and function names; only source file/line/column coordinates are normalized.

To synchronize the DevTools inventory and hook-source fixtures:

```sh
pnpm --filter conformance sync:devtools
pnpm --filter conformance sync:devtools --ref <reviewed-git-ref>
```

The default is the already-pinned DevTools revision, not `main`. Synchronization preserves the other inventory sections and recorded local mappings. Review upstream changes and port assertions before changing a pin or expected coverage; do not merely update counts to make checks pass.

## Audit: fixed defects

The source-backed audit reproduced and fixed:

- **`useFiber` capture fragility:** restored early React updates without ref-parity guessing, fixed early CommonJS/ESM interop, rejected unrelated bound objects, and removed the dependency on external-store subscription binds. Development can capture through DevTools with locked `bind`; all tested versions can update after a successful capture without patching `bind`.
- **Production Node crash:** the inherited browser DCE diagnostic scheduled a fatal exception for React's intentionally unbundled Node entrypoints. Node now skips that diagnostic; browser behavior remains tested. Packaged checks do not disable `checkDCE`.
- **Inspection corruption:** hook replay mutated committed compiler-cache slots/indexes, and nested inspection stole outer hook state/logs. Replay now uses copied slots and an independent index, rejects reentrancy, and cleans up dependency-resolution errors.
- **Traversal failures:** `traverseFiber` and `traverseRenderedFibers` overflowed on deep trees; cyclic/deep type wrappers also overflowed. These now use iterative traversal, with cycle detection for wrappers. Rendered-phase tests cover 20,000-deep and 20,000-wide mounts, updates, and simulated unmounts while preserving the existing visitation order. Suspense primary mounts also handle React 16's unwrapped children; live tests cover primary/fallback siblings across the version/build matrix.
- **Thenable assimilation:** async traversal read a selector's `then` accessor twice, rejecting valid one-shot thenables. It now captures the method once and assimilates it with its original receiver. Fixed cases compare accessor/call traces, nested settlement, rejection, and throw-after-resolution behavior against native Promise assimilation.
- **In-flight instrumentation replacement:** rewiring a dispatcher from a previous hook dropped the current event, including root tracking and unmount ID release. Dispatch ownership is now captured before invoking the previous hook; superseded wrappers still forward without duplicate listener delivery.
- **Render-phase history:** a throwing visitor left traversal history behind, making the next update look like a mount; a second observer also missed root unmounts. History now advances before visitor callbacks, and previous mount state comes from the committed alternate when available. Live regressions cover throwing/nested visitors and multiple observers across root swaps and deletion. Root-fiber arguments previously split history across alternates, reporting an update as a mount. Native root fibers now use their stable `stateNode` FiberRoot as the history key, sharing it with FiberRoot arguments; object-root behavior and standalone-fiber fallback remain unchanged.
- **Hydration fallback omission:** traversal treated dehydrated Suspense and client fallbacks as the same timed-out state, then skipped the new fallback because the previous dehydrated fragment had no fallback sibling. New fallback branches now mount even without a previous fallback; retained branches still update without remounting. Live hydration replays reproduced missing mount notifications despite real layout/passive mounts, and minimized topology cases verify nested traversal order and exact fiber identity.
- **Activation subscription lifetime:** duplicate `onActive` registrations shared one cancellation entry, mutable options could prevent disposal, and replacement could resurrect the installer's disposed callback. Each registration now owns a captured activation listener; replacement uses only live registrations. Activation passes snapshot pending listeners so reentrant registrations receive their immediate notification once rather than twice, while canceled pending listeners remain skipped.
- **Activation readiness:** activation ran before a new subscription's dispatchers/listener were installed; replacement activation also ran before replacement dispatchers and the injection wrapper were ready. Commits and nested renderer injections made inside activation were lost. Registration and hook preparation now precede activation. Replacement observers run after injection preparation but before pending activation callbacks, whose membership is captured before those observers can register new listeners. Fixed replays check exact nested injection/error traces, reentrant commits/root tracking, direct installer cancellation, and no duplicate activation. External descriptor replacement, writable data properties, and locked getters bypass the installed setter. `instrument()` now wires an existing hook before patching can activate pending listeners, so those callbacks cannot lose commits during explicit reattachment. Arbitrary external writes are not observed automatically.
- **Explicit ID ownership:** changing a former claimant's explicit ID erased a newer claimant's reverse lookup. Reassignment now removes an old reverse entry only if that fiber still owns it. Exhaustive fixed schedules check last-writer ownership through reassignment and deletion. A previously unqueried alternate also stole a newer explicit claim when inheriting its partner's ID. Inheritance now preserves unrelated live reverse ownership while remembering the inherited forward ID; it can still restore an unclaimed reverse entry. Root swaps and deletion through either alternate verify exact current-Fiber identity and cleanup.
- **Automatic ID exhaustion:** a high explicit ID could advance allocation past `Number.MAX_SAFE_INTEGER`, where repeated increments produced the same ID and overwrote live lookups. Both automatic allocation paths now throw `RangeError("Fiber ID space exhausted")` before changing mappings. Generated IDs do not wrap or recycle after exhaustion. Existing-ID reads, alternate inheritance, and explicit assignments remain available. Explicit unsafe/nonfinite IDs retain their previous behavior and do not advance the safe-integer counter.
- **Finalization registration retention:** reassignment added another registry cell for the same live fiber, including unchanged IDs, and explicit unmount left those cells registered while external handles retained the fiber. Fibers now serve as cancellation tokens: reassignment replaces the previous registration, and release unregisters both alternates. Stale queued callbacks still check current reverse ownership. Replays enforce at most one active registration per assigned fiber and none after release, including throwing unmount observers/reporters. This bounds registration metadata and future cleanup work; it does not claim that native finalization registries strongly retain their targets.
- **Incorrect identity checks:** forged/coercible element markers were accepted, and unchanged falsy host props were reported as renders. Element markers now use global symbol identity; prop comparison preserves falsy values.
- **Excessive work:** cached work-tag lookup still walked to the root, current-fiber lookup scanned unrelated subtrees, and invalid host keys polluted the lookup cache. Operation-count regressions cover reductions from 1,001,000 to 2,000 parent reads, 2,000 to zero unrelated child reads, and 500 to zero poisoned-key reads in their respective fixtures.

The audit also replaced the unchecked standalone inspection copy, removed obsolete recursion helpers, aligned the coverage provider with Vitest, and added type/published-entry checks to CI. Public aliases/constants were retained; internal disuse alone does not justify breaking exports.

### Runtime isolation and cache invalidation

Synchronous errors from Bippy's activation, renderer-injection, hook-replacement, and instrumentation listeners are reported through `console.error` without stopping later listeners. Existing commit/schedule/post-commit/unmount hook callbacks receive the same isolation and retain their receiver. Reporting failures are contained too. Root tracking and Fiber-ID cleanup continue after callback failures. This intentionally replaces the old throw-and-stop behavior: React catches injection errors before retaining its hook, which otherwise disconnects future commits. Live tests cover development, production, and profiling builds across the version matrix. Rejected promises and failures inside a foreign hook's `inject` implementation are not isolated.

Ref-cleanup failure replays combine React error-boundary recovery with throwing instrumentation and error reporters. The hiding case requires an intermediate Suspense fallback commit before error recovery; the deletion case requires an empty commit. Both check exact ref/layout/passive/deletion/commit order, the caught error's identity, released IDs, remount identity, and the unaffected Fiber/host in another root sharing the portal container. These are fixed, twice-run React 19 cases, not a version-matrix claim.

Work-tag lookups distinguish explicit associations from inherited cache entries. Association changes invalidate inherited entries by generation; unchanged associations retain the fast path. Revalidation preserves explicit subtree/root associations and cached metadata on detached Fibers. A changed association can require unrelated inherited entries to walk their ancestors once again; ordinary commits with unchanged tags do not invalidate them.

## Audit: remaining defects and limits

1. **Medium — inspection is not a sandbox.** Replayed user code can mutate refs, props, or objects inside cached slots. Slot-array copying does not isolate the reachable object graph. `useFiber` may temporarily patch global `Function.prototype.bind` for an initial capture; production mounts with an already-locked intrinsic remain a constraint.
2. **API/version mismatches.** The React peer range begins at 16.0, but hooks require at least 16.8. The `useFiber` version, attack, and fuzz matrices include 16.8.6, 16.12.0, 16.13.0, 16.14, 17, 18, 19, canary, and experimental. This is not exhaustive patch-version coverage. `Fiber` props are typed as objects despite real null/primitive values; generated work-tag numbers are not directly assignable to `Fiber.tag`. The async traversal overload also promises a Promise for a null fiber, although runtime returns null: `await` works, `.then()` does not.
3. **Coverage gaps.** Some older direct ports still disable type checking or hardcode development expectations. Existing React 19 compatibility skips remain visible. Istanbul currently changes standalone inspection stack names (`Component` becomes `renderFunction`), so those exact assertions do not pass under coverage instrumentation. They remain enabled in normal runs. Full reconciler, scheduler, DOM, hydration, streaming SSR, Flight, compiler, native, and feature-gate suites are not ported. Per-renderer/version checks do not establish the same coverage for every API.
4. **Setup gaps.** The combined suite can emit localhost:3000 connection-refused errors while passing and needs a hermetic network audit. Installation still reports Detox/expect and playground Vite/plugin peer mismatches. Broad dependency ranges need review on lockfile refresh. `publint` suggests declaring supported Node versions and reviewing side effects; blindly setting `sideEffects: false` would break hook installation.
5. **Export scope.** The runtime inventory covers `bippy` and `bippy/source`, and packaged checks exercise `bippy/install-hook-only`. Public `./dist/*` patterns expose additional implementation chunks; removing them requires a compatibility decision.

Next priorities are the API/version mismatches, unchecked ports, and broader runtime coverage. The broader audit was verified locally on Node 24. Core unit/conformance suites and packaged-entry checks were also run locally on Node 22 after the commit-lifecycle cleanup compatibility fix; this does not extend the full audit or browser/Detox coverage to that runtime.

## Performance checks

`pnpm --filter conformance bench:use-fiber` builds production ESM, loads it against isolated React versions, and compares mounts/updates with and without `useFiber`. It covers all nine React fixtures at 100/1,000 components with 0/32 preceding hooks. Add `--cjs` for CommonJS. It reports medians of five samples after warm-up, with five updates per sample. Timing is diagnostic, not a CI threshold.

One local Node 24.20.0/Happy DOM run, with 1,000 null-rendering components and no preceding hooks, measured these milliseconds per full update:

| React  | Before the `useFiber` optimization | After | After, without `useFiber` |
| ------ | ---------------------------------- | ----- | ------------------------- |
| 16.8.6 | 2.719                              | 0.262 | 0.130                     |
| 18     | 0.239                              | 0.210 | 0.116                     |
| 19     | 0.237                              | 0.195 | 0.142                     |

The meaningful change is removal of repeated root searches on ordinary early-React updates, which could make updating many `useFiber` components quadratic in tree size. Modern-React differences are small enough to treat as timing noise rather than a promised speedup. The capture record is also reused instead of allocating a replacement on every update. These are synthetic measurements, not browser/mobile guarantees.

`use-fiber-performance.test.ts` checks zero unrelated-subtree reads and exact rendering-Fiber identity across the version/build matrix. Other operation-count tests retain linear ancestor lookup and avoid unrelated current-fiber searches. `useFiber` still scans hook lists for its marker, and ambiguous early-React topology retains a full-tree fallback; it is not universally constant-time. Initial production captures still allocate a bind proxy. Updates do not patch `bind` or schedule passive effects. Published-entry checks also enforce the `"use no memo"` directive in the exported ESM/CJS function.

### Full public-export benchmarks

`pnpm --filter conformance bench` builds Bippy and benchmarks all **65 function/constructor exports** from `bippy` and `bippy/source`. Aliases are verified rather than presented as independent implementations. Data exports are inventoried, not timed as functions. Coverage checks reuse the canonical export reader and reject missing or invented exports.

The suite produces 708 microbenchmark rows (177 scenarios across ESM/CJS × development/production), 72 production `useFiber` configurations, and 12 cold-import measurements:

- Core helpers, wrapper cycles/depth, IDs, alternate reflection and root-search fallback; deep/wide trees up to 10,000 nodes; mounted/updated trees and Suspense simulated unmounts.
- Cold/warm work-tag caches, changed associations, live DOM host/renderer lookup, and synthetic Native-tag root searches.
- Hook installation, subscription churn, activation, renderer injection, commit/unmount/post-commit/schedule fan-out through 1,000 listeners, and throwing listeners with a stubbed reporter.
- Synthetic debug/owner/parent stacks, V8/Safari parsing, source-map lookup and decoding, indexed maps, symbolication, and hook names. Fetching uses in-memory responses; attempted default network requests fail the worker.
- `getFiberHooks` and standalone `inspectHooks` at 1/16/128 state hooks, custom-hook calls, or distinct state-call sites. The distinct fixture keeps all 128 call sites explicit in a typechecked TypeScript file rather than generating executable code with `new Function`. Each custom hook contains state, memo, and ref primitives. Live inspection roots are mounted only for their owning case and unmounted even after verification failures.
- Production `useFiber` mounts/updates across nine React fixtures, with/without-hook baselines, exact component/props identity checks, and render-count assertions.
- Fresh-process native Node imports of all three entrypoints; runtime bundle sizes, gzip sizes, and SHA-256 hashes.

Each run writes validated results incrementally to `benchmarks/results/run-*/progress.jsonl`. Completed runs also write `report.json` and `report.md` there and replace `latest.json` / `latest.md` (or `smoke.*`). Interrupted runs retain their completed groups without replacing the last successful report. Generated results are ignored by Git. JSON retains raw microbenchmark samples, calibrated iteration counts, min/median/max microseconds, `useFiber` summary medians, environment metadata, export accounting, and worker peak RSS. Workers run sequentially; synchronous operations do not pay an `await` per call. Preparation and result validation occur outside timing, allocation-heavy cases cap batch sizes, and a bounded result sink consumes return values. GC is not forced; yielding between batches lets WeakRef targets become collectible. Small measurements include harness overhead. Peak RSS includes fixtures, harness, and runtime, not just library allocations.

`bench:smoke` requires existing build output. CI runs it after the packaged checks to validate fixtures, measurements, and export accounting, not to enforce timing thresholds. Smoke mode uses one iteration/sample and a small React 19 `useFiber` configuration; its timings are not benchmark results. Harness unit tests cover async waiting, timing boundaries, cleanup, calibration caps, and coverage failures. Report tests reject malformed values, null/nonfinite timings, inconsistent summaries, and duplicate IDs. Fixture tests check independent cleanup and distinct source contents. Journaling tests verify that interrupted runs preserve completed results.

Workers are checked-in TypeScript files. The cold-import probe is compiled before launching native Node, so its timings exclude both compilation and the `tsx` loader. Case registration, variants, groups, statistics, process execution, and report encoding each have a shared implementation. Hook benchmarks verify state values, not just hook counts.

Before the source hot-path optimization below, a local Apple M5 Max / Node 24.20.0 / Happy DOM run of production ESM showed these approximate per-operation medians:

| Workload                                                        |    Time |
| --------------------------------------------------------------- | ------: |
| Inspect 128 state hooks                                         |  3.2 ms |
| Inspect 128 custom-hook calls (384 primitives)                  |  9.6 ms |
| Traverse 10,000 updated Fibers                                  |  1.1 ms |
| Simulate hiding 10,000 primary Fibers                           |  1.1 ms |
| Dispatch a commit to 1,000 listeners                            |   23 µs |
| Source-content lookup at the tail of 10,000 synthetic filenames |  185 µs |
| Function-name lookup at the tail of 10,000 mapping rows         |   33 µs |
| Cold in-memory fetch and decode of a 1,001-line map             |  100 µs |
| Cached source-map fetch                                         | 0.13 µs |

For 1,000 null-rendering React 19 components, update medians were 0.244 ms without `useFiber` and 0.307 ms with it. With 32 preceding refs, the corresponding values were 0.764 and 1.070 ms. React 16.8.6 without preceding hooks measured 0.193 and 0.381 ms. Differences between separate medians are diagnostic, not isolated per-hook costs; direct capture timers also include clock overhead.

Hook inspection is the standout cost: avoid replaying every component's hooks on every render/commit. Large reverse source-map lookups and ancestor/root searches remain linear-work candidates for follow-up profiling. Warm direct lookups and listener dispatch are much cheaper in these fixtures. Cache writes and allocation-heavy cold cases show wider sample ranges.

These are workload snapshots, not universal API costs or a before/after comparison with the earlier optimization table. Core/source/inspection timing uses the installed React version; only `useFiber` spans all nine fixtures. Profiling-build timing, browser/mobile renderers, locked intrinsics, every private `dist/*` chunk, network latency, first-ever inspection initialization, and allocation/leak profiling are not covered. Synthetic Native-tag lookup is not a Native renderer benchmark.

### Source hot-path optimization

CPU profiles identified repeated stack parsing and location extraction in hook inspection. Location parsing now scans numeric suffixes from the end, retaining the previous handling of line terminators. Stack parsers consume lines directly instead of splitting/filtering each already-split line. Inspection reuses parsed frames within one tree build, including shared frames across distinct hook call sites; it does not reuse hook values or inspection results. Public `parseStack` calls still return fresh frames.

Reverse source-map lookups use indexed loops and avoid constructing later ignored candidates once a valid ignored fallback exists. No persistent reverse index is used: callers can mutate names, sources, mappings, contents, and ignore sets. First-duplicate semantics and application-source preference remain intact.

Historical paired production runs against the pre-optimization bundles from `35fe6a6`, using the same expanded fixtures on Node 24.20.0 / Apple M5 Max. The distinct-call-site row used the former generated fixture; the current checked-in fixture preserves the distinct sites but changes stack layout, so its absolute timings are not directly comparable:

| Workload                                          | ESM before → after | CJS before → after |
| ------------------------------------------------- | -----------------: | -----------------: |
| Inspect 128 state hooks                           |     3.21 → 2.28 ms |     3.74 → 2.83 ms |
| Inspect 128 custom-hook calls / 384 primitives    |     9.70 → 6.92 ms |    11.39 → 8.50 ms |
| Inspect 128 distinct state-call sites             |     3.82 → 3.03 ms |     4.36 → 3.56 ms |
| Parse 1,000 V8 frames                             |       655 → 464 µs |       633 → 470 µs |
| Tail source-content lookup / 10,000 filenames     |        183 → 40 µs |        181 → 40 µs |
| Function-name lookup past 10,000 ignored mappings |        121 → 59 µs |        125 → 63 µs |

`source-hot-paths.test.ts` checks 17,027 location comparisons against the previous parser, per-parser frame reuse/isolation, fresh public frames, mutable source maps, duplicate sources, and ignored-candidate work. The ignored-candidate regression reproduces 1,001 name reads before the fix versus three afterward. Existing inspection ports continue to check hook values, nesting, IDs, names, and cleanup.

These timings are diagnostic. Other local runs varied with machine load; native Error capture and Node's source-map-aware stack formatting still consume substantial inspection time. Replay is not safe to put indiscriminately on every commit, and these changes do not make reverse lookup or deep ancestor traversal constant-time. Runtime changes are limited to source parsing, symbolication, and inspection; `useFiber` capture behavior is unchanged.

## `useFiber` capture contract

Each call writes a unique memo marker and reducer marker. Development capture uses the renderer's `getCurrentFiber` only when that Fiber contains the current memo marker. Otherwise, an initial reducer bind can capture the Fiber, but only alongside the queue carrying this call's reducer marker. Bound argument positions are not hardcoded. Updates select the alternate containing the memo marker without patching `bind` or scheduling passive effects.

React [16.8.6](https://github.com/facebook/react/blob/v16.8.6/packages/react-reconciler/src/ReactFiberHooks.js#L410-L415) through [16.12.0](https://github.com/facebook/react/blob/v16.12.0/packages/react-reconciler/src/ReactFiberHooks.js#L477-L482) attach hook state after the component returns. For these versions, the retained reducer queue proves the hook ran. React-derived current-fiber reflection now locates the rendering alternate on ordinary updates, after validating that its parent chain reaches the work-in-progress root. An iterative root search remains for ambiguous topology. This is not ref-parity guessing. The marker regression introduced in `e2b879b` is covered by mount, update, Strict Mode, hydration, bailout, suspension, render-phase retry, and fuzz cases on early React. Default React imports also fix the old CommonJS namespace interop failure; focused tests exercise both import and require paths through `tsx`.

`use-fiber-capture-contract.test.ts` makes `useSyncExternalStore` throw if called, injects a decoy Fiber and an opaque bound argument through a dispatcher wrapper, and checks exact Fiber identity across development, production, and profiling builds. It also checks zero bind assignments on updates. The Native static suite checks reducer binding in the six shipped renderer bundles; it is not a Native runtime test.

`use-fiber-bind-attacks.test.tsx` tests frozen intrinsics and throwing bind setters before and after mount across React 16.14, 17, 18, 19, canary, and experimental in development, production, and profiling:

| Lock timing              | Development with matching DevTools Fiber     | Production/profiling                         |
| ------------------------ | -------------------------------------------- | -------------------------------------------- |
| Before first capture     | Captures without assigning `bind`            | Returns `undefined`; rendering continues     |
| After successful capture | Captures on updates without assigning `bind` | Captures on updates without assigning `bind` |

**Remaining boundaries:** React's [DevTools injection](https://github.com/facebook/react/blob/1d34f91dfde6bba84d08b683aaba164c7194dacb/packages/react-reconciler/src/ReactFiberReconciler.js#L899-L904) exposes `getCurrentFiber` only in development. There is no guaranteed equivalent production hook in the reviewed renderer, so a first production capture with an already-locked `bind` remains unsupported. Throwing setters no longer interrupt hook order. Full SES lockdown was not tested. Future changes to reducer binding, memo storage, or Fiber topology still require compatibility testing; removing the external-store dependency does not make React internals a stable API. Queue correlation rejects unrelated bindings, but is not a security boundary against code that deliberately forges React's private objects.
