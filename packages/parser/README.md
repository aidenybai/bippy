# @bippy/parser

Static reconstruction of React fiber trees from source ASTs. The parser reads a project with
`oxc-parser`, links its modules with `oxc-resolver`, and abstractly evaluates component bodies
without executing the application. The evaluated element values are then materialized into real
React elements whose component types are thin proxies back into the interpreter, rendered with
`react-dom` in happy-dom, and captured through Bippy — so the output is a real committed fiber
tree, built by React's own reconciler. A harness captures the application's actual tree the same
way (in-process, or in a browser against a dev server) and compares the two fiber trees directly.

Anything the source does not decide statically — data from the network, router state, third-party
component internals — is kept as explicit uncertainty: marker components (`$Branch`, `$Repeat`,
`$Opaque`, `$Unknown`, `$Text`) sit in the materialized tree at the position of the uncertainty
rather than being guessed. Exactness against runtime is only expected where the source fully
determines the tree.

## Run

```sh
pnpm --filter @bippy/parser typecheck
pnpm --filter @bippy/parser test
pnpm --filter @bippy/parser render <projectRoot> <entryFile> [exportName]
pnpm --filter @bippy/parser corpus -- [ids...] [--static-only] [--skip-install] [--list]
pnpm --filter @bippy/parser exec tsx scripts/capture.ts <url> [snapshot.json]
```

`render` prints the static tree for an SPA entry (`createRoot().render`, `hydrateRoot`,
`ReactDOM.render`) or a named component export. `corpus` clones the pinned repositories into the
ignored `.corpus/` directory, renders each statically, optionally starts its dev server, captures
the live tree with Playwright, and merges results into `corpus/results.json`. `--static-only`
replays the capture saved by the last live run (`.corpus/.out/<id>.capture.json`) when one exists,
so evaluator changes are re-verified against the same runtime tree without a dev server.

## Pipeline

```
source files ──oxc-parser──▶ ModuleRecord (imports/exports/bindings, cached by mtime+size)
                                   │
                                   ▼  oxc-resolver (tsconfig paths, conditions, workspaces)
                             ModuleGraph: resolves an exported name through re-exports,
                             `export *`, barrels and cycles to its declaring module, or to
                             an opaque external package
                                   │
                                   ▼
                             Interpreter: abstract evaluation of expressions/statements over
                             StaticValue, returning every reachable `return` as a branch
                                   │
                                   ▼
                             Materializer: StaticValue ─▶ React elements; source components
                             become proxies that call the interpreter from inside React's
                             render, uncertainty becomes marker components
                                   │
                                   ▼  react-dom + happy-dom, captured with bippy
                             RuntimeSnapshot (real fibers) ─▶ pattern ─▶ compare against the
                             application's RuntimeSnapshot
```

### Parse (`src/parse`)

`parseSourceText` wraps `oxc-parser` for `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`; declaration
files are excluded. Diagnostics and `SourceLocation`s are preserved on every value and fiber.
`SourceFileCache` invalidates on file metadata.

### Module graph (`src/graph`)

`ModuleResolver` classifies a specifier as `internal`, `external` (package name + resolved path),
`builtin`, or `unresolved`. Package specifiers that resolve outside `rootDirectory` (pnpm workspace
symlinks) are external even when not under `node_modules`. `ModuleGraph` records each module's
imports, exports and top-level bindings, and resolves `(module, exportName)` across explicit
re-exports, `export *` chains, barrels and cycles; ambiguous or missing exports are reported, not
collapsed. External packages are opaque unless `resolveExternalPackages`/
`externalPackageAllowList` opts them in, or a framework adapter models them.

### Evaluation (`src/evaluate`)

`Interpreter` evaluates over `StaticValue`:

| kind                                                                           | meaning                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `primitive`, `list`, `object`, `function`, `class`, `element`, `component-ref` | statically known                                                                                    |
| `branch`                                                                       | one of several alternatives (conditionals, `&&`/`??`, early returns, fallthrough)                   |
| `unknown-primitive`                                                            | a string/number of unknown content (dynamic text)                                                   |
| `external`                                                                     | a value from an opaque package; `derived: true` once accessed/called, making its truthiness unknown |
| `unknown`                                                                      | anything else, with a reason                                                                        |

Supported: lexical scoping and imported/exported bindings, literals, templates, arrays, objects,
spreads, members, calls, operators, conditionals, assignments, raw JSX and compiled
`jsx`/`jsxs`/`jsxDEV`/`createElement`, `props.children`, bounded `.map/.filter/.flatMap` and
imperative loops (`loops.ts`), hooks (`react-calls.ts`: `useState`/`useReducer` initial values
branched with an unknown post-update state, `useContext`/`use(context)` through the nearest
provider, `useMemo`/`useCallback`/`useRef`/`useDeferredValue`, `useSyncExternalStore` server
snapshots, `useId` as unknown text, effects as no-ops), class components
(`class-component.ts`: fields, constructors, inheritance, `this.props`/`this.state`, `render`;
`setState`/`forceUpdate` leave state unknown), `Object.assign` component patterns, and `await` in
server/awaited contexts. Budgets bound call depth, per-component recursion, branch fan-out, steps,
component depth and fiber count; exhaustion produces an `unknown` node, never a truncated-but-
confident tree.

JSX text follows React's whitespace rules and the same entity table as esbuild/swc/oxc.

### Materialization (`src/materialize`)

`Materializer` turns the interpreter's `StaticValue`s into React elements and `mountNode` renders
them with the project's own `react`/`react-dom` (resolved through the module graph, so versions
match the application). Nothing from the application runs: every source-defined function or class
component becomes a proxy component of the same name whose render calls
`Interpreter.callFunction` on the source body; `memo`, `forwardRef`, `lazy`, contexts, `Fragment`,
`StrictMode`, `Profiler`, `Suspense`, portals and host elements map to the real React APIs, so
work tags, `shouldSetTextContent`, hoistables/singletons, memo bailouts and error boundaries are
React's, not a reimplementation. Proxy identity is the source closure (node + scope), so a HOC
applied twice yields two component types, as at runtime. Hooks run against a per-proxy
`HookFrame`: `useState`/`useReducer` setters called from effects re-render the proxy through real
React state, so the committed tree reflects settled post-effect state where the source determines
it.

Uncertainty is materialized as marker components (`markers.ts`): `$Branch`/`$Alternative` for
unresolved conditionals (with a preferred alternative), `$Repeat` for lists of unknown length,
`$Opaque` for unmodeled externals (their passed children are rendered inside), `$Unknown` for
anything else, `$Text` for dynamic text. Markers are ordinary fibers in the captured tree, so
uncertainty is positional and the same snapshot type describes both sides of a comparison.

With `serverComponents: true` (`next-app`), modules without `"use client"` are evaluated as
Server Components: their function components render without a fiber boundary (as the Flight
client would see them), async bodies are awaited, and client modules keep normal fibers. Classes
are treated as client components.

### Frameworks (`src/frameworks`)

`renderFramework` renders a `{ framework, entry?, route? }` target:

- `spa` — the entry module's root render call (nested blocks and callbacks included).
- `next-app` — `app/` route matching, layout/template/page/loading composition, async server
  components, client boundaries, metadata; Next-specific externals in `next-externals.ts`.
- `next-pages` — `pages/` matching and `_app` composition.
- `react-router` — data/framework mode: route config objects, `lazy` routes (evaluated through an
  explicit awaited call), `HydratedRouter`/`RouterProvider` bootstrap, root `Layout`/`App`,
  `Meta`/`Links`/`ScrollRestoration` document output (`react-router-document.ts`, honoring
  `react-router.config.ts` `ssr`), and `react-router-auto-routes` file conventions
  (`react-router-auto-routes.ts`).

Each framework has a `FrameworkProfile` naming the runtime wrapper fibers that are transparent
during comparison (router contexts, error boundaries, dev overlays) and the runtime-injected
fibers to drop (Next outlet boundaries, announcers, `script-N` hoistables). Profiles only name
framework internals; application mismatches are never hidden this way.

### Harness (`src/harness`)

- `createCommitRecorder`/`snapshotFiberTree` capture roots through Bippy's instrumentation and
  serialize `RuntimeSnapshot`s (React version, renderer, build type, per-fiber tag/name/key/text
  and safe prop summaries). In-process fixtures render with `react-dom` in happy-dom; roots are
  isolated per fixture and React 19 resource/preload fibers are allowed to settle.
- `BrowserCapturer` bundles `browser-inject.ts` with esbuild and installs it via Playwright
  `addInitScript` before any application script, so live dev servers are captured unchanged.
  Alongside fibers it records `RuntimeObservations` (`observations.ts`): globals, query-cache
  entries, Redux/Kea store state, Lingui catalogs, router location and the identity of exported
  values (`module-exports.ts`). A saved capture replays with `--static-only`, and the static render
  takes the observations as inputs so dynamic data the page actually had is not guessed.
- `compareStaticToRuntime` reads the materialized fiber tree back into a pattern (`static-pattern.ts`:
  marker fibers become branch/repeat/opaque/wildcard nodes, everything else is a concrete fiber)
  and matches it against the runtime tree: hierarchy, tags, names, keys, host elements, text.
  A marker-free tree is a plain fiber-by-fiber diff. Branches try each alternative;
  repeats absorb any count; `opaque` subtrees match one runtime subtree (by name, or an anonymous /
  bundler-placeholder name such as esbuild's `_a2`) and slot their passed children back in;
  `unknown` is a wildcard. The report carries a tally (matched, absorbed,
  opaque, unknown), coverage, and the first divergence path with source location.

Statuses: `exact` (all static fibers matched, no uncertainty consumed), `partial` (matched, but
branches, repeats, opaque subtrees or wildcards were needed), `mismatch` (a divergence),
`unresolved` (the static side did not produce a component tree), `skipped` (no runtime root or
anchor). The harness chooses the runtime root by explicit index, then anchor search, then the
largest root.

## Corpus

`corpus/manifest.json` pins 23 real repositories by revision with framework, install/setup/dev
commands, URL, static target and notes; `corpus/results.json` holds the latest merged results.
Clones and captures live under the ignored `.corpus/`. Every entry renders statically; runtime
capture runs where a dev server can start in this environment.

Live-verified so far: `react-router-templates`, `sonner`, `documenso`, `sentry`, `posthog`
(exact); `nextjs-examples` (partial at 100% strict coverage — every runtime fiber is matched
by a concrete static fiber, but branches or repeats were consumed); `cal-diy`,
`bulletproof-react`, `puck`, `redux-toolkit`, `lexical`, `tanstack-query`, `graphiql`,
`react-admin`, `tanstack-router` (partial — opaque third-party providers or dynamic data cut
the static tree short). `corpus/scripts/` holds the setup used for the heavy entries: a
throwaway Postgres (`postgres.sh`) with seeded databases for `cal-diy` and `documenso`, a
Node-version wrapper (`with-node.sh`), and a stand-in for PostHog's Django boot page
(`posthog-app-server.ts`) that serves the globals, preflight and API responses Vite alone does
not provide. Results are recorded as they are; profiles and normalization are only widened when
the difference is demonstrably framework machinery.

## Limitations

- Dynamic data (fetches, loaders, query caches, stores) is unknown; lists over it are `repeat`
  nodes and their contents are opaque to comparison.
- Third-party components are opaque unless modeled. `react-admin`'s `<Admin>` and TanStack
  Router's `<RouterProvider>` end the static tree.
- Refs, event handlers and anything behind a user interaction are not simulated; only effects that
  the source fully determines (synchronous `setState` in `useEffect`/`useLayoutEffect`) update the
  tree.
- `use(promise)`, custom hooks over external stores and state set from unknown values is unknown.
- Framework profiles are observed against specific versions (Next 14–16, react-router 7/8); other versions may introduce wrapper names that show up as mismatches.
- Runtime capture depends on the dev server starting; failures are recorded per entry.

## Layout

```
src/parse        oxc parsing, cache, source locations
src/graph        resolver, module records, module graph
src/evaluate     interpreter, values, scopes, loops, hooks/React calls, class components, JSX text
src/react        element-type resolution, React API recognition
src/materialize  StaticValue -> React elements, proxy components, markers, react-dom mount
src/render       StaticRenderer, root render discovery
src/frameworks   framework adapters, profiles, stubs
src/harness      runtime capture, snapshots, pattern matching, comparison, report formatting
src/corpus       manifest, dev-server control, per-entry runner, summary
scripts/         render, capture, corpus CLIs
tests/           unit + fixture (static vs react-dom) + framework tests
corpus/          manifest + results
```
