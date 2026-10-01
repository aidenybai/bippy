# Concrete execution

`createConcreteRuntime()` executes scripts and supplied JavaScript modules through the verified source-built engine262. It does not perform symbolic evaluation. Each runtime has its own agent, realm, module cache, and job queues.

The host contract is `engine262-concrete-zero-delay-host-v1`. It is a restricted task host, not a browser or Node environment.

## Scripts and observations

Build the engine before importing the package. Use Node 26 or later.

```ts
import { createConcreteRuntime } from "bippy-analyzer";

const runtime = await createConcreteRuntime();
try {
  runtime.evaluate(`
    let count = 0;
    setTimeout(() => { count += 1; }, 0);
  `);
  runtime.drainJobs();
  console.log(runtime.readString("String(count)"));
} finally {
  runtime.dispose();
}
```

`evaluate(source, specifier?)` returns an engine-owned value. Do not transfer these values between runtimes. `readString(source)` executes another script and requires a string result. These methods execute code. They are not passive snapshot readers and can invoke getters or change state.

The runtime restores the previous surrounding agent after each operation, including failures. Ordinary guest exceptions remain `ConcreteGuestError` objects with their original engine value in `.value`. `toJSON()` returns diagnostic strings and the engine value tag, without traversing the guest heap or invoking guest getters. The message and guest stack use engine262's cached creation-time diagnostics when available. Later changes to a guest error's properties do not update those cached strings. Raw values are no longer attached as `.cause`, which caused diagnostic formatters to traverse realm and syntax graphs. Host failures and exhausted budgets prevent further execution in that runtime.

`dispose()` prevents further execution and cancels pending timer handles. Cancellation and disposal release those timers' [declared callback/argument roots](host-job-roots.md). Explicit microtasks also declare their callback roots. This does not establish complete Promise, diagnostic-value, or external-driver GC coverage. It does not execute application cleanup, flush jobs, or unmount React. Perform those operations explicitly before disposal. No native timers, network requests, or filesystem handles belong to this runtime.

## Executable module artifacts

Supply native-built JavaScript chunks with their exact canonical URLs. The runtime does not read those URLs from the network or filesystem.

```ts
const runtime = await createConcreteRuntime({
  modules: [
    {
      specifier: "https://application.invalid/entry.js",
      source: "export const value = 42;",
    },
  ],
});
try {
  runtime.evaluate(`
    import("https://application.invalid/entry.js").then(module => {
      globalThis.result = String(module.value);
    });
  `);
  runtime.drainJobs();
  console.log(runtime.readString("result"));
} finally {
  runtime.dispose();
}
```

The module host supports:

- Supplied JavaScript modules with `file:`, `http:`, or `https:` URLs.
- Relative URL requests when the importing module or script has an explicit referrer URL.
- Engine-owned parsing, linking, namespaces, live bindings, cycles, caching, dynamic imports, and top-level await.
- `import.meta.url` containing the supplied module URL.

Sources and budgets are copied before asynchronous engine loading. Duplicate or noncanonical artifact URLs reject the request. Missing artifacts, bare package imports, and import attributes fail rather than trigger guessed resolution or fetching. Engine-generated import errors retain their original values.

URL identity does not include filesystem realpath resolution. Supply physical file URLs when comparing against Node's default filesystem loader. Different supplied URLs remain different module identities. Native build configuration, asset closure, source-map remapping, and the separate resolver integration remain unfinished. Standalone CommonJS loading is unsupported. The React fixtures use actual CommonJS dependencies converted by the native bundler, not an analyzer `require` implementation.

## Task host

engine262 owns Promise jobs, async/await, microtask checkpoints, and task ordering through its existing event loop. The adapter registers callbacks and invokes them with engine262's `Call` operation.

The additional globals are:

- `global`, an alias for `globalThis`.
- `setTimeout(callback, delay?, ...arguments)`, with callable callbacks and numeric zero or omitted delays only. Handles are numbers. Callbacks receive an undefined receiver, subject to JavaScript's normal `this` binding rules.
- `clearTimeout(handle?)`, accepting numeric handles or undefined. Unknown numeric handles have no effect.
- `queueMicrotask(callback)`, accepting callable callbacks.
- `console.log`, `console.info`, `console.warn`, and `console.error`, recording engine values by reference without invoking getters or coercing objects. These records are not deep snapshots.

Positive delays, coercible nonnumeric delays, string callbacks, and nonnumeric timer handles are unsupported. These are explicit restrictions, not HTML timer or Node timer parity. There is no DOM, `window`, `fetch`, `process`, `require`, `MessageChannel`, or `setImmediate` implementation. Clocks and randomness retain engine262's defaults.

`drainJobs()` runs ready jobs. It reports uncaught task exceptions and unhandled Promise rejections while preserving their values in `uncaughtExceptions` and `unhandledRejections`. A rejection handled before the checkpoint leaves the rejection set.

**An empty ready queue does not prove completion.** A Promise or top-level await can remain unresolved without a queued job. The runtime does not return a settled-render or complete-analysis report.

## Limits

Defaults are 2,000,000 evaluated syntax nodes and 512 registered jobs per runtime. Canceled timers still consume their registration budget. Promise jobs, explicit microtasks, and timer tasks count toward the job budget. Limits are positive safe integers and apply across all scripts and drains in that runtime.

These limits do not bound parsing, source size, allocations, recursion, elapsed time, or one expensive intrinsic operation. There is no process sandbox, cancellation API, or deadline. Do not treat this API as safe execution of untrusted programs.

## React evidence

`tests/concrete-react.test.ts` builds a TSX fixture, actual React 19.3.0, its JSX runtime, and React Test Renderer 19.3.0 through Vite 8.2.2, supplied by the existing locked Vite+ toolchain. React implements hooks, reconciliation, effects, and lifecycle behavior inside engine262. No analyzer hook implementation or custom renderer configuration is used.

Nine scenarios compare complete serialized renderer trees and lifecycle traces with a separate V8 execution of the same native bundle:

1. Counter initialization, batched functional updates, prop changes, and cleanup.
2. Context, reducers, memoization, ref identity, and insertion effects.
3. Keyed state preservation, reordering, and removal.
4. Class lifecycle methods and a caught rendering error.
5. Promise and zero-delay timer updates from an effect.
6. Render-phase state updates.
7. External-store subscriptions, updates, and cleanup.
8. Transitions.
9. Development Strict Mode effect replay and cleanup.

The native fixture configuration selects production or development JSX to match the React build. A rejected configuration mixed production React with development JSX calls. Both engines failed to render it. A separate negative test retains that configuration and requires the error record alongside the empty tree.

The V8 reference has its own FIFO timer driver. Its microtask shim uses native Promises. These tests do not establish equivalence for uncaught microtask exceptions or real browser scheduling. Exception names and messages are compared for the error boundary, not engine-specific stack text. Console records remain available. Tests verify that React entry functions, hooks, the JSX runtime, renderer creation, and the component are engine-owned ECMAScript functions.

`tests/concrete-modules.test.ts` also executes all three native-built ES module chunks through engine262 and an independent Node subprocess. It compares initial values, updates, dynamic imports, singleton identity, top-level await, and exact `import.meta.url` values. The native re-export-only lazy chunk has no source map. The test retains that output instead of inventing a map.

The first Node comparison exposed a `/var` versus `/private/var` URL mismatch. The fixture now supplies physical file URLs to both executions. The runtime does not normalize away that difference or change Node's symlink policy.

React Test Renderer is React's deprecated test renderer, not React DOM. These checks establish selected concrete execution behavior only.

## React DOM counter

`tests/concrete-react-dom.test.ts` executes React DOM 19.3.0 with LinkeDOM 0.18.12's worker build inside engine262. DOM constructors, document methods, event dispatch, React hooks, and component code remain guest-owned JavaScript. The analyzer does not forward DOM operations to native objects.

Production and development builds compare nine observations with independent V8 and Chromium executions. The sequence mounts the counter, increments, selects step five, increments again, resets, decrements, hides, shows, and unmounts. Reset changes the count, not the selected step. Development uses Strict Mode. Tests compare complete container HTML and lifecycle traces, require an initially rendered counter, and check counts zero, six, and minus five.

Chromium executes the same component without LinkeDOM. Its driver uses the fixture's declared document and URL, blocks other requests, and dispatches the same programmatic bubbling click events. It waits for an application effect checkpoint after each render, not for output to match the engine. Unmount uses React's synchronous root cleanup. The local reference is Chromium 153.0.8010.12 through pinned Playwright 1.63.0. CI installs Playwright's matching browser.

The guest setup declares fixed `href` and `protocol` data for `https://fixture.invalid/`. That data is not a Location implementation. LinkeDOM's navigator and event behavior are library behavior, not a full browser model. These checks do not cover trusted pointer events, default actions, layout, navigation, live collections, or browser task-source ordering. LinkeDOM deliberately simplifies parts of the DOM and event model.

Initial document parsing failed because pinned engine262 omitted Annex B `String.prototype.substr`. The maintained engine patch delegates coercion and index conversion to existing engine operations. All 30 selected Test262 variants pass, compared with zero on the published engine. A separate 972-case scalar/UTF-16 matrix and six metadata/coercion checks match V8. See the [intrinsic receipts](engine-substr-validation/summary.json).

The first development setup also lacked location data. Both engines rejected it. The final fixture declares that input and records React's development `console.info` output. The original setup failures and formatter out-of-memory report remain in [DOM validation records](guest-dom-validation/).

General browser integration, portals, lazy/Suspense rendering, broader scheduling behavior, mutable symbolic state, and symbolic React remain unfinished. The counter is a test fixture, not a public browser-host API or a replacement for the separate application-loader integration.
