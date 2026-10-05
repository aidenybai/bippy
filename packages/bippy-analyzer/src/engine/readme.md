# The analyzer's engine execution path

`StaticRenderer` can execute a component or entry module through the maintained engine. Application code, React, React DOM, and the existing fiber snapshot recorder run inside the same engine realm. Native code supplies the browser boundary, not component proxies or hook models.

```ts
import { StaticRenderer, objectFromRecord } from "bippy-analyzer";

const renderer = new StaticRenderer({
  rootDirectory: process.cwd(),
  execution: "engine",
});
const result = await renderer.renderComponent("src/app.tsx", {
  props: objectFromRecord({}),
});
console.log(result.engine?.status, result.snapshot, result.diagnostics);
```

The CLI exposes the same path with `render --engine <projectRoot> <entryFile> [exportName]`. It prints execution evidence and exits unsuccessfully for failed, incomplete, or unsupported engine results. Legacy package-model flags cannot be combined with `--engine`.

`renderEntry` executes the entry module rather than extracting a render expression. The loader wraps the project's `createRoot` and `hydrateRoot` exports to register their returned roots for cleanup; it forwards their arguments without replacing their implementations. Hydration is not yet an acceptance gate.

This is **production API integration, not a completed full port**. The default remains `execution: "interpreter"` because guarded state and framework contracts have not moved over. Selecting `engine` never falls back to that interpreter, native application execution, or assignment replay. An `unsupported` result is not a completed analysis.

## What moved

- `StaticRenderer.renderComponent` and `renderEntry` dispatch directly to `render-application.ts`.
- `bundle-application.ts` uses the renderer's project resolver, aliases, source cache, JSON modules, and registered source transforms, including raw/inline asset queries. Application dependencies are bundled from source, not substituted with modeled libraries. External native modules are rejected.
- The runtime, membrane, browser platform, timers, intrinsic adapters, structured cloning, and host-operation tracker now live here. Experiments import this implementation; production imports no experiment modules.
- React, React DOM's real client constructor, and the renderer host are checked for engine ownership. The observer records the same `RuntimeSnapshot` shape used by the existing analyzer, including component fibers and ordered commits.
- Every run gets fresh evaluated modules, globals, browser state, roots, and jobs. Concrete prop graphs preserve aliases and cycles. Cleanup runs before disposal and cleanup errors remain diagnostics.

## Bounds and host policy

The browser is offline Happy DOM with a private document. Virtual time starts at the existing fixed epoch; timers advance by deadline, animation frames use the declared 16 ms grid, and the production route uses random seed 1. Native Intl, binary-memory operations, selected compatibility intrinsics, DOM APIs, and Web Crypto cross the membrane. This is not a browser implementation or a security sandbox.

The default node budget is 10 million, including engine-owned React and observation work; `maxSteps` overrides it. The runtime limits engine jobs to 512, and settling limits controlled tasks to 512 rounds. Registered Web Crypto work settles before the next checkpoint. These bounds are not a process deadline or total-memory limit; the corpus supplies separate worker limits.

`result.engine.status` distinguishes `complete`, `failed`, `incomplete`, and `unsupported`. Typed budget errors prevent an application throwing a similarly worded message from impersonating quota exhaustion. Evidence records the application-bundle hash; metrics report nodes, calls, jobs, and checked engine-owned functions. They are not retained-heap measurements.

## Contracts still to port

Unknown values, branches, input spreads/accessors/descriptors, custom prototypes, and integrity metadata are rejected rather than concretized. Caller declarations—not TypeScript annotations—must eventually supply abstract domains. The low-level control checkpoint alone does not own a complete heap, native capture graph, or job queue.

Interpreter preparation, `renderWith`, isolated unknown providers, framework React substitutions, Vite environment declarations, server components, document-root rendering, bootstrap callbacks, partial globals, observed state, external-value providers, pinned decisions, legacy depth/fiber limits, and legacy settling overrides are not yet ported. Unsupported options are checked before application execution. The source cache may run configured build transforms during preparation.

The bundling profile is not a proof of original-module equivalence. In particular, the first full corpus sweep exposed a difference in V8's optional legacy `arguments`/`caller` properties on sloppy functions; that mismatch remains visible. No strict-mode rewrite was added just to hide it.

## Validation

```sh
pnpm --filter bippy-analyzer test tests/engine-renderer.test.ts
pnpm --filter bippy-analyzer corpus:engine > report.json 2> progress.jsonl
```

Seventeen integration tests cover hooks, private class fields, context/reducers, Suspense, real DOM events, timers, errors and cleanup, entry roots, aliases/JSON/defines/assets, prop graph identity, fresh runs, engine limits, and refusal without fallback. A native V8 witness compares every committed fiber tree.

The verified production-path corpus run attempted all 585 files: **570 matched**, **one mismatched**, **nine were unsupported**, and **five had native-oracle errors**. There were no engine/harness errors, incomplete cases, or excluded files. Native and engine application-bundle hashes must agree before observations are compared. The earlier 569-match run exposed the now-repaired raw/inline asset loading gap.

The mismatch is `object-protocol.tsx`'s legacy function properties. Seven unsupported fixtures import `node:events`, one imports `fs`, and `es-shims.tsx` reaches an ignored browser mapping the resolver has not ported. Oracle failures remain styled-components interop, import-glob transformation, Linaria/Stylex compilation, and offline hoistable resources. The gate remains red.

The latest full repository run passes **26,071 tests**, with two skipped, across 559 passing files and two skipped files. Types and checks pass (zero errors, 65 existing warnings). This is not a new strict-compatibility or coverage result.

The oracle runs the same project bundle and React DOM in native V8, with fresh workers and the same offline browser/settling policy. Comparison includes every committed fiber tree except capture timestamps, with empty concrete props and no external actions. Shared bundling, browser policy, and snapshot code constrain what matching proves. This run does not compare exported traces or establish symbolic execution, exhaustive React compatibility, or production-cutover readiness.
