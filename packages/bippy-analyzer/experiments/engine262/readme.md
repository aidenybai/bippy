# engine262 concrete backend experiment

The [class example](fixtures/class-lifecycle.tsx) mounts at `counter:0:private`, updates itself to `counter:1:private`, and reaches `counter:2:private` after a click. Its constructor, context, private field, updater callback, snapshot, update lifecycle, and unmount trace match native execution.

The [lazy/Suspense example](fixtures/lazy-suspense.tsx) loads a component at virtual time 5 ms and resolves its data at 10 ms. The fallback appears first. The suspended component's layout effect runs only after it commits:

```text
load
fallback:effect
module
data
content:layout
fallback:cleanup
content:cleanup
```

These behaviors use React's implementation, not a class or Suspense model. Application code runs in engine262. React's public library, reconciler, and host APIs run natively through an object boundary. The separate [production engine path](../../src/engine/readme.md) now runs React DOM inside the maintained engine. The default symbolic backend has not changed.

## Source fork and engine-owned React

The experiment now imports the maintained [engine source fork](../../engine/readme.md), not the installed package implementation. The pinned package remains a regression reference. The 163 existing experiment tests pass against the fork, alongside 15 pinned-engine/native comparisons.

A separate `reconciler-probe.ts` bundles React 19.3.0, `react-reconciler` 0.34.0, the application, and a mutation-mode host renderer into the engine realm. Its 12 native-backed tests pass, covering updates, lifecycles, effects, Suspense, transitions, refs, and errors. This runs actual React inside the engine; it is not React DOM and does not replace the browser probe below. Both paths remain concrete-only.

The fork now lowers its evaluators into an explicit control machine and implements strict tail-continuation replacement. Its targeted tail-call tests pass. The raw fork's Test262 baseline remains red because SharedArrayBuffer is missing. The runner now executes async tests and JavaScript modules; its broader module selection still reports unsupported loading features. See the fork report for the current inventory and exclusions.

## Run a component

From the repository root:

```sh
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer run render:engine262 \
  experiments/engine262/fixtures/class-lifecycle.tsx \
  '{}' '[{"selector":"button","type":"click"}]'
```

Paths are relative to `packages/bippy-analyzer`. Optional arguments supply scalar props and click/input actions. Output includes ordered host trees, application traces, handled React errors, unhandled errors, pending controlled work, and execution counters. Errors, unsupported operations, and pending controlled work produce a nonzero exit status.

The [browser example](fixtures/browser-platform.tsx) covers live DOM identity, storage, structured cloning, binary data, a mutation observer, cancelled and delayed timers, animation frames, and a fetch response supplied through `runProbe({ responses })`. Network access is disabled by default. This is a configured Happy DOM environment, not a browser automation runner.

## Corpus results

After source-fork integration and the declared Web Crypto checkpoint policy, both seeds attempted **all 585 component source files** under `tests/components`. There are no source-text environment exclusions. Native execution runs first; engine execution is skipped when the native oracle fails or reaches an unsupported operation. Each seed therefore ran 585 native cases and 579 engine cases. The same **579 fixtures matched at both seeds**.

| Outcome                                     | Seed `1` | Seed `2147483648` |
| ------------------------------------------- | -------: | ----------------: |
| Matched                                     |      579 |               579 |
| Successful runs with different observations |        0 |                 0 |
| Engine execution errors                     |        0 |                 0 |
| Unsupported backend or harness operations   |        1 |                 1 |
| Native oracle failures                      |        5 |                 5 |
| Incomplete controlled queues                |        0 |                 0 |
| Excluded before execution                   |        0 |                 0 |

A match requires equal ordered host trees, exported application traces, interaction outcomes, and handled React errors, with no unhandled errors or pending controlled work. Caught error-boundary failures are observations, not automatic oracle failures. The corpus uses empty scalar root props and no event actions; dedicated tests cover selected interactions.

The six original engine-error fixtures now match: `compiled-uncontrolled.js`, `element-type-statics.tsx`, `string-substr.tsx`, `intl-locales.tsx`, `i18next-library.tsx`, and `lingui.tsx`.

The remaining cases stay in the denominator:

- `pure-packages.tsx` imports `fs`, outside the native module allowlist.
- `compiled-library-interop.js` fails its styled-components namespace assumption in the native bundle.
- `import-glob.tsx` needs Vite's `import.meta.glob` transform.
- `linaria.tsx` and `stylex.tsx` require their build-time transforms.
- `hoistables.tsx` fails in native React's resource-loading path under the offline host policy.

```sh
pnpm --filter bippy-analyzer run corpus:engine262
ENGINE262_CORPUS_SEED=2147483648 pnpm --filter bippy-analyzer run corpus:engine262
```

Each case/backend runs in a fresh process. The runner uses four concurrent cases, a 15-second worker timeout, a 384 MiB V8 heap limit, and V8 serialization to preserve NaN, signed zero, and BigInt. An optional numeric argument limits attempted cases. Worker failures and limits never count as matches.

## One boundary instead of hook adapters

The shared runtime files now live under `src/engine/`. `membrane.ts` maps objects, functions, and symbols between the two runtimes. It caches identity and forwards calls, construction, receivers, exceptions, descriptors, prototypes, enumeration, mutation, and integrity operations. Shadow targets satisfy Proxy invariants for arrays, functions, and frozen objects. Application-created objects remain engine-owned; host-created objects remain host-owned.

Native React can therefore construct an engine class, call its methods, apply updates, invoke refs, and subscribe to an engine thenable. Callback reentry restores engine262's active agent. Application throws survive the round trip and remain catchable. There is no handwritten hook dispatcher or separate class lifecycle implementation.

`react-bridge.ts` loads React, JSX runtimes, compiler runtime, and React DOM through the reconciler's existing module loader. It checks module identity: independently loading another React copy caused null-dispatcher failures. Supported Node modules are explicitly allowlisted; application dependencies otherwise bundle with esbuild.

`engine-runtime.ts` owns the realm, quotas, jobs, and completion conversion. In component probes, each engine Promise job enters the native microtask queue separately. The earlier controlled-only queue delayed Suspense retries and added fallback commits. Low-level runtime tests can still drain jobs explicitly.

## Host behavior and engine fixes

- **Browser state:** each run gets a fresh Happy DOM window, document, storage, and event environment. DOM methods and callbacks use the same object boundary rather than a list of facade fields.
- **Time:** `virtual-clock.ts` orders callback timers by deadline and registration order, preserves cancellation, supports intervals, and advances `Date.now()` and `performance.now()`. Animation frames use a declared 16 ms grid. These are harness semantics, not a browser scheduling oracle.
- **Inputs:** application `Math.random`, `crypto.randomUUID`, and `crypto.getRandomValues` use declared seeded streams. The seeded crypto inputs are **not cryptographically secure**. Other Web Crypto operations use the host implementation.
- **Network:** fetch can use supplied responses. Unconfigured requests fail; synchronous requests and WebSocket connections are disabled. Script evaluation and external resource loading are disabled. A resource-event workaround releases stylesheet waiters; the hoistable fixture still exposes a native-oracle failure.
- **Intrinsics:** `compatibility.ts` supplies host Intl, binary-memory types, localized prototype methods, and missing legacy String/Object methods. `intrinsic-bridge.ts` dispatches branded methods on host-owned receivers without unwrapping application-created Proxies. `structured-clone.ts` snapshots supported engine graphs before native cloning, preserving tested cycles, aliases, sparse arrays, getters, and ArrayBuffer transfers.
- **Regex:** the pinned dependency has a local patch for non-Unicode identity escapes and literal braces/brackets, including the distinction between literal braces and valid quantifiers. Native-backed tests also check Unicode-mode rejection. Both package entry points carry the patch; stale generated source-map references are removed. This is not a complete Annex B or Test262 compatibility claim.

`host-operations.ts` tracks calls made through the configured `crypto.subtle` methods. Each browser-probe `act` callback waits for registered Web Crypto work and a native microtask checkpoint before returning. Without that declared policy, `autosave-indicator.tsx` intermittently added a commit when the digest completed across an `act` boundary: the first fork sweep had 578 matches and one mismatch. Eight fresh-process repeats per backend matched after the change; the original mismatch remains recorded. This batching policy is not browser scheduling semantics, does not fix arbitrary host races, and does not track calls that bypass the configured methods.

The native oracle executes application code with V8 and the same native React library. It shares the DOM implementation, virtual clock, network policy, mounting, and snapshot projection with engine262. Agreement checks application execution under that environment; it does not independently validate the environment itself.

## Limits and validation

The experiment remains concrete-only. Seeded runs do not supply unknown-input branches, heap joins, or combined input-to-outcome associations. No Bippy known-defect assertion was promoted by this work.

The original **163 experiment tests** cover native-backed rendering, class/private-field lifecycles, lazy/Suspense cleanup, browser interactions, all six original engine failures, object-boundary operations and throws, regex modes, cloning, timers, job order, disposal, and quotas. The expanded engine suite passes **352 tests**, including low-level control-checkpoint and Test262-runner regressions. The latest full repository run passes **26,071 tests**, with two skipped, across 559 passing files and two skipped files. Repository typechecking passes. This is not a new coverage or strict compatibility run.

The browser probe retains limits of two million evaluated AST nodes, 512 engine Promise jobs, the existing mount/task limits, and a 500 KB application bundle cap. The engine-owned reconciler probe permits ten million nodes and 512 settling rounds; its bundle includes React itself and has no 500 KB cap. Native intrinsic work and allocations are not all covered by the node quota. Neither engine262 nor this boundary is a security sandbox; run only trusted fixtures in the provided workers.

Full browser behavior, hydration, intrinsic-prototype mutation across runtimes, arbitrary cross-realm reflection, source ownership/debug stacks, every structured-clone type and transferable, and exhaustive asynchronous histories remain unproven. Pending-work diagnostics describe controlled work, not every possible future host operation. Happy DOM's missing APIs remain missing; a shared-harness match does not turn them into browser support.

## Cost

Before the source fork and Web Crypto checkpoint change, on macOS arm64, Node **22.23.2**, React **19.3.0**, the original eight warmed probes took approximately **39–48 ms in engine262**, **13–14 ms natively**, and **11–21 ms in Bippy**. Whole-worker peak RSS is approximately **320 MiB, 197 MiB, and 289 MiB**, respectively.

Measurements use one warmup and three fresh runs per case, separate backend processes, and no concurrent corpus or test workers. They include bundling, fresh environment/realm preparation, mounting, and settling. RSS is a process peak, not retained interpreter heap. These small probes do not establish application-scale performance, and Bippy performs different analysis work.

```sh
pnpm --filter bippy-analyzer run experiment:engine262
```

## Upstream

The maintained fork vendors engine262 at `f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a`, under its [MIT license](../../licenses/engine262-mit.txt). The exact patched npm dependency remains a comparison baseline. See the [fork provenance and local changes](../../engine/readme.md#source-and-licenses). React and Happy DOM are reused as installed packages. React's actual reconciler source informed the host integration. See [third-party notices](../../third-party-notices.md).
