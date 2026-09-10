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

`renderFrameworkTarget` renders a `{ framework, entry?, route? }` target (`src/corpus/render-entry.ts`
builds one from a corpus entry):

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
- `enumerateStaticStates` reads each committed materialized tree back into a pattern
  (`static-pattern.ts`: marker fibers become branch/repeat/opaque/wildcard nodes, everything else
  is a concrete fiber) and builds the **symbolic tree** (`symbolic-tree.ts`), the first-class
  static output: every branch carries a guard — a boolean formula over named symbolic inputs
  (`eq(#1.role, "admin")`, `not(truthy(#2))`, `#3.length > 0`, `eq(choice(commit), 1)`) — every
  repeat a cardinality (`len(#1.items)`), and every input its provenance (source kind, location,
  stable id). Inputs are the interpreter's own unknowns (`evaluate/predicates.ts` records how each
  value derives from them), so `const isAdmin = user.role === "admin"` and a later
  `user.role === "admin"` are one guard over one input, across siblings and depth.
- Concrete states are a derived, lazy view (`enumerate-states.ts`): guards are solved per
  independent cluster of inputs (two unrelated toggles are 2 + 2 cluster states, not 4 whole
  states), whole states are materialized only on demand within the `StateSpaceBudget`, and
  whatever is cut off is recorded in `omitted` rather than dropped. `matchStateSpace` walks the
  runtime tree and the symbolic tree together, keeping only decisions whose guards stay jointly
  satisfiable, so membership does not need the eager list (see `docs/exhaustive-states.md`).
- `compareStaticToRuntime` checks the runtime tree for membership: hierarchy, tags, names, keys,
  host elements, text. `opaque` subtrees match one runtime subtree (by name, or an anonymous /
  bundler-placeholder name such as esbuild's `_a2`) and slot their passed children back in;
  `unknown` is a wildcard. The report carries a tally (matched, absorbed, opaque, unknown), fiber
  coverage, the matched state's conditions, the states never observed, the omissions, the
  symbolic tree's stats, and on a mismatch the first divergence path with the closest state.
- Guard coverage (`guard-coverage.ts`) classifies every guard side across the captures as
  `witnessed` (a capture took it), `possible` (satisfiable, not witnessed) or `unreachable`
  (contradicts the tree's own facts); `planWitnesses` (`witness-plan.ts`) returns typed input
  assignments covering every reachable side, the plan for future targeted runtime runs.
  `formatSymbolicTree` prints the tree with guards inline and a decision table per cluster.
- `replayEnumeratedStates` re-witnesses the enumeration (`state-replay.ts`). The states are
  derived from one render in which every alternative was materialized together, so module state,
  refs and effects of one alternative can leak into another's subtree. For each assignment of the
  decision variables (the enumerated states grouped by their branch and repeat conditions, joined
  across commits) the static tree is materialized and rendered again through a fresh interpreter
  and materializer with those alternatives and repeat counts pinned (`PinnedDecisions`, a typed
  `StaticRenderOptions.decisions`; branch and repeat markers carry stable decision ids so a pin
  finds its marker in the replay), captured with bippy, and the distinct trees it commits must
  equal, node for node, the trees the enumeration claimed for that assignment. Replays are
  bounded by `DEFAULT_MAX_REPLAYED_ASSIGNMENTS` (16), always include the runtime-matched
  assignment, and the result records
  `stateReplay: { states, assignments, replayed, maxReplayed, mismatched }` so a sampled replay is
  visible as such. Each mismatch names the assignment, the
  claimed and replayed commit counts and the first divergence. When the replay left no decision
  open its commits replace the contradicted states and the runtime is matched against them again;
  a replay that met a decision the enumeration never described cannot correct anything.

Statuses: `exact` (the runtime is a member of the symbolic tree, the budget omitted nothing
from it, and every replayed assignment reproduced its states or was corrected by its replay),
`truncated` (the runtime matched but the budget omitted alternatives, repeat counts or subtrees,
or it matches only inside that omitted region), `partial` (matched through opaque subtrees or
wildcards), `unsound` (the runtime matched, but a replayed assignment could neither be reproduced
nor corrected, so the enumeration is not trusted), `mismatch` (no state matches), `unresolved`
(the static side did not produce a component tree), `skipped` (no runtime root or anchor). A
state the independent replay contradicts never counts as `exact`: it is either replaced by what
the replay witnessed or leaves the result `unsound`. Guard coverage is reported alongside, never
folded into the status: an exact entry with `possible` sides is exact for the captures at hand
and says which sides no capture reached. The harness chooses the runtime root by explicit index,
then anchor search, then the largest root.

## Corpus

`corpus/manifest.json` pins 199 real repositories by revision with framework, install/setup/dev
commands, URL, static target and notes; `corpus/results.json` holds the latest merged results.
Clones and captures live under the ignored `.corpus/`. Every entry renders statically; runtime
capture runs where a dev server can start in this environment (187 entries so far).

Live-verified so far: 101 entries are `exact` — the runtime capture is one of the enumerated
states and nothing was omitted — including `react-admin` (5,581 runtime nodes inside 21 states
over the list query's pending/settled, the loading counter and the effect commits, with
MUI, Emotion, React Router and React Hook Form interpreted from source), `cal-diy` (6 states:
the login page's `redirect("/auth/setup")` when `prisma.user.findFirst()` finds no user is one
of them, the runtime matched the populated database), `tanstack-table` (64 states over its
compiled memo caches), `documenso`, `sentry`, `posthog`, `graphiql`, `invoify`, `lexical`,
`puck`, `excalidraw-clone`, `jsoncrack`, `shadcn-ui`, `tanstack-router`, `tanstack-query`,
`redux-toolkit`, `bulletproof-react`, `epic-stack`, `nextjs-examples`, `nextjs-boilerplate`,
`react-router-templates`, `react-three-next`, `sonner`, `planka`, `navidrome`, `homarr`,
`panwriter`, `letterpad`, the MUI/Mantine admin templates (`material-kit-react`,
`react-material-admin`, `mantine-admin`, `mantine-react-table`) and the Creative Tim/Tailwind
dashboard templates. 67 are `partial`:
`formbricks`, `karakeep`, `socialecho` and `taxonomy` at 100% strict coverage behind opaque nodes and the rest short of full coverage through dynamic data or
opaque third-party providers; 6 are `mismatch`, 7 `truncated` (budget-omitted alternatives),
6 `unresolved` and 12 render statically only (no dev server here). Provider packages
become exact by listing them in an entry's `externalPackageAllowList` (their source is interpreted like application code, as `react-redux`
and `@tanstack/react-query` are) or through a library model (`src/libraries`, as Redux Toolkit's
`configureStore`/`createApi` are, reading the recorded store state).
`corpus/scripts/` holds the setup used for the heavy entries: a throwaway Postgres
(`postgres.sh`) with seeded databases for `cal-diy` and `documenso`, a Node-version wrapper
(`with-node.sh`), and a stand-in for PostHog's Django boot page (`posthog-app-server.ts`) that
serves the globals, preflight and API responses Vite alone does not provide. Results are
recorded as they are; profiles and normalization are only widened when the difference is
demonstrably framework machinery.

## Limitations

- Dynamic data (fetches, loaders, query caches, stores) is unknown unless a capture recorded it;
  lists over it are `repeat` nodes and their contents are opaque to comparison.
- Third-party components are opaque unless modeled or allow-listed for interpretation from
  source (as `react-admin`'s `<Admin>` and TanStack Router's `<RouterProvider>` are).
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
src/evaluate     interpreter, values, stubs, scopes, loops, hooks/React calls, class components, JSX text
src/react        element-type resolution, React API recognition
src/host         build-time realm tables (ecmascript/browser/node/react-native), host document
src/libraries    models of library packages the interpreter does not walk
src/materialize  StaticValue -> React elements, proxy components, markers, react-dom mount
src/render       StaticRenderer, root render discovery
src/frameworks   framework adapters, profiles
src/harness      runtime capture, snapshots, pattern matching, comparison, report formatting
src/corpus       manifest, dev-server control, per-entry runner, summary
scripts/         render, capture, corpus CLIs
tests/           unit + fixture (static vs react-dom) + framework tests
corpus/          manifest + results
```
