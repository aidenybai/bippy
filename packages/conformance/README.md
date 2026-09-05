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
- **Incorrect identity checks:** forged/coercible element markers were accepted, and unchanged falsy host props were reported as renders. Element markers now use global symbol identity; prop comparison preserves falsy values.
- **Excessive work:** cached work-tag lookup still walked to the root, current-fiber lookup scanned unrelated subtrees, and invalid host keys polluted the lookup cache. Operation-count regressions cover reductions from 1,001,000 to 2,000 parent reads, 2,000 to zero unrelated child reads, and 500 to zero poisoned-key reads in their respective fixtures.

The audit also replaced the unchecked standalone inspection copy, removed obsolete recursion helpers, aligned the coverage provider with Vitest, and added type/published-entry checks to CI. Public aliases/constants were retained; internal disuse alone does not justify breaking exports.

### Runtime isolation and cache invalidation

Synchronous errors from Bippy's activation, renderer-injection, hook-replacement, and instrumentation listeners are reported through `console.error` without stopping later listeners. Existing commit/schedule/post-commit/unmount hook callbacks receive the same isolation and retain their receiver. Reporting failures are contained too. Root tracking and Fiber-ID cleanup continue after callback failures. This intentionally replaces the old throw-and-stop behavior: React catches injection errors before retaining its hook, which otherwise disconnects future commits. Live tests cover development, production, and profiling builds across the version matrix. Rejected promises and failures inside a foreign hook's `inject` implementation are not isolated.

Work-tag lookups distinguish explicit associations from inherited cache entries. Association changes invalidate inherited entries by generation; unchanged associations retain the fast path. Revalidation preserves explicit subtree/root associations and cached metadata on detached Fibers. A changed association can require unrelated inherited entries to walk their ancestors once again; ordinary commits with unchanged tags do not invalidate them.

## Audit: remaining defects and limits

1. **Medium — inspection is not a sandbox.** Replayed user code can mutate refs, props, or objects inside cached slots. Slot-array copying does not isolate the reachable object graph. `useFiber` may temporarily patch global `Function.prototype.bind` for an initial capture; production mounts with an already-locked intrinsic remain a constraint.
2. **API/version mismatches.** The React peer range begins at 16.0, but hooks require at least 16.8. The `useFiber` version, attack, and fuzz matrices include 16.8.6, 16.12.0, 16.13.0, 16.14, 17, 18, 19, canary, and experimental. This is not exhaustive patch-version coverage. `Fiber` props are typed as objects despite real null/primitive values; generated work-tag numbers are not directly assignable to `Fiber.tag`. The async traversal overload also promises a Promise for a null fiber, although runtime returns null: `await` works, `.then()` does not.
3. **Coverage gaps.** Some older direct ports still disable type checking or hardcode development expectations. Existing React 19 compatibility skips remain visible. Istanbul currently changes standalone inspection stack names (`Component` becomes `renderFunction`), so those exact assertions do not pass under coverage instrumentation. They remain enabled in normal runs. Full reconciler, scheduler, DOM, hydration, streaming SSR, Flight, compiler, native, and feature-gate suites are not ported. Per-renderer/version checks do not establish the same coverage for every API.
4. **Setup gaps.** The combined suite can emit localhost:3000 connection-refused errors while passing and needs a hermetic network audit. Installation still reports Detox/expect and playground Vite/plugin peer mismatches. Broad dependency ranges need review on lockfile refresh. `publint` suggests declaring supported Node versions and reviewing side effects; blindly setting `sideEffects: false` would break hook installation.
5. **Export scope.** The runtime inventory covers `bippy` and `bippy/source`, and packaged checks exercise `bippy/install-hook-only`. Public `./dist/*` patterns expose additional implementation chunks; removing them requires a compatibility decision.

Next priorities are the API/version mismatches, unchecked ports, and broader runtime coverage. The audit was verified locally on Node 24; browser/Detox and CI's Node 22 runtime were not run locally.

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
- `getFiberHooks` and standalone `inspectHooks` on real React roots at 1/16/128 state hooks, custom-hook calls, or distinct generated state-call sites. Each custom hook contains state, memo, and ref primitives.
- Production `useFiber` mounts/updates across nine React fixtures, with/without-hook baselines, exact component/props identity checks, and render-count assertions.
- Fresh-process native Node imports of all three entrypoints; runtime bundle sizes, gzip sizes, and SHA-256 hashes.

Full runs write `benchmarks/results/latest.json` and `latest.md`; generated results are ignored by Git. JSON retains raw microbenchmark samples, calibrated iteration counts, min/median/max microseconds, `useFiber` summary medians, environment metadata, export accounting, and worker peak RSS. Workers run sequentially; synchronous operations do not pay an `await` per call. Preparation and result validation occur outside timing, allocation-heavy cases cap batch sizes, and a bounded result sink consumes return values. GC is not forced; yielding between batches lets WeakRef targets become collectible. Small measurements include harness overhead. Peak RSS includes fixtures, harness, and runtime, not just library allocations.

`bench:smoke` requires existing build output. CI runs it after the packaged checks to validate fixtures, measurements, and export accounting, not to enforce timing thresholds. Smoke mode uses one iteration/sample and a small React 19 `useFiber` configuration; its timings are not benchmark results. Harness unit tests cover async waiting, timing boundaries, cleanup, calibration caps, and coverage failures.

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

Paired production runs against the pre-optimization bundles from `35fe6a6`, using the same expanded fixtures on Node 24.20.0 / Apple M5 Max:

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

**Remaining boundaries:** React's [DevTools injection](https://github.com/facebook/react/blob/f1f7ed2ac267a21dd2e3e67c4a606b9cf56e360b/packages/react-reconciler/src/ReactFiberReconciler.js#L899-L904) exposes `getCurrentFiber` only in development. There is no guaranteed equivalent production hook in the reviewed renderer, so a first production capture with an already-locked `bind` remains unsupported. Throwing setters no longer interrupt hook order. Full SES lockdown was not tested. Future changes to reducer binding, memo storage, or Fiber topology still require compatibility testing; removing the external-store dependency does not make React internals a stable API. Queue correlation rejects unrelated bindings, but is not a security boundary against code that deliberately forges React's private objects.
