# Benchmarks

`pnpm --filter bippy bench:use-fiber` builds production ESM, loads it against isolated React versions, and compares mounts/updates with and without `useFiber`. It covers all nine React fixtures at 100/1,000 components with 0/32 preceding hooks. Add `--cjs` for CommonJS. It reports medians of five samples after warm-up, with five updates per sample. Timing is diagnostic, not a CI threshold.

One local Node 24.20.0/Happy DOM run, with 1,000 null-rendering components and no preceding hooks, measured these milliseconds per full update:

| React  | Before the `useFiber` optimization | After | After, without `useFiber` |
| ------ | ---------------------------------- | ----- | ------------------------- |
| 16.8.6 | 2.719                              | 0.262 | 0.130                     |
| 18     | 0.239                              | 0.210 | 0.116                     |
| 19     | 0.237                              | 0.195 | 0.142                     |

The meaningful change is removal of repeated root searches on ordinary early-React updates, which could make updating many `useFiber` components quadratic in tree size. Modern-React differences are small enough to treat as timing noise rather than a promised speedup. The capture record is also reused instead of allocating a replacement on every update. These are synthetic measurements, not browser/mobile guarantees.

`use-fiber-performance.test.ts` checks zero unrelated-subtree reads and exact rendering-Fiber identity across the version/build matrix. Other operation-count tests retain linear ancestor lookup and avoid unrelated current-fiber searches. `useFiber` still scans hook lists for its marker, and ambiguous early-React topology retains a full-tree fallback; it is not universally constant-time. Initial production captures still allocate a bind proxy. Updates do not patch `bind` or schedule passive effects. Published-entry checks also enforce the `"use no memo"` directive in the exported ESM/CJS function.

## Full public-export benchmarks

`pnpm --filter bippy bench` builds Bippy and benchmarks all **65 function/constructor exports** from `bippy` and `bippy/source`. Aliases are verified rather than presented as independent implementations. Data exports are inventoried, not timed as functions. Coverage checks reuse the canonical export reader and reject missing or invented exports.

The suite produces 708 microbenchmark rows (177 scenarios across ESM/CJS × development/production), 72 production `useFiber` configurations, and 12 cold-import measurements:

- Core helpers, wrapper cycles/depth, IDs, alternate reflection and root-search fallback; deep/wide trees up to 10,000 nodes; mounted/updated trees and Suspense simulated unmounts.
- Cold/warm work-tag caches, changed associations, live DOM host/renderer lookup, and synthetic Native-tag root searches.
- Hook installation, subscription churn, activation, renderer injection, commit/unmount/post-commit/schedule fan-out through 1,000 listeners, and throwing listeners with a stubbed reporter.
- Synthetic debug/owner/parent stacks, V8/Safari parsing, source-map lookup and decoding, indexed maps, symbolication, and hook names. Fetching uses in-memory responses; attempted default network requests fail the worker.
- `getFiberHooks` and standalone `inspectHooks` at 1/16/128 state hooks, custom-hook calls, or distinct state-call sites. The distinct fixture keeps all 128 call sites explicit in a typechecked TypeScript file rather than generating executable code with `new Function`. Each custom hook contains state, memo, and ref primitives. Live inspection roots are mounted only for their owning case and unmounted even after verification failures.
- Production `useFiber` mounts/updates across nine React fixtures, with/without-hook baselines, exact component/props identity checks, and render-count assertions.
- Fresh-process native Node imports of all three entrypoints; runtime bundle sizes, gzip sizes, and SHA-256 hashes.

Each run writes validated results incrementally to `packages/bippy/benchmarks/results/run-*/progress.jsonl`. Completed runs also write `report.json` and `report.md` there and replace `latest.json` / `latest.md` (or `smoke.*`). Interrupted runs retain their completed groups without replacing the last successful report. Generated results are ignored by Git. JSON retains raw microbenchmark samples, calibrated iteration counts, min/median/max microseconds, `useFiber` summary medians, environment metadata, export accounting, and worker peak RSS. Workers run sequentially; synchronous operations do not pay an `await` per call. Preparation and result validation occur outside timing, allocation-heavy cases cap batch sizes, and a bounded result sink consumes return values. GC is not forced; yielding between batches lets WeakRef targets become collectible. Small measurements include harness overhead. Peak RSS includes fixtures, harness, and runtime, not just library allocations.

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

## Source hot-path optimization

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
