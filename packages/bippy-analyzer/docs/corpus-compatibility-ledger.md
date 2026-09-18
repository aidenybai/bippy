# Corpus compatibility ledger

## Artifact baseline

Recomputed at analyzer commit `19108ca056a732aba1784ac1a2cfa9df39e82205` from the current
`manifest.json` and `results.json` on 2026-09-18 UTC. This is an artifact audit, not a fresh run
of all repositories.

- Manifest entries: 500
- Result rows: 500; missing rows: 0; manifest revision mismatches: 0
- Membership: 273 exact, 167 partial, 22 truncated, 19 mismatch, 7 unresolved
- Strict coverage: 297 rows at 100%, 163 between 0% and 100%, 28 at 0%, and 12
  without a report. Of the 297 rows at 100%, 24 remain partial or truncated.
- Explicit uncertainty: 165 rows with opaque or wildcard matching
- Incompleteness: 115 rows with state-space omissions; 4 budget-exhausted comparisons
- Replay: 8 contradiction rows, 80 incomplete rows, 146 rows without replay evidence
- Native evidence: 15 live-result rows, 473 saved-capture replay rows, 12 rows without a native
  report
- Recorded environment/install failures: 0. The artifact gives no failure provenance for the 12
  static-only rows, so this is not evidence that their native setup succeeded.

The 19 native mismatches are `actual`, `blocknote`, `clip`, `ens-app-v3`,
`gabrielwr-react-retirement-calculator`, `guohub8080-mtkit`, `heroicons-dev`,
`logicmason5-many-short-games-using-reactjs`, `mural`, `museeks`, `novel`, `phar-converter`,
`quocbao19982009-todo-app`, `remix-blocks`, `rendy278-kanban-board`, `shivankacker-type`,
`standardnotes`, `taxepfa-taxepfa-github-io`, and `theonlyrasheed-color-generator`.

The 4 exhausted comparisons are `ens-app-v3`, `gabrielwr-react-retirement-calculator`,
`rendy278-kanban-board`, and `taxepfa-taxepfa-github-io`.

The 12 rows without native reports are `api-platform-admin`, `commerce`, `contentful-blog`,
`craft-js`, `fiora-app`, `giscus`, `hyper`, `mathberet`, `next-forge`, `rapidraw`, `redash`, and
`tooljet`. Each is labeled only `static only`.

### Replay contradictions

| Repository | Membership | Mismatched assignments | Incomplete assignments |
| --- | --- | ---: | ---: |
| `clip` | mismatch | 1 | 16 |
| `form-builder` | exact | 16 | 0 |
| `foxel` | truncated | 5 | 0 |
| `mantine-admin` | exact | 9 | 0 |
| `mantine-react-table` | exact | 16 | 0 |
| `rapidraw` | no native report | 16 | 0 |
| `react-video-editor` | partial | 16 | 0 |
| `sentry` | exact | 9 | 0 |

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

| Repository and revision | Conditions and before | Correction and fresh result | Remaining limitation |
| --- | --- | --- | --- |
| `rendy278-kanban-board@0a2965a647190e9c5468ee65a85be404c5b3de65` | `/`, `http://127.0.0.1:54809/`, manifest environment, 200,000 comparison steps. Native React 19.1.0 development capture, 311 fibers, 2 commits, no page errors. Before: mismatch at step 200,001 with the budget exhausted. | Prioritize name-agreeing opaque candidates and settle definitive child heads. Fresh native capture `2026-09-18T00:15:55.855Z`: partial in 137 steps, no exhaustion, 44/44 slots matched, 100% non-opaque coverage. | 58 static opaque nodes leave 7% strict coverage; one of two color-mode guard sides is unwitnessed. |
| `gabrielwr-react-retirement-calculator@089f16efbdf684df81f6e4ee813cc504acdc6613` | `/`, `http://127.0.0.1:55003/`, manifest environment, 200,000 comparison steps. Historical row: mismatch at step 200,001 with the budget exhausted. | Same slot-search correction. Fresh native React 16.14.0 development capture `2026-09-18T00:12:20.009Z`: partial in 7 steps, no exhaustion, 3/3 slots matched. | All 436 runtime nodes remain inside five opaque subtrees; the authored controlled-input warning remains. |
| `lucas-erkana-math-magician-react@cdf7061fa5092753c7064ef8de9ae50822d996be` | `/`, `http://127.0.0.1:54931/`, manifest environment. Historical row: partial in 59 steps with 1/5 slots matched. | Preserve direct host text in snapshots and compare it at opaque slots. Fresh native React 18.2.0 development capture `2026-09-18T00:17:22.153Z`: partial in 33 steps with 4/5 slots matched. | Opaque React Router `Routes` materializes one selected route while three passed `Route` children remain static, leaving one unmatched slot. |

All three fresh results replay every enumerated assignment with no contradiction. These are
initial-page captures only; they do not exercise interactions or prove exhaustive behavior.

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

| Repository and revision | Conditions and before | Correction and fresh result | Remaining limitation |
| --- | --- | --- | --- |
| `abhigk-color-generator-reactjs@682a1acbe88d54ef140ebfd7f1646967ffa820b4` | `/`, `http://127.0.0.1:55069/`, manifest environment. Fresh native React 16.13.1 development capture, 135 fibers and 23 commits. Before: partial in 157 steps, 84% strict coverage, 21 wildcard-absorbed text fibers, an unbounded 21-item repeat, and three incomplete replays. | Execute concrete `values.js` calls and preserve native-object own entries through spread. Fresh native capture and static rerun: exact in 134 steps, 100% strict coverage, 0 wildcards, 0 repeats, and one replayed assignment with no mismatch. | This verifies the initial palette only. Twenty-one alternate commit guards remain possible rather than natively witnessed; form submission, invalid colors, clipboard behavior, and complete interactions remain unverified. |

The second shape and the other 39 repositories still require fresh post-fix corpus runs before the
artifact-wide gain can be claimed.

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

Replaying the fresh capture after these corrections changes Mural from mismatch to partial in 140
steps: 119 fibers and 10 text nodes match, non-opaque coverage is 100%, strict coverage is 98.47%,
and no opaque subtree remains. The remaining two runtime fibers are under one explicit wildcard for
a spread-derived SVG child. The state space has 8 states and one omitted nested alternative; all 7
joint assignments were replayed with no contradiction, but 6 are incomplete because their claims
or replays retain unresolved nodes. This is saved-capture comparison against the fresh native
capture, not another live capture. Remote resources, interactions, the omitted alternative, and
whole-state-space agreement remain unverified.
