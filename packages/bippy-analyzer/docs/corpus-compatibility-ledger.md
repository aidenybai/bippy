# Corpus compatibility ledger

## Artifact baseline

Recomputed at analyzer commit `6682ba8f6fab1259387c18115471087b1157024e` from the current
`manifest.json` and `results.json` on 2026-09-18 UTC. This is an artifact audit, not a fresh run
of all repositories.

- Manifest entries: 500
- Result rows: 500; missing rows: 0; manifest revision mismatches: 0
- Membership: 329 exact, 109 partial, 23 truncated, 20 mismatch, 7 unresolved
- Strict coverage: 354 rows at 100%, 106 between 0% and 100%, 28 at 0%, and 12
  without a report. Of the 354 rows at 100%, 25 remain partial or truncated.
- Explicit uncertainty: 107 rows with opaque or wildcard matching
- Incompleteness: 75 rows with state-space omissions; 4 budget-exhausted comparisons
- Replay: 8 contradiction rows, 41 incomplete rows, 142 rows without replay evidence
- Native evidence: 15 live-result rows, 473 saved-capture replay rows, 12 rows without a native
  report
- Recorded environment/install failures: 0. The artifact gives no failure provenance for the 12
  static-only rows, so this is not evidence that their native setup succeeded.

The 20 native mismatches are `actual`, `blocknote`, `clip`, `ens-app-v3`,
`gabrielwr-react-retirement-calculator`, `guohub8080-mtkit`, `heroicons-dev`,
`logicmason5-many-short-games-using-reactjs`, `museeks`, `novel`, `openai-translator`,
`phar-converter`, `quocbao19982009-todo-app`, `remix-blocks`, `rendy278-kanban-board`,
`shivankacker-type`, `standardnotes`, `taxepfa-taxepfa-github-io`, `teable`, and
`theonlyrasheed-color-generator`.

The 4 exhausted comparisons are `ens-app-v3`, `gabrielwr-react-retirement-calculator`,
`rendy278-kanban-board`, and `taxepfa-taxepfa-github-io`.

The 12 rows without native reports are `api-platform-admin`, `commerce`, `contentful-blog`,
`craft-js`, `fiora-app`, `giscus`, `hyper`, `mathberet`, `next-forge`, `rapidraw`, `redash`, and
`tooljet`. Each is labeled only `static only`.

### Replay contradictions

| Repository            | Membership       | Mismatched assignments | Incomplete assignments |
| --------------------- | ---------------- | ---------------------: | ---------------------: |
| `clip`                | mismatch         |                      1 |                     16 |
| `form-builder`        | exact            |                     16 |                      0 |
| `foxel`               | truncated        |                      5 |                      0 |
| `mantine-admin`       | exact            |                      9 |                      0 |
| `mantine-react-table` | exact            |                     16 |                      0 |
| `rapidraw`            | no native report |                     16 |                      0 |
| `react-video-editor`  | partial          |                     16 |                      0 |
| `sentry`              | exact            |                      9 |                      0 |

### Incomplete replay outputs

The 80 rows are:

`abdanzamzam-rgb-color-generator`, `abhigk-color-generator-reactjs`,
`adeshinababatunde-color-generator`, `agusprats-colorgenerator`,
`ahsan1800411-react-project-color-generator`, `aiyanu-react-color-generator`,
`aman1106-react-timer`, `amirmasoudgaravand-color-generator-react`,
`ankitpodder2000-hangman`, `annanft-colorgenerator-react`, `clip`,
`codeofrelevancy-profit-margin-calculator`, `darkbits018-stopwatch-react`,
`drazhinustin-color-generator`, `elk15-colour-memo`, `ernest96-react-monocrhome-color-generator`,
`ernestthepoet-ec-82-ms`, `esmaaksoy-color-generator`, `gabrieldoddy94-react-color-generator`,
`gorgenbruna-react-color-generator`, `hanzalahwaheed-react-notes-app`, `heroicons-dev`,
`heysagnik-todoist`, `hieutran2103-colorgenerator-react-fundamental`,
`hossam-alahmad-color-generator`, `iamtanuj18-react-color-generator`, `ignite-dt-money`,
`ishandeveloper-notes-keeper`, `joeladia-dev-color-generator-react`,
`john-smilga-react-projects-9-color-generator`,
`john-smilga-react-vite-projects-9-color-generator`, `karthikn-vr-stopwatch-react`,
`krutie-quiz-machine-react-vite-ts`, `ktariayman-color-generator`,
`lalidiaz-colors-generator-reactjs`, `lethai2597-personal-tracker`,
`luizomf-memory-game-with-react-ts`, `luizomf-react-ts-memory-game-with-vitejs`,
`madhusudan-rathi-color-generator`, `maher-batha-color-generator`, `mattkolega-sudoku`,
`mermaid-reactflow`, `mirayavandiepen-drag-track`, `mlimad-color-generator`,
`multimart-react-ecommerce`, `muzi59418-creator-personal-dashboard-template`,
`nadiamartel-color-generator`, `nahuel61920-color-generator`, `next-ecommerce-shopco`,
`nhungbi-react-hangman`, `nithya98-react-color-generator`, `nostackdevv-react-noteapp`,
`obrm-color-generator`, `odiriteddie-color-generator-react`, `p32929-notes`,
`palgorhythm-todotshooks`, `pktcodes-color-generator-react-project`,
`pktcodes-color-generator-react-project-v2`, `pncsoares-hangman`,
`prashantstha-6-color-generator`, `promiseudo-color-generator-react`,
`quocbao19982009-todo-app`, `rafaellavborba-memorygame`, `rajmhatre20-react-color-generator`,
`ruchiray-color-generator`, `sadafamininia99-color-generator`,
`saglamburcu-react-color-generator`, `shadcn-admin`, `shikuljak-react-color-generator`,
`shivankacker-type`, `shubhamkadu-color-generator-react`, `shyrenmore-reactive-color-generator`,
`skipthedocs-memory-game`, `snelsi-cocomo-calculator`, `swapvp-react-random-color-generator`,
`swimmingkiim-image-editor`, `taxepfa-taxepfa-github-io`,
`themshahid-react-color-generator`, `theonlyrasheed-color-generator`, and
`thomasjclark-elden-ring-weapon-calculator`.

## Opaque slot search

React source `71f725593739d2cb5866a282a1075d581831722f` confirms that
`updateHostComponent` calls `shouldSetTextContent` and suppresses a separate `HostText` fiber for
direct string, number, or bigint children. The host fiber retains the value in
`memoizedProps.children`.

The owning defects were breadth-first opaque slot search repeatedly exploring less plausible
nested candidates, and runtime snapshots discarding the only representation of direct host text.
The regressions use real React commits captured through Bippy. The search regression fails under
100 steps before the correction; the direct-text regression reports zero matched slots before its
correction.

| Repository and revision                                                          | Conditions and before                                                                                                                                                                                                       | Correction and fresh result                                                                                                                                                                                        | Remaining limitation                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `rendy278-kanban-board@0a2965a647190e9c5468ee65a85be404c5b3de65`                 | `/`, `http://127.0.0.1:54809/`, manifest environment, 200,000 comparison steps. Native React 19.1.0 development capture, 311 fibers, 2 commits, no page errors. Before: mismatch at step 200,001 with the budget exhausted. | Prioritize name-agreeing opaque candidates and settle definitive child heads. Fresh native capture `2026-09-18T00:15:55.855Z`: partial in 137 steps, no exhaustion, 44/44 slots matched, 100% non-opaque coverage. | 58 static opaque nodes leave 7% strict coverage; one of two color-mode guard sides is unwitnessed.                                          |
| `gabrielwr-react-retirement-calculator@089f16efbdf684df81f6e4ee813cc504acdc6613` | `/`, `http://127.0.0.1:55003/`, manifest environment, 200,000 comparison steps. Historical row: mismatch at step 200,001 with the budget exhausted.                                                                         | Same slot-search correction. Fresh native React 16.14.0 development capture `2026-09-18T00:12:20.009Z`: partial in 7 steps, no exhaustion, 3/3 slots matched.                                                      | All 436 runtime nodes remain inside five opaque subtrees; the authored controlled-input warning remains.                                    |
| `lucas-erkana-math-magician-react@cdf7061fa5092753c7064ef8de9ae50822d996be`      | `/`, `http://127.0.0.1:54931/`, manifest environment. Historical row: partial in 59 steps with 1/5 slots matched.                                                                                                           | Preserve direct host text in snapshots and compare it at opaque slots. Fresh native React 18.2.0 development capture `2026-09-18T00:17:22.153Z`: partial in 33 steps with 4/5 slots matched.                       | Opaque React Router `Routes` materializes one selected route while three passed `Route` children remain static, leaving one unmatched slot. |

All three fresh results replay every enumerated assignment with no contradiction. These are
initial-page captures only; they do not exercise interactions or prove exhaustive behavior.

`lucas-erkana-math-magician-react` was subsequently classified with the manifest's React Router
profile instead of the generic SPA profile. Under the same pinned revision, `/` route, environment,
and native conditions, a third fresh comparison is exact in 25 steps with 100% strict coverage, no
opaque or wildcard node, and one replayed assignment with no mismatch. Calculator and Quote
navigation and calculator interactions remain unverified.

## Pure package class instances

The artifact contains 392 wildcard-absorbed text fibers across 40 color-generator repositories
whose common source is `new Values(color).all(step)`. The 32 repositories that spread each returned
item into component props account for 312 unknown `weight` values; eight more retain each entire
item as unknown.

Installed `values.js@2.0.0` declares `sideEffects: false`. Its `all` method returns a fixed array of
`Values` instances when the color and step are concrete. Each instance owns enumerable `rgb`,
`alpha`, `type`, and `weight` fields, while `hex` is a prototype getter. Before the correction, the
package remained external, so `all` became an unbounded repeat and JSX spread could not recover any
field.

The regression uses a deterministic CommonJS class export with the same relevant semantics:
construction returns a class instance array, component props come from JSX spread, and another prop
comes from a prototype getter. It failed before the correction with two unknown values. `values.js`
is now executed through the existing pure-package boundary when its inputs are concrete, and object
and JSX spread copy the known own enumerable entries of the resulting native object.

| Repository and revision                                                   | Conditions and before                                                                                                                                                                                                                                                                              | Correction and fresh result                                                                                                                                                                                                                                                            | Remaining limitation                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abhigk-color-generator-reactjs@682a1acbe88d54ef140ebfd7f1646967ffa820b4` | `/`, `http://127.0.0.1:55069/`, manifest environment. Fresh native React 16.13.1 development capture, 135 fibers and 23 commits. Before: partial in 157 steps, 84% strict coverage, 21 wildcard-absorbed text fibers, an unbounded 21-item repeat, and three incomplete replays.                   | Execute concrete `values.js` calls and preserve native-object own entries through spread. Fresh native capture and static rerun: exact in 134 steps, 100% strict coverage, 0 wildcards, 0 repeats, and one replayed assignment with no mismatch.                                       | This verifies the initial palette only. Twenty-one alternate commit guards remain possible rather than natively witnessed; form submission, invalid colors, clipboard behavior, and complete interactions remain unverified.                    |
| `annanft-colorgenerator-react@0a615a57c81d150a3bc1e1545eafaf5535114613`   | `/`, `http://127.0.0.1:55082/`, manifest environment. Fresh native React 18.2.0 development capture, 139 fibers and one commit. After the engine correction alone: partial in 137 steps, 99% strict coverage, no wildcard or repeat, with two runtime fibers inside the external `ToastContainer`. | Analyze the installed `react-toastify` source through the manifest's package-source boundary. A second fresh capture under unchanged application conditions is exact in 138 steps with 100% strict coverage, no opaque or wildcard node, and one replayed assignment with no mismatch. | This verifies the initial palette and empty toast container only. The dynamic `nanoid` key is intentionally not assigned a concrete identity; toast publication, form submission, random identity, and complete interactions remain unverified. |

A fresh post-fix batch covered the other 38 pinned repositories under their manifest routes and
environments. The first pass produced 27 exact results, ten results whose only matching-tree
opacity came from installed UI packages, and one CRA startup failure. The scoped package-source
boundary then produced exact results for the Chakra `Grid`, six empty Toastify containers, two
React Icons applications, and the Material UI form. Expanding Material UI initially exposed an
Emotion 11.6 contradiction: its browser build prepends a null-returning `Noop` fiber, while the
version model omitted that fiber. The corrected version matrix and a fresh native rerun changed
that five-step mismatch to exact in 206 steps.

The failed CRA lock declared `chokidar@3.5.1` as an optional Watchpack dependency but encoded
platform-specific `fsevents` as required, so npm pruned both available Watchpack implementations on
Linux after compiling successfully. Installing that exact declared watcher into an isolated runtime
prefix leaves the source and frozen application tree unchanged. A fresh capture is exact in 281
steps after React Icons source analysis.

Final cluster result: 39 of 40 repositories are exact with 100% strict coverage. The remaining
`ernest96-react-monocrhome-color-generator` row also has 100% strict coverage with no opacity or
wildcard, but remains truncated: its color-picker interaction and escaped state setter produce 48
assignments, an unbounded palette repeat, and eight incomplete sampled replays. This cluster-wide
strict result does not resolve that state-space omission or establish interaction completeness.

## Framer Motion presence source

`asmajalal-web-task-react-tic-tac-toe@5710d6f467a7b5b9353292557b6f83e88650fd91`
was freshly captured at `/web-task-react-tic-tac-toe/` under its manifest environment on
2026-09-18. The baseline was 98.31% strict because its empty initial winner rendered the
`AnimatePresence` function fiber itself, while that unmodeled Framer Motion export remained opaque.

Analyzing the pinned `framer-motion@10.17.8` source preserves the demonstrated empty
`AnimatePresence` fiber without inventing a winner or animation state. Saved-capture replay under
the unchanged route and comparison budget is exact in 59 steps: all 59 runtime fibers match, strict
coverage is 100%, and the one unconditional assignment replays with no mismatch or omission.

## Chakra UI package-source boundary

`heysagnik-todoist@06a1e8b55de66a7721776c005e0c4f87e03bce57` was freshly captured at `/`
under its manifest environment on 2026-09-18. The baseline was partial with 22.66% strict coverage:
36 opaque Chakra subtrees skipped 155 fibers, and an unresolved productive-time state absorbed two
fibers through a wildcard. All ten sampled assignments agreed with native, while five remained
incomplete.

Analyzing the installed Chakra v1 source first exposed a native contradiction: the model prepended
`Noop` to `@emotion/styled@11.3.0`, but the pinned React 17 capture rendered `Styled(div)` directly.
Published Emotion source places the hydration placeholder boundary at 11.6.0: Emotion 10 uses
`Noop`, 11.0–11.5 has no placeholder, 11.6–11.7 uses `Noop`, and 11.8+ uses `Insertion`. The
corrected version regression covers both sides of that boundary.

Chakra's utility barrel also re-exported `css-box-model`; analyzing that declared dependency made
its star-export set complete, resolving `omit` without an unknown spread. React Icons was the last
package-owned fiber. Replaying the unchanged native capture after those general and scoped
corrections is exact in 204 steps with 100% strict coverage, 199 fibers and four text nodes matched,
no opaque or wildcard match, and no replay contradiction. One escaped productive-time state remains
incomplete, so this does not establish complete interaction or state-space coverage.

The separate Chakra v3 expansion for
`ayokanmi-adejola-frontend-quiz@9037a812654f63892ae07bf1ee13613265953def` did not reach comparison:
interpreting the package's aggregate barrel consumed a full CPU for over eight minutes without
producing an artifact. Its fresh native baseline remains partial at 5.43% strict coverage with 43
opaque subtrees. No package-source override is retained for that row until the analyzer's barrel
scalability defect is reduced and verified.

## React Router SPA profiles and redirects

Fresh pinned captures on 2026-09-18 confirmed that twelve applications importing React Router were
still declared as generic SPAs. Their router components were consequently opaque, with representative
strict coverage between 2.86% and 40.82%. Applying the React Router profile exposed two semantic gaps:
imperative navigation returned an inert function, and both v6 `Navigate` and v5 `Redirect` were inert
empty fibers. React's effect commit and hook state scheduling at
`71f725593739d2cb5866a282a1075d581831722f` confirm that these redirects schedule later commits.

The regression covers a v6 `useNavigate()` effect, a v6 `Navigate` effect, and a v5 chain from
`Redirect` to a component effect calling `useHistory().push()`. Router location is now stateful for
both function and class router fibers while preserving basename identity. Saved-capture replay after
the general correction and scoped package-source boundaries proves these rows exact:

| Repository                                                                     |  React | Runtime fibers | Matched fibers + text | Steps |
| ------------------------------------------------------------------------------ | -----: | -------------: | --------------------: | ----: |
| `scdjango-todo-list-react@0c9c61bce9e095320a9fbaf5283aee9cd5c062e2`            | 18.3.1 |             36 |                31 + 0 |    31 |
| `m0hc3n-memory-game-front-end@41b96c07809b38d7cd56f606b1b3acfe69e26925`        | 18.2.0 |             18 |                13 + 0 |    13 |
| `ahangarha-mv-mathmagicians@67804d18395a1eb3811ab24d398b8fda645ae804`          | 17.0.2 |             50 |                39 + 6 |    45 |
| `shehza-d-quiz-app@8bf4e6e6a9a4227442f20b22adab36a2fc1677c0`                   | 18.2.0 |             20 |                15 + 0 |    15 |
| `kajal-rekha-immemorial@1326a6243df9518dd86fae455982a09747f0a0de`              | 18.2.0 |             97 |                84 + 8 |    92 |
| `ilynette-math-magician@b441768996896a8950c6852a3567d0b7618ec06a`              | 17.0.2 |             35 |                30 + 0 |    30 |
| `buluthamali-labtasker-frontend@4280fe5253b85f90e82f5144ec26d59b3d056f22`      | 18.3.1 |             78 |                73 + 0 |    73 |
| `phixyn-react-todo-app@42eab19c06bfbe5bfd6bebec001ff780262619fa`               | 19.2.5 |             70 |               55 + 10 |    65 |
| `orodrigogo-pomodoro-react-extension@569ca9c73519c4230a5ecb38d70847be76a24554` | 19.2.0 |             25 |                20 + 0 |    20 |

Each has 100% strict coverage, no opaque or wildcard match, and sample-passed replay at unchanged
budgets. These are initial-route captures and do not establish complete interactions or state-space
coverage.

Three rows remain non-strict after the router correction. `sonjoydatta-react-boilerplate` is at 15.31%
strict coverage behind Redux, TanStack Query, Ant Design, and translation boundaries.
`sam70361-glass-ui-react` still has 1,722 runtime fibers behind Query Client and Radix Tooltip
providers plus over 1.7 billion symbolic states before enumeration limits.
`hqwuzhaoyi-react-ddd` now agrees on its authored `/` → `/dash/home` → `/login` transition, but eight
Ant Design subtrees leave it at 11.11% strict coverage. A transitive Ant Design source experiment
exposed `rc-field-form`, `rc-motion`, and `rc-util` wildcards and replay contradictions; that incomplete
override is not retained.

## Settled React Router Await data

`remix-fastify@c69fe3491774b636dd148b409c916006588e37e7` returns a delayed Promise from its
index loader and renders the fulfillment through React Router's `<Await>`. The manifest initially
failed under current pnpm because it resolved and added `react-router-dom` at the monorepo root while
`react-router` belongs to the declared playground workspace. Resolving and installing the matching
package from that workspace restores the pinned native route without changing application source.

React Router 7.12.0 annotates a settled tracked Promise with `_data` or `_error`. React's Suspense
implementation attaches a ping listener to the thrown wakeable and retries its boundary after
settlement. The capture now preserves that settled Promise state, and the router model replays its
recorded fulfillment or rejection through `<Await>` instead of replacing the child with a wildcard.
The native regression covers a fulfilled loader Promise independently of the corpus.

Fresh capture `2026-09-18T17:49:10.806Z` and saved-capture replay are exact in 114 steps: all 106
fibers and eight text nodes match, strict coverage is 100%, there are no opaque or wildcard matches,
and the single replayed assignment passes. The initial anonymous-session route does not establish
form submission or rejected-loader behavior.

## Storybook react-docgen display names

`react-data-table-component@3c080557be7723f6815a7dc9555f21df1164c11f` uses Storybook 7 with
`react-docgen-typescript`. Its webpack plugin assigns `displayName` only to discovered exported
components. The native tree therefore names the exported `ResponsiveWrapper`, while internal styled
bindings remain `styled.div`; applying the styled-components Babel transform to every binding invented
names such as `HeaderStyle` and immediately contradicted the native capture.

The regression covers both an exported and an internal styled component under the Storybook compiler
configuration. React's reconciler at `71f725593739d2cb5866a282a1075d581831722f` reads a forward ref's
outer `displayName` before deriving a wrapped name. Replaying the fresh pinned capture after modeling
the docgen export assignment is exact in 310 steps: all 310 runtime fibers match, strict coverage is
100%, there are no opaque or wildcard matches, and the single replayed assignment passes.

## React Helmet source boundary

`runtimeterror10-club-animals@4c2519e31e269f929e0f437b1cb56673b0f6d57b` was freshly installed
and captured at `/` under its manifest environment on 2026-09-18. The baseline matched through one
opaque `Helmet` subtree, leaving strict coverage at 91.67%. React Helmet 6.1.0 delegates its class
fiber to `react-side-effect`; analyzing those two installed packages reproduces the native
`HelmetWrapper` and `SideEffect(NullComponent)` fibers without a repository-specific model.

Replaying the same fresh capture with that source boundary is exact in 38 steps: all 36 runtime
fibers match, strict coverage is 100%, there are no opaque or wildcard matches, and both bounded
assignments pass replay. The initial menu capture does not establish head mutation, timer, audio, or
gameplay behavior beyond the observed commits.

## Legacy React Redux provider

`palgorhythm-todotshooks@da94857ad1fb5a7fe58b323bb7f5b30768568c20` was freshly installed and
captured at `/` under its manifest environment on 2026-09-18. The baseline stopped at the
`react-redux@7.1.0` class `Provider`, producing zero strict coverage and an unbounded repeat behind the
opaque subtree. Analyzing the installed React Redux source exposes the original empty store rather
than inventing todo data or invoking the authored fetch button.

Replaying the same fresh capture is exact in seven steps: six fibers and one text node match, strict
coverage is 100%, no opaque or wildcard match remains, and the single unconditional assignment
passes replay. This initial empty-store result does not establish fetch or populated-list behavior.

## TanStack Query provider source

`hariadiarief-react-vite-shadcn-dashboard-starter-kit@46ce5235b3ec7e01cbec3a511bc8e07343d8f536`
was freshly captured at `/` under its manifest environment on 2026-09-18. Its router, icons, and
Radix components were already source-visible, leaving only the two runtime nodes inside
`QueryClientProvider` opaque at 97.06% strict coverage.

TanStack React Query 5.65.1 mounts its client in a passive effect and returns its context provider
around the original children. Analyzing that installed package preserves the native
`QueryClientProvider` and context fibers without changing query data or the application. Replaying
capture `2026-09-18T17:49:36.794Z` is exact in 68 steps: all 66 fibers and two text nodes match,
strict coverage is 100%, no opaque or wildcard match remains, and the unconditional assignment
passes. The empty-storage login route does not establish authentication, form submission, or
kanban behavior.

## Legacy React Router class fibers

React source `71f725593739d2cb5866a282a1075d581831722f` selects a class fiber when a component
function's prototype has `isReactComponent`. React Router 5.3.4 defines `BrowserRouter`,
`HashRouter`, `MemoryRouter`, and `Router` as `React.Component` classes; React Router 6 and later
define the modeled router components as functions.

The versioned regression uses the installed package version and real React materialization. Before
the correction it captured `BrowserRouter@5.3.4` as `FunctionComponent`; the native
`react-router-dom@5.3.4` oracle captured `BrowserRouter`, `Switch`, and the selected `Route` as
`ClassComponent` fibers and rendered only the first matching route.

`mural@e9d4a5bf80dfdb90e8831dfebdfbfdb57bf76ff0` was run at `/` on
`http://127.0.0.1:54376/` with its manifest environment and default comparison budget. The
historical result stopped after 28 steps at an expected `BrowserRouter` function versus the native
class. A fresh React 17.0.2 development capture at `2026-09-18T00:26:45.234Z` has 151 fibers, 5
commits, and 7 DNS resource errors.

The next divergence was host behavior. `new FontFace(...).load()` was treated as an unimplemented
constructor result whose `load` member was `undefined`; the invented throw stopped the effect before
its following one-second timer. The host regression constructs declared browser objects and calls a
promise-returning method before a short timer. Declared host instances now retain their interface,
members use the generated host-realm return types, and promise-returning methods remain modeled
promises. The unchanged Mural source then reaches its loaded branch.

React Router 5.3.4 also defines `Route` and `Switch` as classes. `Switch` visits children in order
and clones the first path match; `Route` provides the legacy route context and applies
children/component/render precedence. The model now preserves those fibers and semantics, and the
profile removes only demonstrated package-owned wrappers: the `Router` and `Router-History`
providers and react-router-dom's default `LinkAnchor`.

The audit regression additionally covers `useParams()` through `match.params`, empty `children`
falling through to `component`, `Switch` and `Route` location overrides, and a pathless child
inheriting its parent match. A saved-capture replay after these corrections isolated the remaining
gap to two SVG child fibers forwarded through BaseUI's wrapper around
`styletron-react@6.1.0`.

Styletron's `createStyled` creates an inner anonymous forward ref, applies its configured wrapper,
filters `$` props, and forwards concrete children to the selected `$as` or base target. Modeling
only that export preserves BaseUI's native `Svg` → context consumer → anonymous forward ref →
`svg` boundary without interpreting Styletron's class-name generation or accepting a wildcard.

Replaying the same fresh capture after the localized correction is exact in 136 steps: 121 fibers
and 10 text nodes match, strict coverage is 100%, and no opaque or wildcard match remains. The state
space has 6 states with no omission; all 5 joint assignments replay without contradiction. Three
unwitnessed alternatives remain sample-incomplete because their claims retain unresolved package
inputs. This is saved-capture comparison, not another live capture, so remote resources,
interactions, and whole-state-space agreement remain unverified.

## Uncertain pure-package calls

`teable@bda82ee5c1553e560a8db7f3ac9ff1131d7c3628` calls `tailwind-merge` with a class
selected through `Math.random()`. The package is declared pure, so an uncertain scalar result can
remain a stable derived value; interpreting its initialization source cannot recover the random
class and exhausted the evaluator while constructing Tailwind's class map.

The pure-package boundary now executes concrete calls natively and keeps uncertain calls derived
without source lifting. Replaying capture `2026-09-18T18:57:43.314Z` removes all 18 exhausted
diagnostics and all 180 wildcards, reducing the symbolic tree from 478 nodes with 180 wildcards to
474 nodes with none. Its one assignment replays without contradiction. Teable remains an honest
mismatch: the native auto scrollbar mounted one additional Radix `ForwardRef` below `Presence`,
and `NextSeo`, Sonner, and React Joyride still account for three opaque static nodes.
