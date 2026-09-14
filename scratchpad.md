# bippy-analyzer: progress, correctness ledger, and execution plan

## Goal

Build a maintainable, renderer-independent React source-analysis engine that produces an **upfront causal model of the application** from available source, without requiring users to run their app. Explain possible UI structures, their conditions, what causes those conditions, and reachability through actions and async transitions. Preserve input provenance, correlations, omissions, and evidence. Symbolic UI trees are views of that model, not a complete description of application behavior. Use independently running real applications to validate the analyzer during development.

The current implementation primarily reconstructs guarded symbolic trees. The causal-model direction below clarifies the product goal; it is not a claim that a transition-system architecture is implemented or that a rewrite has been approved.

Continue until the acceptance gates in this document are satisfied. Creating this plan, fixing two review comments, passing the synthetic suite, or matching one captured page does **not** complete the project. Keep this file current as implementation, integration, and verification proceed.

**Overall status: INCOMPLETE.** The architecture and a substantial implementation exist. Exhaustive correctness, consistent replay evidence, several integration branches, renderer coverage, and the 500-repository target remain open.

### What “exhaustive” means here

- Within a declared semantic model and assumptions, preserve every reachable alternative; do not select an arbitrary concrete value for an unknown.
- Represent states symbolically. Enumerating the Cartesian product is a query/view, not the representation.
- Preserve the causes of states: input constraints, branch conditions, effect/update causes, and eventually action/async transitions.
- Distinguish a real witness, an abstract possibility, a proven impossibility, and an unexplored region.
- Report unsupported behavior and resource-limited exploration explicitly. Neither an unknown leaf nor a budget cutoff is a proof of completeness.
- A precise tree for recorded observations is conditional on those observations. It is not automatically a tree for every possible response, database, route, clock value, or user action.
- Arbitrary JavaScript may have unbounded states or nontermination. Do not promise a terminating, exact enumeration for every program. The requirement is an honest, useful symbolic model with testable guarantees—not a misleading universal-completeness badge.

### Causal-model discussion: requirements, research, and open decisions

**Status: design discussion, not implementation or production-readiness evidence.** The user wants to continue evaluating the approach rather than commit prematurely to a replacement architecture. Existing implementation checkpoints and corpus results below retain their original scope.

#### Agreed product requirements

- Discover possibilities upfront from source. Do not require users to start the app, supply a working backend, or author mocks to obtain the model.
- Explain structure, conditions, causes, correlations, and reachability. Support forward questions (what can this action cause?) and backward questions (what must happen for this UI to appear?).
- Follow available code as deeply as possible: components, custom hooks, event handlers, effects, cleanup, callbacks, refs, context, stores, subscriptions, timers, promises, and dependency internals. Do not impose an application-component-only boundary for convenience.
- Treat genuinely unavailable inputs symbolically. A frontend path conditional on a server response does not establish that the real server can produce that response.
- Runtime exploration cannot be the discovery foundation: it misses unexercised paths and requires substantial environment setup and mocking. Interpreting ASTs with the analyzer remains acceptable; executing the user's application is not a user prerequisite.

#### Candidate representation: interconnected symbolic state machines

A guarded causal model can be understood as an extended state machine or symbolic transition system. Its transitions describe:

```text
trigger + guard → state changes + scheduled work
```

Keep variables and updates symbolic (`count' = count + 1`), represent repeated behavior with cycles, and retain independent subsystems separately until their interactions require composition. Do not eagerly enumerate every global state or action history. Composition can still make reachability expensive; factoring is not a universal solution to state explosion.

UI is an output of the model, not its entire state. Identical visible trees can have different pending requests, captured values, component identities, or future behavior. The representation must preserve these distinctions when they affect causality.

Distinguish causal dependencies from feasible transitions. An edge showing that a callback reads state does not establish when the callback runs. A path through a dependency graph is not proof of reachability. Effect registration, dependency comparisons, render/commit phases, cleanup, cancellation, and async ordering need explicit semantics.

#### Findings from source study

- **Pattycake:** inspected `aidenybai/pattycake` at `fac748174aadeab4e3404e5e70392e9c4cef085c`, cloned to `/tmp/bippy-pattycake`. `ARCHITECTURE.md`, `src/hir.ts`, `src/pattycake.ts`, and `src/codegen.ts` show the value of lowering awkward AST call chains into explicit domain concepts: input, patterns, guards, and handlers. This is a narrow ts-pattern compiler, not a React semantic model. Its runtime fallback for unsupported expressions is not an available completeness strategy for this analyzer.
- **React Compiler:** inspected the React checkout at `82c44beb444eda5230c063eaa163d01f38817211` in `/tmp/bippy-parser-pr115-react`. Relevant sources under `compiler/packages/babel-plugin-react-compiler/src/` include `Entrypoint/Pipeline.ts`, `HIR/HIR.ts`, `HIR/Globals.ts`, `Inference/AnalyseFunctions.ts`, `Inference/InferReactivePlaces.ts`, `Inference/InferMutationAliasingEffects.ts`, and `Inference/MUTABILITY_ALIASING_MODEL.md`. The compiler uses control-flow graphs, SSA, mutation/alias analysis, nested-function summaries, control dependencies, and fixed-point abstract interpretation. These are relevant building blocks, not a complete app-state reachability engine.
- Compiler mutation/aliasing “effects” are not a full temporal model of React effects. The `useEffect` signature captures/freezes arguments for compiler analysis; it does not describe every setup, cleanup, or scheduling transition. Existing function summaries do not preserve every guarded state transition needed here.
- `compiler/docs/DESIGN_GOALS.md` explicitly assumes the Rules of React and excludes class components and some JavaScript features. Do not silently inherit those restrictions or treat compiler acceptance as proof of model correctness for arbitrary dependencies.
- **React runtime:** inspected `packages/react-reconciler/src/ReactFiberHooks.js` and `ReactFiberCommitEffects.js` for dependency equality, effect registration/execution, cleanup, state queues, and eager bailout. The causal model needs semantics beyond value dependency tracking. A mount-only effect can capture an old state value in a timer; later state changes do not rerun it, and cleanup can cancel its pending work.

The promising hypothesis is compositional abstract interpretation over a purpose-built representation, with guarded summaries linked across functions, hooks, components, and libraries. This is not “compiler analysis instead of abstract interpretation”: React Compiler itself uses abstract interpretation. Adding an intermediate representation alone does not solve reachability or prove a simpler implementation.

#### Assessment of PR #115

Keep the value of existing source resolution, abstract values, predicates, interpreter semantics, React integration, and the real-app corpus in view. Investigate whether the interpreter can emit guarded operations and transitions rather than replacing it wholesale.

The architectural concern is the render-driven round trip: symbolic values → simultaneously mounted alternatives → captured fibers → recovered symbolic tree → isolated replay/corrections. Mutually exclusive alternatives can interfere through effects and shared state. Real React faithfully renders that synthetic program, which is not automatically equivalent to each original alternative in isolation.

Producing a symbolic component tree directly would not, by itself, meet the causal-model goal. It could merely move React complexity into another layer. No decision has been made to remove materialization, abandon exact fibers, adopt React Compiler internals, or rewrite the interpreter.

#### Verification: real applications drive acceptance

Users need not execute their apps to obtain analysis; analyzer developers should execute real apps to validate it. The user explicitly rejects treating small generated fixtures or fuzzing as sufficient evidence of production readiness.

- Evaluate substantial real workflows, not just initial-page tree matches or repository counts. Produce the source model before collecting the validation trace.
- Check actions, handler execution, state updates, effect setup/cleanup, async completion, and committed UI where instrumentation can observe them. Fiber capture alone does not establish the full causal trace. Unobserved internal steps remain unverified.
- **Runtime → model:** require observed traces to be explainable under consistent guards and ordering. A trace outside the model is a coverage counterexample if instrumentation and comparison are faithful.
- **Model → runtime:** attempt to witness predicted paths. Successful execution is evidence; failure to exercise a path is not proof of impossibility.
- Report how much a match depends on unknown regions. Wildcards must not turn an uninformative trace match into a readiness claim.
- Separate normal-app/real-backend evidence, behavior conditional on controlled network responses, and same-interpreter replay. The last checks internal consistency, not independent correctness.
- Real-app discrepancies should become minimized regression fixtures. Generated tests can supplement edge-case coverage, not substitute for production workflows. Held-out applications/workflows can help expose corpus overfitting.

Let `R` be real reachable states and `M` the modeled states. `R ⊆ M` means no missed states; `M ⊆ R` means no invented states; equality requires both. Execution witnesses particular behavior, not universal completeness. A theoretical simulation argument must connect concrete JavaScript/React transitions to abstract transitions, including extraction and host assumptions, not merely prove the graph solver correct. No such whole-system proof was established in this discussion. Universal terminating exact reachability for arbitrary JavaScript is not a feasible promise.

Keep predicted possibilities, runtime witnesses, proofs under declared assumptions, contradictions, and unresolved regions distinct. These are design evidence categories, not a claim that current result schemas already implement them.

#### Open questions and proposed next investigation

The central question is whether the existing interpreter can extract and compose guarded transition summaries, or whether its render-driven architecture obstructs that goal. Summary precision must retain relevant guards, captured values, aliases, scheduling, and identity; otherwise composition can lose the very causes the product needs.

**Proposed next investigation, not an approved rewrite:** choose one substantial workflow in an existing corpus app, specify the expected causal model, and trace which facts the current implementation retains, loses, or never analyzes. Include conditional mounting, shared state, and effect/async cancellation where the real workflow contains them. Use that evidence to compare incremental evolution against a new representation before choosing an architecture.

The historical 500-repository gate remains documented below; repository count alone is not adequate behavioral verification. Acceptance changes and implementation migration remain to be decided explicitly.

### Architecture documentation plan

The conceptual page at `packages/bippy-analyzer/docs/architecture.md` explains the current parser implementation. It does not describe unfinished acceptance goals as supported behavior.

- Goal. Explain how source analysis produces React trees and what the comparison results establish.
- Audience. Contributors who know React and TypeScript but have not read the parser implementation.
- Content plan. Follow the explanatory structure of the [esbuild architecture document](https://github.com/evanw/esbuild/blob/main/docs/architecture.md). Start with design constraints and analysis phases. Explain module ownership, conditional evaluation, React rendering, symbolic states, comparison, and replay through implementation details and short TypeScript examples. Explain the reason for each design choice and link it to source. Keep limits explicit.
- Open questions. Corrected states do not update the original symbolic model. Task isolation, renderer coverage, event sequences, and whole-space completeness remain incomplete.
- Writing review. Apply the updated user rubric and ASD-STE100 principles. Use short sentences, active voice, consistent technical terms, and literal descriptions. Do not claim formal STE certification without a full vocabulary review.
- Validation. The page passes Markdown formatting and local link checks for 48 destinations and anchors. Both TSX examples compile and pass four React server renders plus two client effect checks. The related `correlated-guards` and `effect-cause-unmount` component regressions pass. `/tmp/bippy-check-parser-docs.ts` and `/tmp/bippy-parser-doc-example-tests.log` retain the checks. These are documentation checks, not a new whole-project acceptance run.
- Publication review. Human review and any pull request disclosure remain publication tasks, not completed checks.

### Browser-router basename checkpoint

Implementation `55d1cb02` retains router basenames and matches against provider-local paths. Known unmatched prefixes render no router children. Hooks and links read the local context. Unknown basenames and unsupported `useHref` targets remain unknown. The new `useHref` path support excludes relative targets, object targets, network-path references, and parent segments. Hash and memory histories, navigation events, and full-source router integration remain separate gaps.

Fourteen focused tests pass. They cover trailing-slash boundaries, case-insensitive matching, encoded parameters, search and hash preservation, sibling scopes, finite-choice correlation, unknown and null basenames, unsupported href objects, and location identity. The first seven tests failed before the repair. Two later identity tests exposed a model-wide cache that shared objects between siblings and reused an earlier object after a basename cycle. A third exposed needless invalidation when `undefined` changed to the equivalent normalized `/`. The cache now belongs to the mounted router and compares normalized values without discarding stable finite choices. The first finite-choice fixture included an unmatched `Outlet` and produced three states; the authored fixture now places its page inside `Routes`. That test setup failure remains in the logs.

Ten independently captured React Router 7.15.0 / React 19.2.6 fixtures match exactly through Bippy. Unit fixtures use installed React Router 8.3.0. Both the original adapter and the first basename repair passed model-backed replay while their independent identity captures mismatched. The two counterexamples remain in `/tmp/bippy-react-router-basename-captures-verified/`, with the deliberately retained intermediate implementation at `/tmp/bippy-parser-pr115-basename-identity-baseline`. Final native captures are in `/tmp/bippy-react-router-basename-captures-final/`; the first captures and reports remain separate. Fiber exactness does not prove DOM attributes, all navigation paths, or whole-space completeness.

Primusread is exact against its unchanged saved capture after the basename repair: 43 static fibers, 51 runtime fibers, 38 matched nodes, and one passing replay. Its baseline remains partial at about 4.878% strict coverage because the adapter matched `/primusread/` without stripping the configured prefix. The secondary Yarn-lock rewrite during the original npm installation remains recorded. The corpus now includes this initial-page result.

Validation passed through `/tmp/bippy-validate-router-basename.ts`: 3,011 root tests plus two intentional skips, 965 parser tests in 58 files, root typecheck/build, realm checks, lint, formatting, and 50 documentation links with both TSX examples. Thirteen same-capture controls retain deeply identical reports, runtime data, state spaces, and replay summaries. PostHog remains incomplete and Podcastr retains all 768 omissions. All ten independent fixtures repeat identically. The provenance checker also verifies unchanged source/capture/lock hashes and 622 installed dependency versions against Primusread’s npm lock. It preserves the secondary Yarn-lock mutation. The driver used process-scoped `caffeinate` and two test workers. No budgets were raised, no application bodies execute natively during analysis, and nothing was pushed.

### Primusread corpus checkpoint

The corpus now contains 235 distinct GitHub repositories. Primusread is repository ID 494396910 at revision `3cbd8369d0bf33ef20ef7235d399345ad3b6918f`. It uses the original `/primusread/` URL, Node 22 recipe, and independently captured initial page. The twenty-eight additions beyond the historical 207 report twenty-three exact results, two truncated results, two partial results, and one mismatch. These are membership results, not interaction or whole-space coverage. Another 265 repositories are needed for the count gate.

All 234 previous manifest and result rows retain their contents and order. Exclusive backups are `/tmp/bippy-before-primusread-{manifest,results}.json`. `/tmp/bippy-parser-tool-expansion/router-basename-provenance.json` records the implementation evidence, and `primusread-import-provenance.json` records the import. The canonical npm lock and application source remain unchanged; the secondary Yarn-lock rewrite remains explicit. Data-only validation passes root typecheck, all fifteen manifest tests, schema and identity checks, prior-row equality, formatting, and diff checks. Emoji Kitchen’s original metadata setup was still pending at this checkpoint. Flexbox Labs remains blocked by its frozen lock, and Tomato Work still has no completed analyzer result after heap exhaustion.

### Configured Emoji Kitchen corpus checkpoint

The corpus now contains 236 distinct GitHub repositories. Emoji Kitchen is repository ID 446242396 at frontend revision `b50d80bbc9bf48d8f015b2d2208f2b44cacc2577`. Its README requires `public/metadata.json`. The original download and backend revision `15e6f4af8c9c3231855f624340db1210ca75176e` returned identical 98,873,872-byte files with SHA-256 `73a7a2a6fbeb620f13ed6622b344cc0dfd21dfe07aca8ce46c564afe54e21804`. Backend HEAD remained unchanged across the download. The recipe pins that revision. No metadata was invented, and the backend repository is not another counted application.

The fresh configured capture is exact: 7,644 static and runtime fibers, 7,643 matched nodes, two model states, one passing replay, and no omissions or page errors. It follows five native commits, not a saved independent history. The identical saved capture repeats with deeply equal report, runtime, state space, and replay data. The prior missing-metadata error capture remains under `/tmp/bippy-parser-tool-expansion/` with its mismatch and thirteen replay contradictions. This result uses changed setup and fresh native evidence; it is not a parser repair against the old capture.

Application source and npm lock remain unchanged, and 119 installed dependency versions match the lock. Setup, capture, and import receipts are under `/tmp/bippy-parser-tool-configured/`. All 235 prior manifest/result rows remain unchanged. The twenty-nine additions beyond the historical 207 now report twenty-four exact results, two truncated results, two partial results, and one mismatch. Data-only validation passes root typecheck, fifteen manifest tests, schema and identity checks, exact prior-row/property-order checks, formatting, diff checks, and the fifty-link documentation check. Another 264 repositories are needed. Emoji selection, search, randomization, downloads, visuals, and whole-space coverage remain unverified.

### Native Vite globals and guarded property stores

The first three regressions failed in `/tmp/bippy-vite-globals-before.log`: missing native globals, lost effect writes, and incorrect header/value correlation. The initial guarded test enumerated two states but paired a header with the wrong value. Implementation `04dbe3ca` retains all native Vite defines outside `import.meta.env.*`, initializes mutable client globals in serialized order, and preserves lexical shadowing. Explicit NODE_ENV definitions also initialize the browser process object; direct NODE_ENV expressions retain Vite’s separate replacement rule.

Eight early independent captures remain in `/tmp/bippy-vite-globals-captures/`, with separate original and baseline results. All six early guarded replays passed despite three native mismatches. Ambient `var` lint failures and the revised Reflect-based failures remain in separate logs. `Reflect.set` is not modeled, so the final fixture tests ordinary property assignments instead; this does not repair that reflective side-effect gap. Intermediate captures remain under the `-final` suffix, and fresh final-source captures use `-verified`.

`GlobalProperties` stores each value and its presence in a journaled cell. Cells inherit the store’s lifetime, including cells first accessed inside a fork. This avoids representing a missing property as an own undefined property. Client/server globals and builtin expandos have separate stores. Pre-script window-key observations and known host properties establish initial presence; unavailable facts remain unknown. Conditional and uncertain writes preserve value/presence correlation, including deletion. Native Vite `env.mjs`, `clientInjectionsPlugin`, and the cloned React commit/effect sources informed the implementation.

Twenty focused tests cover initialization, shadowing, caller precedence, effects, correlated presence, host-property restoration, realm isolation, opaque expressions, serialized order, falsy prefixes, and uncertain writes/deletions. Unsupported intermediate define targets stop analysis. Fifteen fresh Bippy captures use React 19.2.7 and Vite 8.0.16. All match and repeat identically. The unchanged `2664e54b` baseline mismatches eight: globals, effect mutation, shadowing, three guarded writes, and two guarded presence captures. All twelve guarded baseline replays pass, including those five contradictions against independent runtime. Both random outcomes occurred naturally for each guarded fixture; no input override was used.

The unchanged Lapian Notes capture remains exact. Native defines reduce its model to three states and two passing replays; the baseline’s eight replays include four incomplete cases. The original incomplete result remains saved. Fifteen other controls are deeply identical in report, runtime, state space, and replay, including Primusread and configured Emoji Kitchen. Lapian source and npm lock remain unchanged, and 154 installed versions match the lock. `/tmp/bippy-record-vite-globals.ts` checks these facts and the native-source copies. The final validation passes 3,031 root tests with two intentional skips and 985 parser tests across sixty files. Root typecheck/build, realm checks, lint, formatting, diff checks, and the 51-link documentation check pass. `/tmp/bippy-validate-vite-globals-final.ts` records the full run; `/tmp/bippy-record-vite-globals.ts` verifies fifteen immutable controls and fifteen native repeats. The earlier missing-context failure remains in `/tmp/bippy-vite-globals-final-20-focused.log`. Concurrent work prevents performance attribution.

The checked-in Lapian result now records the same-capture repair. All 235 other rows retain their contents and property order, and the count remains 236. `/tmp/bippy-parser-tool-expansion/lapian-globals-refresh-provenance.json` retains the entire original incomplete result alongside the current result. Exclusive backups use `/tmp/bippy-before-lapian-globals-{manifest,results}.json`.

These checks do not establish whole-space, interaction, DOM-attribute, canvas, or descriptor parity. Reflective mutation, alternative assignment targets, writes to deleted bindings, fileless/server Vite configuration, bundled development environments, and opaque expressions remain gaps. The corpus still contains 236 repositories. Six additional image-editor repositories are pinned under `/tmp/bippy-parser-image-editors`; none is counted yet. FileMaster has no package manifest, and Fast Image Editor has no lockfile. Four locked candidates have separate installation attempts; failures remain evidence.

### Wide-state enumeration and image-editor evidence

Three regressions expose recursive continuation growth in `ClusterEnumerator`: 5,000 correlated siblings, their unchanged one-state budget, and a known 5,000-item repeat. All three fail at baseline `a379c4b0`. The working change uses an explicit work stack and defers guard cleanup until a path completes. Depth-first choices, state conditions, omission order, and repetition budgets remain unchanged.

Validation passes 3,034 root tests with two intentional skips and 988 parser tests across sixty files. Seventy-one focused state/replay tests pass. Sixteen real-application controls and fifteen independent Vite-global captures remain deeply identical, including replay summaries. Root typecheck/build, realm checks, lint, and the 52-link documentation check pass. The validation driver is `/tmp/bippy-validate-enumeration-stack.ts`; the evidence checker is `/tmp/bippy-record-enumeration-stack.ts`.

Swimmingkiim Image Editor has an independent React 18.3.1 capture with ten commits and no page errors. Its initial analysis records 12,714 fibers, 1,671 branches, 3,813 opaque nodes, and no completed comparison. The first stack overflow occurs in cluster enumeration. After the work-stack change, enumeration completes, but `Matcher` continuations overflow during comparison. Both traces remain in `/tmp/bippy-image-editor-stack-error*.txt`. A separate optional JSON export exceeded JavaScript’s string-size limit; that failed diagnostic attempt remains recorded. A streamed gzip artifact now preserves every cluster condition and omission in `/tmp/bippy-image-editor-enumerated-conditions.ndjson.gz`. Its summary records 2,048 combinations counted from bounded clusters and 3,326 explicit omissions under unchanged budgets of 256 states and two additional repeat counts. This is not a complete cardinality or completed membership verdict. No budget increase or comparator repair is claimed.

Mural’s original source uses React 17.0.2 and React Router 5.3.4. Its capture records 151 fibers, five commits, and seven DNS resource errors. The first sparse policy reports partial membership; analyzing original `react-uid` and `@nkyo/scenify-sdk` source exposes a known BrowserRouter class/function mismatch. The stronger policy remains a mismatch despite two passing replays. Baseline and repeat use the identical saved capture. Source and frozen Yarn lock remain unchanged, and 1,969 installed dependency locations match their locked requests. This is a policy expansion, not a parser repair.

React Img Editor’s original example captures React 16.14.0 across nine commits with no page errors. The first Node 16 install selected incompatible global npm 11; pinning npm 8.19.4 fixes the tool setup without changing application source. All 2,611 installed versions match the lock. Its analyzer remained in guard solving during enumeration, so the owned process was interrupted after about 31 minutes. SIGINT did not stop it; SIGKILL did. The capture, CPU profile, native sample, both signal receipts, and exit 137 remain saved. The dev server had already stopped, and the temporary inspector listener closed with the analyzer. This is neither a completed verdict nor a controlled performance comparison.

MTSEE Image Editor’s frozen Yarn lock needs an update; it was not repaired. FileMaster lacks a package manifest. Fast Image Editor lacks a lockfile. All six repository identities and pinned revisions are recorded under `/tmp/bippy-parser-image-editors`, along with installation failures and `initial-provenance.json`. None has been added to the corpus at this checkpoint; 264 additional repositories are still needed. Native errors, failed analyses, unknown regions, and the separate matcher/solver work remain open.

### Mural mismatch import

The enumeration fix is committed as `2b6b3f90`. Mural adds repository ID 631179284 at revision `e9d4a5bf80dfdb90e8831dfebdfbfdb57bf76ff0`, bringing the corpus to 237 distinct repositories. The thirty additions beyond the historical 207 contain twenty-four exact results, two truncated results, two partial results, and two mismatches. The 500-repository gate still needs 263 repositories.

The imported result keeps the stronger source policy and its known router mismatch, not the earlier partial result. Both passing model replays and all seven native DNS errors remain visible. Original source, Yarn lock, all 1,969 installed-version checks, baseline/repeated same-capture results, and both earlier policies are retained in `/tmp/bippy-parser-image-editors/mural-import-provenance.json`. All 236 prior rows and nested property orders remain unchanged. The identity audit’s original contents are backed up before adding Mural.

Data-only validation passes root typecheck, fifteen manifest tests, schemas, 237 distinct repository IDs, exact prior-row checks, formatting, diff checks, and the 52-link documentation check. Mural is an observed mismatch, not a parser repair or a claim about editing, canvas pixels, remote assets, events, or the whole state space. Swimmingkiim, React Img Editor, and the three blocked candidates remain uncounted.

### Stack-safe matching

Four comparison regressions fail before the matcher change: 5,000 independent sibling decisions, a 5,000-sibling correlated prefix whose last sibling forces backtracking, a known 5,000-item repeat, and 5,000 guarded passed children beneath an opaque library node. The corrected baseline has four failures and twenty-nine passing comparison tests. An initial repeat-test argument error and a temporary generator lint warning remain in `/tmp/bippy-matcher-stack-*.log`; neither is part of the final test or implementation.

`Matcher` now suspends descendant calls on a `WorkStack` instead of accumulating JavaScript call frames. Generator frames retain assignments, constraint scopes, and isolated failure searches. The driver forwards child results and thrown values, so existing `finally` blocks still release constraints. Synchronous public APIs, alternative preference, wildcard ranking, opaque-slot searches, tally/decision order, and matching step budgets remain unchanged. Tests cover budget cleanup and deep unwinding of thrown `undefined`, `null`, and Error values.

Validation passes 111 focused tests, 3,047 root tests with two intentional skips, and 1,001 parser tests across sixty-one files. Root typecheck/build, realm checks, lint, formatting, diff checks, and 54 documentation links pass. Seventeen immutable real-application controls retain deeply identical reports, runtime summaries, state spaces, and replay summaries. That includes Mural’s known router mismatch. Fifteen independent Vite-global captures and their repeated analyses remain identical. The driver and checker are `/tmp/bippy-validate-matcher-stack.ts` and `/tmp/bippy-record-matcher-stack.ts`.

The identical Swimmingkiim capture now completes comparison and bounded replay. Baseline `9c946571` still fails with a matcher stack overflow. Current and repeated results agree: partial membership at about 18% strict coverage, 1,488 native fibers, 2,048 combinations counted from bounded clusters, 256 enumerated states, and 5,118 omissions. All sixteen sampled replays are incomplete; the preferred outside-enumeration witness is also incomplete. No contradiction is reported, but incomplete replay is not a pass. The original source and npm lock remain unchanged, and 1,914 installed versions still match the lock.

The original stack failures, oversized diagnostic export, streamed conditions/omissions, baseline result, and repeated current result remain under `/tmp/bippy-parser-image-editors` and `/tmp/bippy-image-editor-*`. This repairs traversal, not the opaque library model, canvas pixels, DOM attributes, events, visuals, or the whole state space. Recursive tree indexing and guard-solver resource limits remain open. React Img Editor’s interrupted enumeration is not repaired by this evidence. Swimmingkiim is not yet imported at this checkpoint; the corpus remains 237 repositories.

### Swimmingkiim bounded-evidence import

The matcher repair is committed as `34c8dcfb`. Swimmingkiim React Image Editor adds repository ID 512127525 at revision `fe539ef9f104a65b57fdb2d202ee6fedc7288c36`. The corpus now contains 238 distinct repositories. The thirty-one additions beyond the historical 207 contain twenty-four exact results, two truncated results, three partial results, and two mismatches. Another 262 repositories are needed for the count gate.

The imported row retains partial membership, every recorded omission, all sixteen incomplete replays, and the incomplete preferred witness with repeat count 31. The capture reports two roots and renderer name `react-konva`; this is not canvas-pixel evidence. Source, npm lock, all 1,914 installed-version checks, both stack failures, failed diagnostic export, streamed conditions, and baseline/current/repeated results remain in provenance. The data row keeps the raw result’s nested property order. An initial schema-normalized import changed that order; the failed check and normalized copy remain saved before restoration.

Data-only validation passes root typecheck, fifteen manifest tests, schemas, 238 distinct repository IDs, exact checks of all 237 prior rows and nested property orders, manifest/ledger formatting, diff checks, and 54 documentation links. The project intentionally excludes `corpus/results.json` from formatting; its JSON and schema checks remain separate. No omission was dropped to reduce the result size. `/tmp/bippy-parser-image-editors/swimming-import-provenance.json` records the import. React Img Editor and the three blocked candidates remain uncounted, and whole-space and interaction coverage remain open.

### Swimmingkiim library-source expansion

The expanded policy interprets React Bootstrap and its uncontrolled-prop, Restart, transition, and SSR dependencies; i18next; its-fine; range sliders; and reselect where existing models do not take precedence. It matches all normalized compared nodes without opaque nodes against the same native capture. It remains truncated: twelve bounded states, two omissions, nine sampled replays with five incomplete results, and an incomplete outside witness at repeat count 32. This is a policy expansion, not a parser repair or full-source integration. Renderer/context-bridge transitions, canvas pixels, attributes, events, visuals, and whole-space coverage remain unverified.

The repeated report, runtime summary, state space, and replay results agree. Source, npm lock, capture, and budgets are unchanged. The original partial result with 5,118 omissions, bootstrap-only mismatch, every intermediate policy, and prior failures remain in `/tmp/bippy-parser-image-editors/swimming-policy-provenance.json` and its referenced artifacts. The refreshed row uses raw result property order. The corpus still contains 238 repositories; the thirty-one additions now contain twenty-four exact, three truncated, two partial, and two mismatch results. Another 262 repositories are needed. Data validation passes root typecheck, fifteen manifest tests, schema and raw-order checks for all 237 other rows, formatting, diff checks, and 54 documentation links.

### Utility applications in preparation

Twenty-four requests are pinned or excluded by repository ID under `/tmp/bippy-parser-utility-expansion`. Eleven of thirteen selected original-script recipes install without changing tracked source or locks. Version/location checks cover mortgage 2,040, Madzadev 1,657, BMI 1,773, Chamoda 1,712, Calcium 1,614, Niinpatel 1,784, HDRI 849, Income Tax 1,859, Mermaid 400, Modifio 410, and Clip 825 installed packages. Runtime probes verify the actual pinned Node/package-manager versions. Modifio's Windows-oriented Yarn lock omits Darwin SWC and fsevents resolutions: frozen Yarn adds SWC 13.4.19 and fsevents 2.3.3 from the original optional declarations. Their manifest and native-binary hashes are recorded separately, not described as canonical locked resolutions.

WebDev and HandReacting fail frozen npm installation with inconsistent or missing entries. Mermaid's initial pnpm10 recipe rejects lockfileVersion 6; the pnpm8 retry preserves it. Original failures and verifier mistakes remain recorded. First captures/analyses are not imported: mortgage and BMI match exactly; HDRI and Income Tax are partial; Modifio matches exactly; Clip mismatches PauseIcon versus PlayIcon with replay contradiction and extensive omissions. Mermaid is partial with incomplete replay, 84 native commits, repeated context-attribute errors, and repeated Onigasm initialization errors. CRA 3 exits on stdin EOF in Madzadev and Chamoda. Niinpatel reaches a parser Babel class-properties error, and Calcium reports `Should not already be working.` Their captures and failures need separate investigation. None of these candidates increases the count yet. Native CRA startup adds browser defaults to Niinpatel's `package.json`; the post-startup source assertion fails as expected, and its patch and capture hash remain in `niinpatel-native-configuration.json`. This is generated configuration, not a manual application repair.

### Development-server stdin

Original CRA 3.4.1 closes its server when stdin ends unless noninteractive CI is exactly `true`. The runner now holds server stdin open and destroys that pipe on shutdown. Install/setup commands still receive EOF. No source patch, CI override, timeout change, synthetic fiber, or replacement hook is involved. React's actual DevTools commit hook and the installed CRA startup source were consulted.

The corrected baseline at `184135d3` fails the new server regression; twelve other tests pass. All thirteen pass after the change, including command EOF and shutdown checks. An intermediate test mistakenly used happy-dom fetch and failed CORS; that failed attempt is retained before replacement with native HTTP checks. Fresh Madzadev and Chamoda captures each contain one commit and no page errors. Both match exactly with one passing replay. Baseline/current/repeated analysis deeply agrees against those same fresh captures. The earlier zero-exit attempts are preserved; this repairs server startup, not an earlier comparison verdict.

Validation passes 3,049 root tests with two intentional skips, 1,003 parser tests across 61 files, typecheck, build, realms, lint, formatting, diff checks, and 54 documentation links. Runtime recipes, source, locks, and independent capture hashes are recorded by `/tmp/bippy-record-server-stdin.ts`. Seven other utility captures are being repeated before any import. The count remains 238; no whole-space, calculation, event, or visual completeness is claimed.

### Six utility-application imports

The stdin repair is committed as `a68cc2b9`. Mortgage (43629371), BMI Calculator (206385718), Madzadev Calculator (278167981), Chamoda Calculator (184902247), HDRI to CubeMap (141999615), and Personal Income Tax Calculator (171380631) add six distinct non-fork repositories. Fresh GitHub identity checks agree with the preparation receipts. The corpus contains 244 repositories; 256 more are needed. The thirty-seven additions beyond the historical 207 contain twenty-eight exact, three truncated, four partial, and two mismatch results.

These six initial-page captures have positive commits and no page errors. Four match exactly; HDRI and Income Tax remain partial. All six have passing sampled replay, which does not establish opaque regions, shader pixels, charts, calculations, keyboard behavior, storage updates, or whole-space completeness. First and repeated comparison/runtime/state-space/replay fields agree on identical saved captures. Source, canonical npm locks, installed versions, actual Node/package-manager versions, initial stdin failures, and capture hashes remain in provenance. The original webpack/ejected CRA configurations are not replaced.

`/tmp/bippy-parser-utility-expansion/six-utility-import-provenance.json` records the import. All 238 prior rows and their nested property orders remain unchanged; new results use raw saved rows. Modifio, Mermaid, Clip, Calcium, Niinpatel, and failed or uninstalled candidates remain uncounted. No earlier failure is discarded. Data validation passes root typecheck, fifteen manifest tests, schemas, 244 distinct IDs, prior-row/raw-order checks, formatting, diff checks, and 54 documentation links.

### Three converter-application imports

The six-application import is committed as `e5b05ad4`. Mermaid to ReactFlow (815047469), Modifio (686924476), and Clip (443406432) add three distinct non-fork repositories. The corpus contains 247 repositories; 253 more are needed. The forty additions beyond the historical 207 contain twenty-nine exact, three truncated, five partial, and three mismatch results.

Mermaid remains partial: 237 native fibers, 84 commits, three context-attribute errors, four repeated Onigasm initialization errors, and three incomplete replays. Modifio matches exactly with 155 native fibers, six commits and one passing replay. Its extra server class/style warning remains recorded; fiber equality does not repair hydration. The original optional Darwin SWC and fsevents manifests/native binaries retain their pre-capture hashes. Their resolutions are not in the Windows-oriented Yarn lock and are not described as canonical locked versions.

Clip retains a known PlayIcon-versus-PauseIcon mismatch, 401 native fibers, 129 commits, sixteen incomplete replays and one replay contradiction. It retains 524,288 combinations counted from bounded clusters, 256 enumerated states and 524,221 omissions. These are not exhaustive cardinality. Original development scripts, CSP/isolation configuration, FFmpeg URL, source and locks are unchanged. Video playback timing, conversion, pixels, event handling, visuals and whole-space completeness remain unverified.

First and repeated report/runtime/state-space/replay fields agree for all three against identical captures. Fresh GitHub identities match the preparation receipts. `/tmp/bippy-parser-utility-expansion/three-utility-import-provenance.json` records the import. All 244 prior rows and nested property orders remain unchanged. Niinpatel, Calcium and the other failed or uninstalled candidates remain uncounted. An initial summary probe dereferenced a null omission summary; the failed attempt remains saved, and the corrected probe changes no comparison. Data validation passes root typecheck, fifteen manifest tests, schemas, 247 distinct IDs, prior-row/raw-order checks, formatting, diff checks, and 54 documentation links.

### Legacy CRA macro class-field syntax

Niinpatel's original CRA 2.1.1 uses Babel core 7.1.0, parser 7.2.0, preset 6.1.0 and macros 2.4.2. Its native preset enables class fields, but the parser's macro-only pass did not. The old compiler rejected `onClick = ...` before analysis could produce a tree. The transform now explicitly enables `classProperties` syntax for JavaScript, JSX, TypeScript and TSX. It does not run class-field lowering or application bodies natively. The installed preset/parser and React class construction source were consulted.

Four configuration regressions fail at baseline `e5f58be3`; the original six macro tests pass. All ten pass with the flag. Against the same saved React 16.4.1 capture, baseline analysis still fails on class-field syntax; current and repeated analysis match exactly with 35 fibers, one commit, no page errors and one passing replay. The capture and both analyses use the same post-startup configuration. Native CRA's earlier browser-default addition remains an explicit patch, not an application repair or a source-unchanged claim. All 1,784 installed npm locations and the original lock still verify.

Seven immutable application controls retain deeply identical report/runtime/state-space/replay fields across baseline/current/repeated analysis: the six imported utilities and React Shopping Cart. A missing backup directory interrupted the first shopping-control driver; the failure is retained before creating the directory and rerunning only that control. Validation passes 3,053 root tests with two intentional skips, 1,007 parser tests across 61 files, typecheck, build, realms, lint, formatting, diff checks and 54 documentation links. `/tmp/bippy-record-macro-class-fields.ts` records the compiler/capture/configuration checks. This repairs macro parsing, not event handling, calculations, class-field lowering semantics or whole-space coverage. Niinpatel is not yet imported; the count remains 247.

### Niinpatel calculator import

The macro parser repair is committed as `dafa6d6f`. Niinpatel Calculator adds repository ID 139321310 at its pinned original revision. That import brought the corpus to 248 repositories, leaving 252 for the goal. The forty-one additions beyond the historical 207 contained thirty exact, three truncated, five partial, and three mismatch results.

The row retains the independent React 16.4.1 capture and exact repeated membership after the syntax repair. Its one passing replay is not calculation, keyboard, class-lowering or whole-space completeness. The original parse failure remains saved. The import distinguishes unchanged component source/npm lock from the native-generated browser defaults in `package.json`; provenance marks that configuration change explicitly and preserves its patch and hash. No manual application repair or invented input is used.

`/tmp/bippy-parser-utility-expansion/niinpatel-import-provenance.json` links the compiler repair evidence and validates the original capture hash. All 247 prior rows and nested property orders remain unchanged. Data validation passes root typecheck, fifteen manifest tests, schemas, 248 distinct IDs, raw-order checks, formatting, diff checks and 54 documentation links. Calcium and the other unresolved candidates remain uncounted.

### Mount cleanup and original-failure preservation

Calcium's saved capture has React 18.2.0, seven commits and no page errors. Its analysis previously exposed only `Should not already be working.` Failed unmounting also left console handlers muted and skipped recorder/container disposal. The mount now restores those resources in `finally`. If rendering and unmounting both fail, an aggregate retains the original values and both descriptions. A lone cleanup error retains its identity. Unprintable thrown values cannot replace the original errors while formatting the aggregate.

Five regressions cover cleanup alone, an earlier error, thrown undefined/null and an unprintable value. Baseline `e752dd2f` fails all five; current tests pass. Real React host roots and Bippy recording remain in use. Validation passes 3,058 root tests with two intentional skips, 1,012 parser tests across 62 files, typecheck, build, realms, lint, formatting, diff checks and 54 documentation links. Eleven immutable application controls retain deeply identical report/runtime/state-space/replay fields across baseline/current/repeated analysis: nine imported utilities, React Shopping Cart and Swimmingkiim.

Calcium still has no completed comparison. The aggregate now exposes the original safety refusal, `a function the analysis holds cannot run natively`, during symbolic assignment through `DOMStringMap` into happy-dom's `setAttribute`. Its original and cleanup stacks remain in `/tmp/bippy-calcium-render-error-cleanup.txt`; the earlier hidden-primary-error trace remains separate. No safety guard was weakened, native application body executed, fiber fabricated, budget raised or runtime input invented. `/tmp/bippy-record-mount-cleanup.ts` records the evidence. The 1,614 installed versions, source and npm lock still verify.

Drawesome's original studio workspace and PHAR's original HTTPS webpack server completed frozen installation attempts under `/tmp/bippy-studio-phar-manifest.json`. Drawesome verifies 83 installed packages and React 19.2.8. PHAR's initial literal version check found the published hot-loader manifest version `16.11.0+4.12.16` versus Yarn's `16.11.0`. The following work retains that failed check and verifies the original locked artifact.

### MobX source policy and namespace overrides

The whole-package MobX React model blocked explicitly allowlisted `Provider` and `inject` source. The registry now limits model precedence to its ten implemented React exports. A shared factory map supplies those exports and their policy names. Core MobX remains a whole-package model; this change does not implement observability or lifecycle completeness.

Analyzed namespaces retain their external specifier. Named and namespace reads now select the same modeled helpers. Namespace reexports, namespace-valued require/dynamic imports and namespace spreading preserve those overrides. This does not replace arbitrary CommonJS `module.exports` objects or native module-cache semantics. Unopted-in namespace spreading remains uncertain rather than gaining invented export keys.

Four regressions cover both React packages with source opt-in enabled and disabled. Baseline `7c164f34` fails the two source cases; the current four pass. The first export-list-only attempt incorrectly invoked source observer helpers through namespaces. The namespace fix retains the existing models. An intermediate test wrongly expected five known values from an unopted-in spread; both versions returned four, and that failed expectation remains in the external logs.

PHAR retains its original HTTPS server, certificate, aliases, defines, component source and Yarn lock. The frozen installation verifies 747 packages and React 16.9.0. The native renderer reports the original hot-loader React DOM 16.11.0, seven commits, 155 fibers and no page errors. The locked hot-loader tarball matches both original hashes; all 40 archived package files match the installed bytes. Its embedded version really includes `+4.12.16`. `/tmp/bippy-parser-utility-expansion/hot-loader-artifact-provenance.json` records that exception instead of normalizing arbitrary version differences.

Interpreting installed MobX React 6.1.7 source exposes a stronger mismatch than the earlier opaque partial result. The model expects `inject-with-settingsStore(Component)`; the same native capture contains `inject-with-settingsStore(ThemeProvider)`. Both model replays pass. Installed MobX React Lite 1.5.2 assigns the observer memo's display name; the current observer model does not retain it. That naming mismatch and remaining opaque structure are not repaired by loading source.

Baseline/current/repeated comparisons retain 29 deeply unchanged controls, including the fresh exact Drawesome capture. PHAR's current and repeated report/runtime/state-space/replay fields also agree. `/tmp/bippy-record-mobx-source.ts` verifies all 30 saved captures and the unchanged native safety gate, comparator, enumeration and replay implementations. Validation passes 3,062 root tests with two intentional skips, 1,016 parser tests across 63 files, typecheck, build, realms, lint, formatting, diff checks and 56 documentation links. The following import audit records the two new captures separately from this implementation validation.

A separate discovery pass found 108 public non-fork candidates and prepared 58 pinned calculator/game repositories under `/tmp/bippy-parser-game-expansion`. Preparation verifies repository identity and preserves tracked locks, including nested locks. It does not count repositories, validate dependencies or establish runtime behavior. Original scripts, configuration and data requirements still need review before installation.

### Drawesome and PHAR imports

The source-policy change is committed as `73edb789`. Drawesome adds repository ID 1314688648 at `8fb08e93433e2cda32e265280371a0551b3c13a7`; PHAR adds ID 141057421 at `269dbe6ac5afcd10573f0a55b452e2d14f4b904e`. The corpus contains 250 distinct repositories, leaving another 250. The forty-three additions beyond the historical 207 contain thirty-one exact, three truncated, five partial and four mismatch results.

Drawesome's exact comparison covers its initial studio fibers, not drawing strokes, pixels, exports or interactions. PHAR retains the exposed native mismatch rather than its weaker opaque result. Its passing model replay is not a native match. The original HTTPS certificate, webpack aliases, source, locks and published hot-loader artifact exception remain in provenance.

`/tmp/bippy-parser-utility-expansion/studio-phar-import-provenance.json` links both original captures, installed-tree checks and same-capture repetitions. All 248 prior rows and nested property orders remain unchanged. Data checks pass root typecheck, fifteen manifest tests, schemas, 250 distinct IDs, raw-order checks, formatting, diff checks and 56 documentation links. The 58 new game/calculator preparations and unresolved candidates remain uncounted.

### Original Vite calculator and game attempts

Sixteen recipes under `/tmp/bippy-game-vite-manifest.json` preserve reviewed entrypoints, HTML, Vite configuration and original locks. The active React entry in Artem's HTML differs from its commented-out Vue entry. Chebyshev keeps its basic-ssl HTTPS plugin; MTKIT keeps its original browser mode and HTML transform. Frontend Mentor Tip Calculator and Mattkolega Sudoku retain their original base paths.

Fourteen initial frozen installations verify their installed trees. Artem's npm attempt fails on Storybook beta peer requirements against Vite 5.1.3. Memorio's original npm lock omits vite-tsconfig-paths 5.1.4, globrex 0.1.2 and tsconfck 3.1.6. Its separately checked-in pnpm lock supports the current manifest and its original start/deploy scripts already invoke pnpm. A separate, explicit frozen-pnpm recipe succeeds without changing either lock. Setup copies the exact checked-in `.env.example`; no game moves or saved state are supplied.

The fifteen installed trees and actual runners have external receipts. All use Node 22.16.0 and top-level pnpm 10.12.1. MTKIT's separately locked pnpm 8.15.9 shadows only the child executable; both versions are recorded. The installation checker now selects the canonical lock from the actual recipe and accepts an explicit corpus directory. Its first-five receipt accidentally retained unrelated utility failure notes; the original receipt and a correction record remain separate. Version, revision and lock checks agree.

The first three native captures give partial Calcway, exact John Mwendwa Calculator and exact Profit Margin Calculator membership. Profit Margin retains one incomplete replay rather than a sample-passed claim. Configured Memorio is partial. MTKIT is a mismatch: the model stays on `AutoRedirect`, but the original effect navigates to the native `MainLayout`. Its model replay still passes. These captures remain uncounted pending repetitions and import checks.

Chebyshev's independent capture has React 18.3.1, five commits and no page errors. Static analysis exits 134 with `Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`. `/tmp/bippy-parser-game-expansion/chebyshev-analysis-failure.json` retains the capture and failure. No completed comparison, solver repair, higher heap limit or repository count follows. Port 54502 has no remaining listener; no service was stopped. Concurrent jobs prevent controlled performance attribution.

All fourteen completed comparisons repeat against unchanged saved captures. Explicit source expansion for react-side-effect, react-icons and lucide-react changes Calcway, Memorio and Mateo Guidi Sudoku from partial to exact. These are analysis-policy changes, not parser repairs. Calcway retains its native UNSAFE_componentWillMount warning. The sparse policies remain external.

Thirteen audited imports increase the corpus from 250 to 263 distinct repositories: nine exact, two truncated, one partial and one mismatch. The fifty-six additions beyond the historical 207 contain forty exact, five truncated, six partial and five mismatch results. Another 237 repositories remain. `/tmp/bippy-parser-game-expansion/thirteen-game-import-provenance.json` links their original captures, installed trees, actual runners and repeated comparisons. All 250 prior raw rows and nested orders remain unchanged. Data validation passes root typecheck, fifteen manifest tests, schemas, identity/raw-order checks, formatting, diff checks and 57 documentation links.

Luiz and SkipTheDocs Memory Games each retain one omission and three incomplete replays out of four. Their preferred outside-enumeration witnesses remain incomplete. Elonehoo records 240 native commits but only initial-capture membership, not timer or gameplay completeness. Tip Calculator remains partial because its original Vite aliases never reach the module resolver; neither guessed aliases nor a changed application hide that gap.

Mattkolega remains unimported. Its initial and repeated sparse-policy analyses agree on partial membership, about 3% strict coverage, 340,924 bounded combinations, 256 enumerated states and 340,670 reported omissions. All sixteen sampled replays are incomplete. A one-second native sample of the verified owned analyzer remains saved; no process was stopped and no performance claim follows. A separate Mantine-source policy also repeats as partial against the same capture. Its wider known region does not establish library or whole-space completeness; it remains unimported at this checkpoint.

Twenty further CRA source bundles have been reviewed. Seventeen original frozen-install recipes yield fourteen completed installs. Changzhn fails certificate verification, Raravi has inconsistent/missing npm lock entries, and Satnaing has CRACO6/CRA5 peer conflicts. Three original node-sass4/6 applications require a separately verified native build workflow; none is silently replaced. The first recipe generator used three wrong schema field names; its rejected manifest and log remain saved before the corrected recipe. The first combined installation audit stops at Mac Calculator’s nested npm-packlist1.2.0 versus locked1.1.11; no generic artifact exception accepts it. These CRA applications remain uncounted and have no native captures yet.

### Mattkolega source-policy import

The thirteen-app import is committed as `96405f4b`. Mattkolega adds the next distinct repository using its original React 18.2.0 capture: 414 fibers, four commits and no page errors. The corpus contains 264 repositories, leaving another 236. The fifty-seven additions beyond the historical 207 contain forty exact, five truncated, seven partial and five mismatch results.

Interpreting installed Mantine styles/utils, MUI utils and React Icons increases strict coverage from about 3% to about 95%. The result remains partial: 393 of 413 normalized nodes match, two opaque regions skip thirteen fibers, and a wildcard absorbs seven. The model counts 463,980 bounded combinations, enumerates 256 and reports 463,756 omissions including dropped states. All sixteen sampled replays and the preferred outside-enumeration witness remain incomplete.

Both policies repeat against the identical capture. All 337 installed versions, original source/npm lock and actual runner versions verify. `/tmp/bippy-parser-game-expansion/mattkolega-import-provenance.json` records the import; all 263 prior rows and nested property orders remain unchanged. Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting, diff checks and 57 documentation links. This is a source-policy expansion, not a parser repair, performance result, complete library model or gameplay proof. The older policy and its omissions remain external.

The separate CRA audit confirms twelve installed trees and actual runners. Mac Calculator’s nested npm-packlist mismatch and Zakariya’s installed loader-utils2.0.2 versus locked3.2.1 remain unresolved, despite successful install commands. Seven initial version probes incorrectly passed pnpm8 a configuration option with `--version`; their child probes already reported the expected runtimes. Corrected version-only probes preserve the declared dev commands and all failed logs. Twelve first native CRA attempts complete in separate per-entry processes without changing tracked files. The results include five exact, four partial, one truncated, one mismatch and one unresolved comparison. No CRA repository is counted yet; repetitions and import checks remain.

### Twelve original CRA captures

The Mattkolega import is committed as `5d930c44`. Twelve more original Create React App repositories bring the corpus to 276 distinct GitHub IDs, leaving 224. The sixty-nine additions beyond the historical 207 contain forty-nine exact, six truncated, eight partial and six mismatch results.

All twelve initial comparisons repeat against saved captures. Explicit installed-source policies then resolve four partial comparisons to exact. Pedro and Luan require Router5/History and mini-create-react-context source; Luan also requires Redux source. AlphaPentagon uses Router6/@remix-run/router source, while Kobawan requires Redux source.

Tuan, Balint, Douglas, Ricar and Hesbon retain their initial exact results. These nine exact memberships do not establish calculations, gameplay, navigation or lifecycle completeness.

Snelsi improves from unresolved to partial against the same About-page capture. The expanded policy interprets its router, context, store, lifecycle and omit helpers. It retains 1,536 bounded combinations, 256 enumerated states, reported omissions and incomplete replay. No root-cause parser repair follows from this policy change.

Larkooo retains a native counterexample beneath SwitchBase: the model names `Styled(Component)`, while React reports `Styled(ForwardRef(ButtonBase))`. Internal replay passes despite this mismatch. Cenxky retains truncated membership, 99 bounded states and nine reported omissions; sampled replay does not prove its worker-generated grid or cell values. Pedro’s original StrictMode lifecycle warning remains unchanged.

Kobawan’s saved page observations contain empty local and session storage. Its mount path therefore skips the user-ID request and saved-game initialization. The unrelated localhost5000 Control Center listener remains untouched. `kobawan-origin-provenance.json` records the source-path audit; it is not a complete network trace or backend validation.

Original tracked source, every lock, installed trees and actual runners verify after capture. The import preserves all 264 prior raw rows and nested property orders. Evidence includes `cra-base-repeat-provenance.json`, both expanded-policy receipts and `twelve-cra-import-provenance.json` under `/tmp/bippy-parser-game-expansion`. Earlier partial/unresolved results, failed installs, installed-version discrepancies and pnpm8 probe failures remain saved. Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting, diff checks and 58 documentation links. Parser implementation and comparison budgets are unchanged.

### Larkooo naming-source policy

The twelve-app import is committed as `ddf13b03`. Opting into installed `react-is` source changes Larkooo’s mismatch to exact against its unchanged capture. Both expanded-policy runs agree on comparison, runtime, state space and replay. The corpus still contains 276 repositories; the sixty-nine additions now contain fifty exact, six truncated, eight partial and five mismatch results.

The diagnostic interpreter trace records MUI assigning a branched `displayName` while `react-is` constants remain external. One branch contains the native `Styled(ForwardRef(ButtonBase))` name. The stub-name reader accepts only a known string, so it falls back to `Styled(Component)`. Interpreting the installed constants removes that uncertainty, but does not repair unknown-name handling or mutable metadata.

The earlier counterexample and passing internal replay remain in the twelve-app receipt and commit. `larkooo-source-provenance.json` records the new policy, unchanged capture and preserved 275 other raw rows. All 1,289 installed versions, source, locks and runner receipts remain valid. No comparison rule or budget changes. Root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting, diff checks and 59 documentation links pass.

Six original Next recipes are prepared under `/tmp/bippy-game-next-manifest.json`. Five frozen installations and installed-tree/runtime audits pass. Amendezm’s original npm recipe fails because react-textfit1.1.1 requires React15/16 while the project locks React18.2.0; it remains uncaptured. EasyArty keeps its original pnpm `lockfileVersion: 6`, MDX/React compiler configuration and checked-in next-themes patch. Both installed patch postimages and Git blob hashes verify. Five native attempts are starting; none adds a repository yet.

### JSX member receivers

The Larkooo source-policy refresh is committed as `cc0f2114`. The EC-82MS native capture exposes another interpreter defect: `<this.ThisComponent />` looks up a variable named `this`. The model therefore replaces eleven native fibers with a wildcard. JSX `this` tags now read the same receiver as an ordinary `ThisExpression`; other lowercase host tags retain their existing behavior.

The React checkout calls class renders through `instance.render()`. Installed Babel JSX source converts a referenced JSX `this` identifier to `ThisExpression`. Three regressions cover class-field arrows, nested member tags, a shared method called with different receivers and bare `<this />`. All fail the baseline and pass the repair. The initial member-only implementation still treated bare `this` as a host tag; that failed attempt remains saved.

Three authored browser fixtures independently capture React18.2.0 with one commit each and no page errors. Two baseline comparisons are partial; the bare-`this` comparison mismatches despite passing internal replay. All repaired comparisons are exact and repeat against unchanged captures. The class fixture still has incomplete replay.

The first browser attempt omitted readiness; the retry exposed a missing plugin-react dependency. The verified fixture uses the installed plugin-react-swc. All failed logs remain saved, and final fixture hashes match the browser copies.

EC-82MS changes from partial to exact against its original 350-fiber capture. Its three bounded states and three replay assignments retain two incomplete replays. Four unchanged controls cover Biorhythm, Larkooo, Pedro and Luan. Every comparison/runtime/state-space/replay field agrees across baseline, current and repeated controls. The repair changes no application, comparison rule, enumeration order or budget.

Final validation passes 3,065 root tests with the same two skips, plus 1,019 parser tests across 63 files. Typecheck, build, realm checks, lint, formatting and diff checks pass. `/tmp/bippy-jsx-this-browser-evidence/provenance-final.json` verifies the three final fixture copies and immutable captures. `/tmp/bippy-parser-game-expansion/jsx-this-final-provenance.json` records five baseline/current/repeated real-app comparisons. Initial member-only receipts remain saved; the documentation check passes 60 links and both executable TSX examples. No repository is added by this repair.

All five original Next captures now complete. Biorhythm is exact with its original statistics-endpoint CORS errors; EasyArty and Dastasoft are partial. Taxe PFA reports a budget-limited settings-card mismatch, 422,161,152 bounded combinations, 256 enumerated states and sixteen incomplete replays. Its counts are not whole-space cardinality. EasyArty’s only tracked native change updates the generated `next-env.d.ts` documentation URL; its explicit receipt verifies the complete patch and installed generator. Next imports and repetitions remain open.

### Four original Next imports

The JSX receiver repair is committed as `be911f22`. Four original Next repositories bring the corpus to 280 distinct GitHub IDs, leaving 220. The seventy-three additions beyond the historical 207 contain fifty-three exact, six truncated, nine partial and five mismatch results.

EC-82MS imports exact initial membership after the receiver repair, while retaining two incomplete replays. Biorhythm is exact with its original statistics-endpoint CORS errors. Dastasoft becomes exact after explicit AnimatePresence/PresenceChild source expansion; its earlier opaque-provider comparison remains saved. EasyArty remains partial with three element.ref warnings and the original HotReload/SlotClone update warning.

EasyArty’s 649 installed versions and both original next-themes patch postimages verify after capture. Its only tracked native change replaces a documentation URL in generated `next-env.d.ts`; the receipt checks the complete patch and installed generator. The installed React RC differs from Next’s captured internal RC. Dastasoft likewise captures Next’s React18.0.0 prerelease while retaining package React18.0.0. Neither difference permits version normalization.

The import preserves all 276 prior raw rows and nested property orders. Frozen locks, installed locations, actual runners and saved-capture hashes verify for all four repositories. `four-next-games-import-provenance.json` records the import under `/tmp/bippy-parser-game-expansion`. Repeated comparison/runtime/state-space/replay fields agree. Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting, diff checks and 60 documentation links. Attributes, calculation results, animations, gameplay and whole-space coverage remain unverified.

Taxe PFA’s two repetitions retain its original mismatch and sixteen incomplete replays. All three raw reports also retain `budgetExhausted: true`; this is not a proven native contradiction. Amendezm’s original frozen npm peer failure remains uncaptured and uncounted.

### Taxe PFA’s budget-limited comparison

Taxe PFA brings the corpus to 281 distinct GitHub IDs, leaving 219. The seventy-four additions beyond the historical 207 contain fifty-three exact, six truncated, nine partial and six mismatch reports.

The original comparison and both repetitions exhaust the matching budget at 200,001 recorded steps. Their last divergence expects another Mantine Text in SettingsInfoCard. That search diagnostic does not prove a parser defect or establish that the capture is absent from the symbolic model. The raw `mismatch` status and `budgetExhausted` flag both remain intact.

The result retains 422,161,152 bounded combinations, 256 enumerated states and 422,161,031 reported omissions. All sixteen sampled replays remain incomplete, with no replay contradiction. These counts neither establish whole-space cardinality nor prove membership.

The independent capture contains 1,079 fibers and nineteen commits, with no page errors. Next captures React19.0.0-rc-66855b96-20241106; the installed package remains React19.0.0-rc-7670501b-20241124. All 389 installed versions, original locks and tracked source verify. The original Node20.19.0 workflow and Next turbo/static-export setup remain unchanged.

The import preserves all 280 prior raw rows and nested property orders. `tax-budget-import-provenance.json` records the source, identity, installation, runner, capture and repeated-field checks under `/tmp/bippy-parser-game-expansion`. No budget, input, application or comparison rule changes.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker passes 60 links and both executable TSX examples. Parser implementation and the latest 3,065-test gate remain unchanged.

A separate Valtio/proxy-compare source-policy trial remains uncompleted and is not the selected recipe. Its first analysis reaches replay. An owned-process sample and three-second inspector profile record collection snapshot/restore activity under `/tmp/bippy-parser-game-expansion/valtio-inspector-profile.json`. The diagnostic scripts did not stop a process, and concurrent work prevents performance attribution.

Three original Yarn Berry recipes also pass frozen installation and tree checks. Elden Ring checks 414 installed locations, KaiHotz 583 and Icecream17 1,803. The original vendored Yarn3.8.7/4.8.1/4.12.0 releases and node-modules linkers remain unchanged. Node22.16.0 and pnpm10.12.1 probes verify before capture.

The first probes incorrectly inherited strict Corepack selection instead of the existing dev-server environment; corrected probes preserve those failures. Yarn3’s bare dependency ranges require its default npm protocol when looking up explicit locked descriptors. The vendored resolver, actual configuration and repeated tree checks verify that correction without normalizing package versions.

KaiHotz’s native comparison is partial because a lodash.map callback cannot run natively during analysis. Icecream17 is exact, retaining the original CSP directive warning and server-side TypeScript getter errors. Elden Ring reaches static analysis after native capture. These three repositories remain unimported pending same-capture repetitions and final checks.

### Two original Yarn Berry imports

KaiHotz and Icecream17 bring the corpus to 283 distinct GitHub IDs, leaving 217. The seventy-six additions beyond the historical 207 contain fifty-five exact, six truncated, nine partial and six mismatch reports.

KaiHotz’s original partial comparison contains a ten-fiber wildcard because a native lodash.map call refuses its interpreted callback. Explicit installed lodash.map4.6.0 source makes the same 53-fiber capture exact, with one passing replay. Both policies repeat without changing application files, captures or budgets. This source policy does not weaken native-execution checks or repair parser semantics.

Icecream17’s 307-fiber capture repeats as exact with one passing replay. Its original page warning identifies the unrecognized `image-src` Content Security Policy directive. The server also logs the documented TypeScript performance-mark getter errors. Neither the directive nor the CRA5/TypeScript5 pairing changes.

After-native checks verify all 583 KaiHotz and 1,803 Icecream17 installed locations and their locked dependency versions. The receipts retain virtual peer identities, original patch locators, non-peer dependency-edge checks and vendored Yarn CLI hashes. Actual Node22.16.0/pnpm10.12.1 and Yarn4.12.0/3.8.7 probes match the dev-server environment. These checks do not prove all package bytes or peer compatibility.

The import preserves all 281 prior raw rows and nested property orders. `/tmp/bippy-parser-game-expansion/two-berry-import-provenance.json` records both imports. The original and source-expanded comparison records, native server logs, failed Corepack probes and corrected Yarn3 descriptor checks remain saved. No calculator input, puzzle, solver action, dialog input or whole-space claim follows.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker passes 60 links and both executable TSX examples. Parser implementation and the latest 3,065-test gate remain unchanged.

The separate Valtio-source trial reached replay but produced no completed result after more than an hour. SIGINT did not stop the owned analyzer. Command and start-time checks preceded SIGKILL; the process and its loopback inspector then exited. `valtio-source-stopped-provenance.json` records the interruption without inventing a verdict or performance comparison. The selected Taxe PFA capture and budget-limited results remain unchanged.

Elden Ring’s completed original analysis records:

- React18.2.0, 8,956 native fibers, eleven commits and no page errors
- A partial match with two known fibers and 8,953 wildcard-absorbed fibers
- Five bounded states, an 18,266-node symbolic tree and one incomplete replay
- Eighteen evaluation budget cutoffs and seven call-depth cutoffs, but only three matcher steps and `report.budgetExhausted:false`

It was unimported while same-capture comparisons ran. Its checked-in regulation data remains unchanged; no rebuild using external game files runs. The wildcard’s reason is `step budget exhausted`, not evidence that the hidden application body matches.

### Copy-on-write collection journal trial

`StaticCollection` now shares read-only entry tables across captures and restores, copying before writes. Joins reuse identical tables after combining write counts and outside-mutation flags. Application values and their allocation identities remain unchanged; these tables are not React’s application-level external-store snapshots. The React checkout’s `mountSyncExternalStore` implementation and the journal’s capture/restore/join consumers informed this distinction.

Thirty-six direct tests cover the four collection kinds. Sixteen table-reuse assertions fail on the baseline, while twenty isolation and mutation tests pass there. The tests cover restoration and joins with uncaptured writable tables, dynamic deletion, retained presence guards, insertion order and escape flags. These assertions check the internal representation, not a newly demonstrated native UI defect.

The initial full candidate-worktree suite fails seven checks that also fail on the baseline worktree. Both worktrees resolve their linked dependencies outside their installation roots, which the parser deliberately rejects. `collection-snapshots-setup-provenance.json` preserves the matching failures, package locations and source hashes under `/tmp/bippy-parser-game-expansion`. Final validation runs in the main checkout with its owned dependencies; no install-root exemption changes.

Main validation passes 3,101 root tests with two existing skips, including 1,055 parser tests across 64 files. Typecheck, build, realm checks, lint, formatting and diff checks pass. The worktree dependency failures do not recur in the owned main installation.

At this checkpoint, seven policies across six independent captures retain five comparison fields, including static diagnostics. These include both KaiHotz policies, Icecream17, EC-82MS, original Taxe PFA, SwiftCalc and the card-memory demo. `collection-snapshots-checkpoint-provenance.json` records these completed checks; Elden Ring’s comparison was still running. The commands preserve source files, captures, budgets and prior diagnostics; neither concurrent timing nor the interrupted Valtio profile establishes an end-to-end speed improvement.

The documentation checker initially treats the new pinned React source URL as a local path and fails. It now fetches HTTPS targets and checks pinned GitHub line anchors against the actual source length. The original failed check remains saved; local path and heading checks remain strict.

### Original library-build recipes

SwiftCalc’s original frozen npm installation runs its `prepare` library build and succeeds. Its tree check verifies 351 installed packages and React18.3.1. The artifact receipt verifies twenty generated files and the original compiler manifests, with an unchanged second check. Native capture records 155 fibers, one commit, no page errors and an exact initial match with one passing replay.

The first card-memory demo recipe incorrectly starts installation from the parent because it assumes `workingDirectory` also controls install commands. `ensureInstalled` actually runs installation at the clone root, so the initial pinned pnpm command fails before npm ci. A separate corrected manifest removes only that leading directory change and completes root installation, the original library build and demo installation. `build-games-install-cwd-correction.json` preserves this recipe error; it is not an original application dependency failure or an application repair.

Both original npm locks remain selected for the root/demo workflow. An explicit nested-scope check verifies 54 root packages and 1,400 demo packages. The thirteen generated dist files and all thirteen demo copies match byte for byte. Original prebuild, build and postbuild logs, source hashes and artifact copies remain saved.

Actual Node22.16.0/npm10.9.2/pnpm10.12.1 and Node16.20.2/npm8.19.4/pnpm8.15.9 runners verify for the two apps. The memory demo’s native capture records eleven React18.2.0 fibers, one commit, no page errors and an exact initial grid-selection page. Both native results agree with baseline/current/repeated checks in all five comparison fields. The following import records both repositories after the remaining checks.

### Two original library-build imports

SwiftCalc and the card-memory demo bring the corpus to 285 distinct GitHub IDs, leaving 215. The seventy-eight additions beyond the historical 207 contain fifty-seven exact, six truncated, nine partial and six mismatch reports. These two additions check initial pages, not calculator operations or card gameplay.

The importer rechecks the memory demo’s explicit nested npm scope as well as the repository root. Fresh identity checks, original locks, actual runners, unchanged artifacts and baseline/current/repeated captures verify before import. `build-games-import-provenance.json` preserves all 283 prior raw rows and their nested property order. `build-games-artifact-provenance.json` and the copied build output preserve generated-file provenance and the original lifecycle logs.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker validates 63 links and both executable TSX examples. The parser implementation and completed 3,101-test gate remain unchanged from `154ea7e4`. At this checkpoint, Elden Ring’s separate collection-snapshot comparison remained uncompleted and uncounted.

### Evaluator-limited Elden Ring import

Elden Ring brings the corpus to 286 distinct GitHub IDs, leaving 214. The seventy-nine additions beyond the historical 207 contain fifty-seven exact, six truncated, ten partial and six mismatch reports.

Both collection-journal comparisons have completed. Original/current/repeated results agree on report, runtime, static diagnostics, state space and replay. The partial result still absorbs 8,953 native fibers through a wildcard after matching only two known fibers. Eighteen evaluation-budget cutoffs, seven call-depth cutoffs and one incomplete replay remain. Three matching steps and `report.budgetExhausted:false` do not establish that evaluation completed or validate the hidden body.

Fresh installation and actual-runner checks verify 414 package locations, React18.2.0, Node22.16.0, pnpm10.12.1 and original vendored Yarn4.8.1. Original regulation data, defaults, source policy, lock and native capture remain unchanged. No external-game-file rebuild or weapon input is supplied. `elden-import-provenance.json` preserves all 285 prior raw rows and nested order.

The completed collection controls now cover eight policies across seven independent captures. `collection-snapshots-completed-provenance.json` aggregates the saved checks, including the two library-build controls, and verifies unchanged candidate/main source and tests.

This receipt does not rerun or replace the 3,101-test gate. Original worktree failures, evaluator/matcher limits and the interrupted Valtio-source trial remain evidence. Concurrent timings do not establish a speed ratio.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker validates 64 links, two executable TSX examples, four server renders and two effect updates.

### Further discovery and second-game preparation

Preparation scripts cloned and pinned fifty remaining game-search repositories and 86 productivity repositories; none count as additions. The productivity searches retain 147 distinct candidates, with 61 separately classified for further review.

Metadata filtering is not proof of web support: the source inventory still contains React Native, desktop, backend and non-React workflows. Twenty productivity source bundles are ready for review. Search receipts describe only the fetched result pages, not every possible repository.

Ten second-game Vite source bundles produced eight original frozen recipes. Lithium Pack Designer fails with `ERR_PNPM_OUTDATED_LOCKFILE`: the lock retains a replicad specifier missing from package.json. Dora’s memory game fails the original React Hooks testing-library optional peer check against React18 type definitions. Neither receives a lock or peer-policy repair. Two other workflows await credentials or a separate original backend/port audit; no credentials or substitute backend are supplied.

Six installed trees and actual runners pass separate audits. Six initial Bippy captures complete with unchanged tracked source: two exact, two truncated and two partial results. Both original truncated memory games retain one omission and incomplete replay. The virtual calculator retains its read-only textarea warning.

At this checkpoint, these six repositories remained unimported pending final checks. Luiz’s original Vite root is `src`, with `src/index.html`; the source collector’s failed root-index assumption remains saved. The recipe uses that original HTML file.

The first repetition helper wrongly passes `--replay`; the CLI rejects it before analysis. Static-only mode already loads a saved capture. After correcting the flag, all six original policies repeat in five fields.

The first expanded manifest then uses unsupported `static.allowlist`; schema validation rejects it before analysis. The corrected experiment uses the declared `externalPackageAllowList` field. Both failed helpers, logs and the invalid manifest remain saved; neither failure is an application or parser-semantics verdict.

Explicit installed Toast/Goober source makes the virtual calculator exact against its unchanged capture. Expanded router, icon and analytics source exposes a repeated Many Games mismatch with no evaluation or matching cutoff. The model retains a loading div beneath `GameCard` where native renders the image next; the original image-load handler clears this loading state. One replay still passes, so the missing event continuation needs independent isolation rather than a replay-based completeness claim.

### Six original second-game captures

Six original repositories bring the corpus to 292 distinct GitHub IDs, leaving 208. The eighty-five additions beyond the historical 207 contain sixty exact, eight truncated, ten partial and seven mismatch reports.

The virtual calculator, Soni’s memory game and AeenPah’s Sudoku match their initial captures exactly, with one passing replay each. The virtual calculator keeps its native read-only textarea warning; its installed Toast/Goober source policy replaces the original opaque comparison. Soni keeps the original Cat API request and reducer lifecycle. Sudoku keeps the initial level-selection popup without puzzle input.

Rafa’s and Luiz’s memory games remain truncated. Each retains three bounded states, one omitted repeat range and three incomplete cases among four assignments. Their outside-enumeration witnesses use lengths eight and twelve; both remain incomplete. The repeats do not establish shuffle or gameplay completeness.

Many Games retains the stronger source-expanded mismatch rather than the sparse policy’s 210 skipped fibers. The native capture records 212 fibers and six commits without page errors. The mismatch repeats without matching or evaluation cutoffs, while internal replay passes. Its image-load continuation remains unresolved; no loading state or image response is fabricated.

Fresh checks verify 294, 542, 109, 639, 105 and 532 installed packages in manifest order. The two Vite2 apps retain Node16.20.2/npm8.19.4/pnpm8.15.9; the four modern apps retain Node22.16.0/pnpm10.12.1 and original npm10.9.2 or Yarn1.22.22. All tracked source and locks remain unchanged. `second-games-import-provenance.json` preserves all 286 prior raw rows and nested order under `/tmp/bippy-parser-game-expansion-two`.

All six original policies and both expanded policies repeat in five comparison fields. The pre-analysis CLI/schema failures, two frozen-install failures, source-review error and original native/server logs remain saved. No budgets or comparisons change.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker validates 65 links and both executable TSX examples. Parser implementation and the completed 3,101-test gate remain unchanged.

Seven further public-repository searches each retain their first 100 results, not all search matches. Their receipts identify 690 distinct candidates after counted-ID exclusions. The next preparation batch selects 100, records 112 separate-review exclusions and leaves 478 eligible candidates unprepared. Preparation is running under `/tmp/bippy-parser-ui-expansion-three`; it adds no corpus rows. Source inventory must still check renderer support and original workflows.

### Productivity capture and launcher audit

Fifteen productivity repositories bring the corpus to 307 distinct GitHub IDs, leaving 193. The selected reports contain two exact comparisons, twelve partial comparisons and one mismatch. The hundred additions beyond the historical 207 contain 62 exact, eight truncated, 22 partial and eight mismatch reports. Fresh installed-tree and actual-runtime checks pass for all fifteen additions; all 292 prior raw rows and nested property order remain unchanged.

Two original `.npmrc` files already set `legacy-peer-deps=true`: ShadcnDashboard and Nedo’s Mantine Dashboard. The harness preserves that authored policy rather than adding a peer override. Nedo installs React19.0.0 alongside Helmet’s React16–18 peer declaration; version fidelity does not establish peer compatibility.

Three Node16 runtime probes fail before application execution because pnpm11.25 adds an ESM `--import` loader during `dlx`. Its installed source also explains why the original noninteractive installs succeed with a different global-store default. A separate pre-capture recipe pins only their outer launcher through `corepack pnpm@11.20.0`. The inner Node16/pnpm8/npm8 or Yarn1 versions remain unchanged, and development does not set `CI`.

Focused reads cover all fifteen launch bundles without truncated output. Startup checks preserve the original Mock Service Worker files and activation branches. They also preserve automatic demo seeding, guest authentication, settings scripts and the header-only financial CSV. Optional caller configuration remains absent; no credentials, responses, uploads or stored state are supplied.

Fourteen initial captures produce reports: thirteen partial and one mismatch. All fourteen original policies repeat twice against identical saved captures with five comparison fields unchanged. Type retains its Fragment/button mismatch and native nested-button warning. Muzi retains twelve evaluation-budget diagnostics despite an unexhausted matcher budget, plus 9,437,908 reported omissions.

Melau’s original navigation times out after 120 seconds without a saved capture. The repeat helper then attempts that absent file and fails before analysis; both failures remain recorded. A fresh native attempt succeeds with unchanged source, commands and budgets, producing 590 fibers, 117 commits and a partial report. Both replay runs preserve all five comparison fields against that fresh capture, with passing sampled replay.

Separate installed-source policies make Joyce’s and Wafa’s initial comparisons exact and repeatable. Hari remains partial, with passing sampled replay. Clean Notes’ source-policy trial produces no result after a long CPU-active run. Sampling and ownership-checked interruption receipts preserve the attempt; neither a source-policy verdict nor a performance comparison follows. These policies do not repair interpreter semantics or establish complete application behavior.

Evidence is under `/tmp/bippy-parser-productivity-expansion`, including `vite-before-native-audit-provenance.json`, `vite-outer-runner-provenance.json` and per-run comparison receipts. Mini Notes remains deferred: its tracked environment file declares Supabase service-role fields. Their values are neither printed nor used, and backend ownership remains unverified.

The previous 100-repository preparation finishes and yields 193 package inventory rows, not 193 accepted applications. The next batch reuses exact discovery evidence, excludes prepared IDs and selects another 100 repositories. It records 212 separate-review exclusions and 378 remaining eligible candidates under `/tmp/bippy-parser-ui-expansion-four`. That preparation finishes with 47 pinned repositories and 53 retained failures, including network timeouts. No preparation, installation or incomplete analysis increases the corpus count.

Data validation passes root typecheck, fifteen manifest tests, schema/identity/raw-order checks, formatting and diff checks. The documentation checker validates 66 links and both executable examples. Parser implementation and the completed 3,101-test gate remain unchanged; repository count does not satisfy the causal-workflow acceptance requirements.

### Source-only causal-workflow investigation

The Many Games investigation is in `/tmp/bippy-many-games-causal-investigation/`. It uses the original repository at `20eb384862f322a5d4b07c126f951719f3ec44eb`. Both the home and memory-game source-only models were saved before their respective new browser traces. Neither model received captured observations. Both remain unresolved: the interpreted router reports a possible throw, `useRouteError can only be used on routes that contain a unique "id"`. This is not a native application error or an image-membership contradiction.

Nine diagnostic ablations use only fields from the older unchanged capture. Removing its `windowKeys` reproduces the unresolved render. Retaining the original required page fields and `windowKeys` restores the two-state model, even without captured router state. That model still mismatches the original home capture in 155 matcher steps, without matcher exhaustion. These are observation-conditioned diagnostic results, not an upfront source-only success. The router reads `window.__staticRouterHydrationData`. This ablation did not yet trace that read directly or attribute the whole failure to it.

The fresh home trace records thirteen resource/DOM frames and seven Bippy commits. Four received image bodies match the original tracked assets. The trace observes empty-source errors, later load events, and spinner removal. Source inspection finds two missing causal mechanisms: host function attributes become no-ops in `Materializer.toAttribute()`, and DOM observer callbacks escape at construction while observe/unobserve/disconnect are no-ops. Merely escaping image handlers would not establish valid resource-event ordering or observer lifetimes.

The memory-game plan defines expectations from source before collecting its interaction trace. The trace contains 95 frames, thirty Bippy commits, and no page errors. Checks confirm tutorial interval registration and cleanup, no subsequent callbacks within the recorded closed windows, fresh tutorial state on reopening, score transitions `1 → 1 → 2 → 0`, and board removal with observed resize-listener removals. Tile IDs are distinct in this witness; the original short ID generator does not guarantee uniqueness. The tutorial was closed before navigating home, so navigation with an active tutorial interval was not tested. Host API calls and selected actual hook states are observed; original handler/setter calls and subscription ownership are not fully instrumented. These checks validate hand-authored expectations, not an analyzer-generated transition model.

The tutorial exposes a reducer-phase issue. Its interval dispatches an action, then increments a ref. The reducer ignores its action and reads that ref when React renders. Native React 18.2 shows tutorial indices 13 and 12, then 13 after remount. A minimized, independently captured React 19.3 fixture confirms the analyzer instead reduces immediately: its tree contains `"0"`, while the browser contains `"1"`. The mismatch uses four matcher steps, no wildcards, and no exhausted budget; same-interpreter replay passes. `stateHook()` calls `reduce()` while dispatching and caches that dispatch closure. A repair must investigate pending actions, current reducer closures, guarded queues, and render-phase ordering—not merely defer a callback by a guessed timeout.

The minimized probe's missing factory `await` remains a helper failure. Its corrected attempt saved the model, capture, and comparison before the outer 120-second command timed out. No surviving probe process was found, and the temporary fixture directory was removed. The result is evidence, not a clean execution-gate completion. At that checkpoint, no analyzer semantic repair or rewrite had been made. Corpus count remained 307; the real-workflow and whole-space acceptance gates remained open.

### Reducer action queues

The candidate now queues directly evaluated reducer actions and applies them during the next hook pass. The pass uses the current reducer closure. Heap journals preserve conditional queues, including shared prefixes, absent dispatches, and later actions. Action objects retain their identity, so reducers observe writes made after dispatch. An unbounded dispatch loop remains unknown rather than becoming one optional action.

The repair follows the cloned React `ReactFiberHooks.js` at `82c44beb444eda5230c063eaa163d01f38817211`. It distinguishes pending work from changed state, preserves effects on no-op bailouts, and invalidates cached renders when materialization throws. Failed branches retain actions for recovery; retry batches don’t become newly dispatched render-phase updates. Strict Mode checks differ between normal updates and render-phase rerenders.

Independent fixtures exposed defects during development:

- The baseline reduced against stale refs and reducer closures. The initial tests failed twice; the no-op effect control passed.
- The first queue candidate missed Strict Mode’s duplicate update check. A later candidate incorrectly duplicated render-phase reducer calls. Both wrong trees passed internal replay.
- A throwing reducer initially reused an earlier successful render during error recovery.
- A guarded throw disappeared from the primary model because a tuple contained the throwing branch. A raw-model assertion caught the missing fallback despite ordinary comparison checks passing. The hook now returns separate throwing and successful tuple branches.

The focused tests check action identity, guarded ref writes, current closures, effect bailouts, both Strict Mode phases, and render-time errors. Raw enumeration checks require the guarded totals `0`, `40`, and `500`, and both normal and error-boundary outcomes. These checks do not substitute for a transition system or whole-space proof.

The queue candidate matched the identical saved React 19.3 browser capture twice, without runtime observations or fixture changes. Results remain in `/tmp/bippy-many-games-causal-investigation/reducer-ref-phase-queue-*.json`. The helper completed its assertions but did not exit. At completion, its resource inventory listed a `MessagePort` and `Timeout`. Its owned process was sampled, identified again, and terminated; the nonzero execution receipt remains. No cleanup or performance success is claimed.

Five saved-capture corpus controls completed twice without changes to `report`, `runtime`, `static`, `stateSpace`, or `stateReplay`. They cover Joyce, Wafa, Hari, Virtual Calculator, and Many Games. The first control helper used the unsupported `--output` flag; both failures remain. A new helper uses the documented `--results` flag and separate files. Final controls also completed twice after the guarded-throw and render-phase refinements; all five fields remained unchanged.

Evidence includes `/tmp/bippy-reducer-phase-baseline.log`, `/tmp/bippy-reducer-phase-expanded-first.log`, `/tmp/bippy-reducer-strict-render-phase-before.log`, and `/tmp/bippy-reducer-phase-guarded-trace-visible.log`.

Final review also separates actual state changes from queued work when a pending reducer becomes escaped. A regression checks that the eager state change is not mistaken for a reducer-only no-op.

The final gates passed root typecheck, 3,118 root tests with two skips, 1,072 analyzer tests across 65 files, build, and realm checks. The receipt is `/tmp/bippy-reducer-queue-state-gate-validation.exit`. The five corpus controls again remained unchanged in both runs. Earlier gates and controls remain separate.

The source-only router failure, escaped-dispatch timing, lane priorities, SDK lifecycle cleanup, and broader causal-model gates remain open. Corpus count remains 307.

### Source-only router read trace

After the queue repair, a pass-through wrapper records the interpreter’s global property reads without changing their results. Original `react-router-dom/dist/index.js:218` reads `window.__staticRouterHydrationData` as an unknown value under both the source-only policy and original minimal page observations. Adding only the original captured `windowKeys` makes that read known `undefined`. The original key list does not contain the hydration property.

The first two models remain unresolved. The original-key policy still produces the two-state mismatch, not a source-only success. These reads confirm one observation-dependent value change; they do not establish that this property alone causes the entire router failure. Further source review identifies the error-dependent `findIndex`/`slice` path before `useCurrentRouteId()` as a tracing target, not a confirmed defect.

All three traces finish with exit zero. They preserve application source and the saved capture, and record only property names, source locations, value kinds, and truthiness. They neither supply new observation values nor execute application component bodies natively. Artifacts remain in `/tmp/bippy-many-games-causal-investigation/router-global-read-trace-*.json`; `/tmp/bippy-router-global-presence-trace.log` retains the interpreted key warning. Corpus count remains 307.

### Finite Math arguments in the router

A second pass-through trace locates a precision loss in original router code. `findIndex()` returns four concrete possibilities: `0`, `1`, `2`, and `-1`. After addition, `Math.min(3, errorIndex + 1)` loses those alternatives and returns an unknown number. The following `slice()` loses its known route objects. The trace records numeric argument shapes, not application string contents; depth-four truncation affects the diagnostic projection, not the analyzer budget.

The candidate distributes numeric Math arguments while their Cartesian product stays within the existing eight-combination limit. It preserves guards, preference, signed zero, and `NaN`. Object and bigint coercion remain outside this distribution. Twelve baseline checks fail; sixteen focused Math checks now pass, including two independent React fixtures and raw-model assertions. A test initially imported `nativeFunction` from the wrong module; that helper failure remains separate.

The new router trace confirms that `Math.min()` and `slice()` now preserve four finite alternatives and their route objects. It also falsifies a complete repair claim: both source-only and minimal-page runs still fail at the route-ID assertion. Later reads now include known route objects alongside optional or absent values. Callback execution against a branched receiver, including reads of the original array through a closure, is the next tracing target. No runtime observations were invented to suppress this failure.

Root typecheck, 3,136 root tests with two skips, 1,090 analyzer tests across 66 files, build, and realm checks pass. Five saved-capture corpus controls repeat without changes to `report`, `runtime`, `static`, `stateSpace`, or `stateReplay`.

Logs use `/tmp/bippy-math-finite-*` and `/tmp/bippy-math-corpus-lane-*`. Before/after traces remain in `/tmp/bippy-many-games-causal-investigation/router-operation-{trace,after-math}-*.json`. Corpus data and repository count remain unchanged at 307.

### Keep callback reads under the selected receiver

The ordinary map and reduce closure controls already pass. A smaller route-context fixture exposes the missing precision: a callback spreads a prefix of its captured array into a provider. The interpreter evaluates that closure against every receiver alternative, including an empty array that cannot invoke the callback. The primary model contains a wildcard where native React reads known route IDs.

`callAlternatives()` now combines each resolved choice with the caller’s guard. It restores that guard after each path and joins mutations under the branch’s original predicate. React’s `pushProvider()`, `readContextForConsumer()`, and `popProvider()` confirm that the consumer reads the selected provider value; the fix changes interpreter evaluation, not React context behavior.

The first candidate passes 1,096 analyzer tests but fails a new argument-correlation check. It caches the first receiver path’s arguments, producing `root,child,root` where the second path requires `root,child,root,child`. Each receiver path now evaluates its own arguments, including their conditional side effects. Eight focused fixtures check context prefixes, generated choices, nested guards, closure reads, concatenation, argument counts, and optional short-circuiting.

The unchanged original router now renders under both source-only and minimal-page policies. Both comparisons remain partial: the matcher absorbs 56 of 211 native fibers through a subtree omitted two alternatives away from the preferred path. Their bounded models contain 12 states and seven wildcards, with one reported subtree omission. The original key-list control retains its image-loading mismatch; neither the hydration value nor any observation changes.

Separate home and `/memorymatch` models now freeze without opening saved captures or installing observers. Each enumerates 12 bounded states and reports the same subtree omission. The React version comes from interpreted rendering, not an independent capture. These models remain guarded trees with omitted route content, not extracted transitions or verified memory-game workflows.

Evidence remains under `/tmp/bippy-many-games-causal-investigation/`:

- `router-operation-scoped-*.json` and `router-operation-fresh-arguments-*.json`: successive diagnostic candidates
- `source-only-call-guards-home-model.json`: SHA-256 `3e4e590977d6e772d8002bb77ff160f1076fc965e0a3d65d1d8f65c4c7a13254`
- `source-only-call-guards-memory-model.json`: SHA-256 `11d5d5a22c0298e8b10328ca387e4beb9494cd1f478df98dc9fc06a88565a5cf`

Five saved-capture corpus controls repeat with no changes to the five comparison fields. The first root gate has one conformance child-process failure: the frozen-bind test reports `status: null`. Its 60-second subprocess limit does not establish why the child stopped; the gate retains exit 1. An unchanged isolated rerun passes all 144 bind tests.

The reviewed gate passes 3,152 root tests with two skips and 1,106 analyzer tests across 67 files. Root typecheck/build and realm checks pass; `/tmp/bippy-callback-reviewed-validation.exit` records 0. The source-only freeze helper also exits 0. Earlier failures remain separate; corpus data still contains 307 repositories.

The first provenance helper exceeds the child-process stdout buffer while reading corpus JSON. Its failure log remains intact. The replacement checks Git blob IDs and records SHA-256 hashes without changing analyzer budgets; `call-guard-reviewed-gates.json` records the verified controls and frozen models.

### Check the remaining omission and predicate searches

Retrospective comparisons check the frozen call-guard models against unchanged independent traces. All 13 resource snapshots and all 40 saved memory-workflow snapshots remain partial. The other 55 memory frames contain no snapshot and do not enter the comparison. The memory model also partially matches seven snapshots after navigation home, which does not establish route or action reachability.

The pass-through depth trace observes nine branch materializations and three cutoff calls. Both alternatives remain feasible at each cutoff under the existing guard solver. This does not support treating those branches as already decided or bypassing the depth budget. The cutoff calls merge into one reported subtree omission.

Original `findIndex()` code exposes another defect: `testItems()` evaluates every predicate before selecting a result. The reverse search variants also evaluate predicates forward, and thrown predicates do not stop that evaluation. Four initial independent fixtures fail. Their logs remain in `/tmp/bippy-array-search-baseline.log`.

The `find` family now traverses in the requested direction and stops after a match or throw. An internal continuation symbol distinguishes unfinished paths from legitimate return values; scoped alternatives preserve conditional callback mutations and result guards. The loop captures the original length but reads each element when visited, and it passes the predicate’s receiver. Conditional choices follow predicate preferences during traversal rather than ranking an eagerly evaluated verdict list.

A second failure shows why a known throw must not count as an opaque call. `callBuiltin()` had escaped a callback’s captured mutations even after interpreting its exception. It now skips that escape for a known thrown result. Seven focused fixtures cover order, guarded counts, throws, live writes, initial length, callback receivers, and guarded catches; their primary models have no omissions or replay mismatches.

The original guarded-list/interpolation fixture still produces an imprecise text value. Its unchanged source remains at `/tmp/bippy-array-search-guards-optional-join.tsx`; the failure remains in `/tmp/bippy-array-search-known-throw.log`. A separate scalar-count fixture checks conditional invocation without claiming to repair that text/list gap. At this checkpoint, `some()` and `every()` still use the older predicate helper and remain separate work.

The reviewed source-only home and memory models retain 12 bounded states, seven wildcards, and one subtree omission. Their trees and states differ from the call-guard checkpoint even though their summaries match. Fresh retrospective comparisons still report 13 and 40 partial snapshots. No source observations, new native traces, or larger budgets enter these runs.

Evidence remains under `/tmp/bippy-many-games-causal-investigation/`:

- `call-guard-*-saved-workflow-comparison.json` and `call-guard-saved-workflow-summary.json`
- `entailed-alternative-depth-trace.json`
- `router-operation-search-*.json` and `array-search-source-model-comparison.json`
- `source-only-array-search-reviewed-home-model.json`: SHA-256 `550ce6a67d624acf59f17be42d225f9112c9dc112f5f26705935ff6dd515f3a6`
- `source-only-array-search-reviewed-memory-model.json`: SHA-256 `5646a00f0d07d7acbfcb18c28c2565d262d17eea16fdbc5dd643e995e7187ced`
- `array-search-*-saved-workflow-comparison.json`

Root typecheck, 3,166 root tests with two skips, 1,120 analyzer tests across 68 files, build, and realm checks pass. `/tmp/bippy-array-search-final-validation.exit` records 0. Five saved-capture corpus controls repeat without changes to their comparison fields. Corpus data remains unchanged at 307 repositories.

### Short-circuit quantifiers and finite list guards

The first `some()`/`every()` regressions expose eager callback execution and lost throws: three fixtures fail, while unconditional shrinking already passes. The shared search traversal now stops when a quantifier decides its result or a predicate throws. It captures the initial length and passes the callback receiver. Later calls read live elements under their continuation guards.

Quantifiers also check index presence before invoking a predicate. This does not add sparse-hole semantics.

Conditional shrinking exposes a separate correlation loss. The journal had widened finite non-appending mutations into repeats. It now joins finite, nonrepeated list paths by position without replacing the shared list object. Spreads preserve guarded suffix positions rather than turning finite length choices into repeats. Index-presence queries use supported guarded lengths. Repeated mutation counts remain unbounded.

Pass-through traces show that guarded length calculation also failed on a definite prefix: `distributeBinary()` returns null for two primitive operands. Adding that prefix directly restores the existing guarded sum. The conditional-shrink regression now has only `full:false:3` and `short:false:1`; no increment-operator change or extra presence input is needed on these paths. The finite-spread and guarded replacement fixtures also become concrete.

Ten component fixtures assert exact raw text sequences, no omissions, exact native membership, and no replay mismatches. A shared test helper preserves the existing search and callback assertions, including their original text separators.

Seven direct tests cover these cases:

- Guarded lengths and index presence
- Restoration and preferred shrinking
- Positional replacement
- Preferred empty spreads
- Retained unbounded mutation counts
- The existing 16-pair limit for independent length sums

The first five tests produce four failures on baseline `b2304660`; the unbounded control passes. The expanded seven-test baseline produces five failures and two passes. Both runs remain at `/tmp/bippy-quantifier-finite{,-expanded}-baseline.log`; the worktree preserves both test files separately.

A later regression exposes eight outcomes where two independent presence conditions permit only four. `/tmp/bippy-quantifier-independent-presence-baseline.log` retains that failure. The earlier 3,189-test gate had passed without this fixture. `getCombinedListCount()` now distributes both operands recursively and adds primitive counts directly. The fixed fixture preserves all four source-derived flag/count combinations without a separate presence decision.

Length sums use the shared value-distribution limit of 16 pairs, not the numeric `Math` limit of eight. A first boundary test assumes the wrong limit and fails. Corrected tests distinguish eight independent optional positions from nine: the latter requires 18 pairings at the final sum and retains ranged uncertainty. No limit changes.

A further predicate counterexample produces four catch-label/count combinations instead of the two source-derived expectations. The predicate can throw on its first call or complete two calls. The failed strict test remains in `/tmp/bippy-array-quantifier-expanded.log`.

Copies at `/tmp/bippy-pending-array-quantifier-guarded-throw.tsx` and `/tmp/bippy-pending-array-quantifier.test.ts` preserve its unchanged fixture and test. This checkpoint does not count them as passing coverage. The surrounding throw propagation and `try`/`catch` joins remain investigation targets, not a completed repair.

Three temporary controls use the main analyzer through absolute imports, despite running from the baseline worktree. The quantifier and plain-call controls both produce four combinations. A direct `try`/`catch` instead produces only `caught:2` and `returned:2`, omitting the valid `caught:1` path. All three initial native witnesses happen to match, and all replay samples pass.

Four predeclared, unforced repeats of the unchanged direct fixture capture both native outcomes. Attempts 0 and 3 produce `caught:1` and mismatch in six matcher steps without budget exhaustion. Attempts 1 and 2 produce `returned:2` and match exactly. All four still pass replay. The `pending-throw-*-comparison.json` files preserve these native test-host renders; they are not browser workflows or added corpus repositories.

The `/tmp/bippy-array-quantifier-*.log` files retain the baseline, conditional-presence, guarded-presence, finite-list-baseline, and finite-list-first failures. Matching JSON files retain the pass-through value, presence, journal, and length traces. The reviewed code contains no temporary wrappers.

The first direct-test attempt incorrectly requires shared wrapper identity for an equal primitive value; the corrected assertion checks its value. The first full gate reports a missing location argument in that new test; `/tmp/bippy-quantifier-final-validation.exit` retains the failure. Lint also identifies an unnecessary spread in the fixture. The revised fixture mutates the original after copying, checking that the spread preserves the earlier elements.

The first quantifier source-only models still contain 12 bounded states, seven wildcards, and one subtree omission. Both retain unknown hydration inputs and unchanged budgets. Under `/tmp/bippy-many-games-causal-investigation/`, the home model is `source-only-quantifier-reviewed-home-model.json` (SHA-256 `199729bf37d80be93c49ff03f412e1aacb3a7c6f190d90fdcbc122bd08e75af0`); the memory model is `source-only-quantifier-reviewed-memory-model.json` (SHA-256 `50b38a4c719cb30d0bff464332a9dac41347de728edcd62c8eeb88af7cd2ecc4`). Each records the interpreter and all four changed evaluator-file hashes.

After the recursive sum repair, new source-only models retain the same state, wildcard, and omission counts. The files are `source-only-quantifier-sum-reviewed-home-model.json` (SHA-256 `dc5a1f2a5c0a7b2be6b820db9d78567757b033a7e3ec8b9a0e31c95146acc7c0`) and `source-only-quantifier-sum-reviewed-memory-model.json` (SHA-256 `41227bdc69af8196759c3d94bda81886cc895b922154cf628e1cfbbd005074c7`). Earlier models and receipts remain unchanged.

The frozen models still partially match all 13 saved resource snapshots and all 40 saved memory-workflow snapshots. These are retrospective snapshot membership checks, not transition extraction or reachability evidence. Five corpus controls repeat against identical captures without changes to their five comparison fields; `quantifier{,-sum}-corpus-lane-{0,1}.json` records both rounds. Corpus data remains unchanged at 307 repositories.

At the quantifier checkpoint, source-only analyses also repeat the seven throw checks against their identical saved native snapshots. The `pending-throw-sum-*-comparison.json` files record the same raw-model failures and two native mismatches, still with passing replay. These controls perform no new native application renders.

The final sum gate passes 3,193 root tests with two existing skips and 1,147 analyzer tests across 70 files. Root typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-quantifier-sum-validation.exit` records 0; `quantifier-sum-reviewed-gates.json` records the models, controls, baseline failures, and open throw counterexamples. The earlier finalized gate and `quantifier-reviewed-gates.json` remain separate. These gates do not complete causal-model, renderer, or 500-repository acceptance.

### Guarded completion, catches, and finalizers

The three retained throw counters fail on `27a5f31f`: direct `try`/`catch` omits `caught:1`, while plain-call and quantifier variants admit four label/count combinations. The new `throw-paths.test.ts` reproduces them before any repair. Actual React source still routes uncaught rendering errors through `ReactFiberThrow`; it cannot repair a lexical catch that reads the wrong interpreted state.

Statement outcomes now retain a completion condition separately from their returned values. Forked statements and the remaining statements run under their selected guards. Throw propagation keeps the full result’s predicate rather than reconstructing a decision from filtered exceptions. Later declarators run only when earlier initializers complete.

A `try` body retains local snapshots from abrupt paths for its handlers and finalizers. Calls still create fresh evaluation contexts, so that local-preservation flag does not leak into callees. Catch selection uses the throwing paths’ guards, and filtering errors or survivors preserves the original choices, preferences, and payload correlations.

Further regressions expose losses through nested finalizers and early returns. Normal completion and abrupt exits now select their own finalization paths. A finalizer failure can replace an earlier return. The implementation still does not establish complete exception, loop, or asynchronous semantics.

Heap tests expose two additional defects in the candidate: reordered deferred snapshots receive the wrong guards, and nested terminal paths defer joins they no longer need. Deferred guards now follow snapshot order. Fully terminal paths join immediately; actual loop jumps retain deferred treatment. No budgets change.

Fourteen component fixtures require exact raw sequences, no omissions, exact native membership, and no replay mismatches. Three direct completion/filtering tests fail on baseline `27a5f31f` and pass after the repair. The baseline worktree `/tmp/bippy-completion-baseline` preserves its test copy; its dependency links do not substitute for the main-owned final gates.

Failure logs remain separate under `/tmp/bippy-throw-path-`:

- `baseline.log`
- `expanded.log`
- `finally-before.log`
- `return-heap-before.log`
- `nested-return-heap-before.log`

The early 1,153-test package gate passes before the expanded regressions expose those gaps. Later focused logs record each correction; no test relaxes its expected sequences.

The seven original native throw snapshots now match without replay mismatches, including the two former `caught:1` contradictions. The `pending-throw-completion-*-comparison.json` files record source-only analyses against the identical saved snapshots. They perform no new native application render, supply no observations, and check the raw model before replay. Their results concern these fixtures, not every possible exception path.

New original-app models still omit route content. The files remain under `/tmp/bippy-many-games-causal-investigation/`:

- `source-only-completion-reviewed-home-model.json`: SHA-256 `0dc402eb0ad40e4018da9617470f2bbedddc8620cfd86a306a57a6f005b2b7e9`
- `source-only-completion-reviewed-memory-model.json`: SHA-256 `e9ae1ec4cb8411081b8ddcdf372617ca952b332836b2cf5c1a823195fe903a72`

Each model has 11 bounded and enumerated states, with 13 inputs and 18 guards. Seven wildcards and one subtree omission remain. The prior 12-state models remain intact; the changed state count does not establish complete reachability.

All 13 saved resource snapshots and 40 saved memory snapshots still compare partially. Five corpus controls repeat against identical captures with no changes to their five comparison fields. Corpus JSON remains unchanged at 307 repositories. These are snapshot comparisons, not an emitted transition system or new workflow discovery.

Final gates pass 3,224 root tests with two existing skips and 1,178 analyzer tests across 72 files. Root typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-throw-path-final-validation.exit` records 0; `completion-reviewed-gates.json` records the evidence. Causal-model, renderer, and 500-repository acceptance remain incomplete.

### Short-circuit logical assignments

Four source-derived probes expose assignment defects after `2aba4984`. They use main production through absolute imports, although `/tmp/bippy-completion-baseline` hosts the temporary runner. Their first native snapshots and strict failures remain under `assignment-boundary-*-comparison.json` and `/tmp/bippy-assignment-boundary-baseline.log`.

React’s DevTools store uses `||=` to avoid further recursive collapse calls once a change occurs. Its Fizz tests use `??=` to avoid constructing replacement promises. The checkout at `82c44beb444eda5230c063eaa163d01f38817211` preserves these sources; this repair does not claim DevTools or Fizz integration coverage.

`evaluateLogicalAssignment()` now selects the current value’s alternatives under their guards. Kept paths skip both the right-hand operand and the write. Assigned paths evaluate the operand under the selected guard, then write only successful results. A throwing getter stops the right-hand operand as well. Unknown truthiness or presence still produces a guarded decision with the existing budgets.

Ten fixtures cover the three logical assignment operators. They check guarded effects and identity, including unknown booleans and exceptions. All ten strict raw-model checks fail on `2aba4984` in `/tmp/bippy-logical-assignment-baseline`; all pass after the repair. Each requires no omissions, exact native membership, and no replay mismatches.

The unchanged saved logical-assignment snapshot now matches the expected `kept:old:0` and `set:new:1` states. Seven saved throw controls remain exact as well. These comparisons perform no new native renders and supply no observations.

The other three assignment probes remain unresolved:

- Scalar assignment emits `caught:new` instead of `caught:old`
- Member assignment evaluates the right-hand operand before its receiver and writes the surviving value on the throwing path
- Computed-key assignment emits an invalid `returned:RK:old` state and an unconstrained text node

The first two still mismatch their identical saved native snapshots, with six matcher steps and no budget exhaustion. The computed-key comparison reports exact, but its unconstrained text cannot establish the declared concrete outcomes. All four assignment replays pass, including those unresolved cases. `/tmp/bippy-logical-assignment-saved-boundaries.log` retains three strict failures and the repaired logical case’s pass.

Retrospective source-only models preserve the three unresolved trees under `assignment-reference-logical-reviewed-*-model.json`. Those models use neither observations nor replay, but they follow the existing native snapshots. They are not pre-trace evidence. Receiver/key evaluation order and reuse, ordinary assignment on throwing paths, and broader assignment semantics remain open.

New original-app model files retain 11 states, seven wildcards, and one subtree omission. Their enumerated states and conditions match the completion checkpoint; rendered capture timestamps and the interpreter hash differ. The files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-logical-assignment-reviewed-home-model.json`: SHA-256 `8e9781cd1f40cd069836a9fb1165b7991ceb809b0582bf3e8f02d57c75a98fd0`
- `source-only-logical-assignment-reviewed-memory-model.json`: SHA-256 `8b393dc527b9023ee12e5eed3b51ba55319e8514533db15f94968361c5b8cc12`

All 53 saved workflow snapshots still compare partially. Five corpus controls repeat unchanged against identical captures. The corpus remains at 307 repositories; no fixture or preparation increases that count.

Final gates pass 3,244 root tests with two existing skips and 1,198 analyzer tests across 73 files. Typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-logical-assignment-final-validation.exit` records 0; `logical-assignment-verified-gates.json` records the evidence.

The earlier receipt compared absent top-level `states` fields; the corrected check compares the serialized model wrapper and its 11 states. The causal-model, renderer, and 500-repository gates remain incomplete.

### Capture assignment references before evaluating values

The scalar, receiver, and computed-key counterexamples now produce their original source-derived outcomes. Their unchanged saved native snapshots compare exactly, without observations or new native renders. The computed-key model no longer relies on unconstrained text to match that snapshot.

`evaluateReference()` captures receivers and computed-key expressions once. Its read/write callbacks retain those values even if the right-hand operand changes the source bindings. Nested references retain their parents for existing component-wrapper replacements, without evaluating those parent expressions again.

`continueValue()` distributes branched values under their existing guards and stops known throwing paths. Ordinary assignments write only successful operands. Compound and update expressions read the captured reference first; logical assignments reuse it after short-circuit selection. Object setter failures now propagate instead of disappearing inside `assignProperty()`.

The React checkout still shows direct `ref.current` writes in `ReactFiberCommitEffects.js`. The ECMAScript source at `/tmp/bippy-assignment-reference-spec.html` distinguishes reference evaluation from `GetValue` and `PutValue`. In particular, `a[b] = c` evaluates the key expression before `c`, but can defer object-key coercion until the write. This repair preserves key expressions, not complete coercion semantics.

Eleven component regressions fail on baseline `bd2f896d` and pass after the repair. They check reference identity and guarded evaluation, including object setters and numeric update ordering. Each requires exact concrete states, no omissions, exact native membership, and no replay mismatches. `/tmp/bippy-assignment-reference-baseline` preserves the baseline source and test copies; main-owned gates remain separate from its dependency-linked run.

The initial typecheck failure remains in `/tmp/bippy-assignment-reference-first-typecheck.log`: an unused import and pattern nodes passed to the expression unwrapper. Explicit pattern handling and import cleanup resolve those errors. The early 1,204-test package pass precedes the expanded regressions and is not the final gate.

The four original assignment snapshots and seven previous throw snapshots all remain exact. Their new receipts use `assignment-boundary-reference-reviewed-*-comparison.json` and `pending-throw-reference-reviewed-*-comparison.json`. Earlier failures remain intact.

Four adjacent probes remain failures, not passing coverage:

- Getter-only writes return normally instead of throwing in the tested module
- Null receivers omit the caught outcome
- Numeric postfix updates omit primitive coercion and produce unconstrained text
- Proxy setter failures disappear instead of reaching the catch

The fixtures and strict tests remain under `/tmp/bippy-assignment-reference-baseline/packages/bippy-analyzer/tests/fixtures/reference-limits`. They import main production through absolute paths. `/tmp/bippy-assignment-reference-limits.log` retains all four failures and `reference-limits-*-comparison.json` stores their native snapshots and raw states.

Getter-only and proxy writes mismatch their native snapshots with four matcher steps and no exhaustion. The first null-receiver snapshot happens to match the valid receiver path. Four predeclared, unforced repeats capture the missing caught path in attempt 0; that comparison mismatches, while attempts 1–3 match. Every replay still passes. Numeric coercion reports exact despite unconstrained text, so that report does not prove its concrete expectation.

The original-app model remains incomplete. New frozen files retain the same serialized trees, conditions, and 11 states as the logical-assignment checkpoint:

- `source-only-assignment-reference-reviewed-home-model.json`: SHA-256 `9fe18589c38db564c55a152d6725d6bb6548a064487fecca063ea116985068d9`
- `source-only-assignment-reference-reviewed-memory-model.json`: SHA-256 `440c065df40e5af8b20128d1a536ae195b8aa41746e8089dea63b341d659a68f`

Both models retain seven wildcards and one subtree omission. All 53 saved workflow snapshots still compare partially. Five corpus controls repeat unchanged against identical captures, and corpus JSON stays at 307 repositories.

Final gates pass 3,266 root tests with two existing skips and 1,220 analyzer tests across 74 files. Typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-assignment-reference-final-validation.exit` records 0; `assignment-reference-reviewed-gates.json` verifies the evidence. Complete assignment, causal-model, renderer, and 500-repository acceptance remain unmet.

### Primitive updates and guarded argument failures

The retained string-update probe now emits `number:1:2`, matching its original native snapshot. Previously, its unconstrained text matched that snapshot while failing the source-derived concrete expectation. The new comparison supplies no observations and performs no new native render.

The update evaluator converts known primitives before arithmetic and returns the converted old value for postfix operations. BigInt values bypass Number conversion. This preserves signed zero and non-finite Number results in the tested cases. It does not repair object or symbol coercion.

The numeric-only candidate passes five update fixtures, then fails the setter case wrapped in `String()`. Its four label/backing-value combinations expose another lost guard in `callValue()`. `/tmp/bippy-update-primitives-first.log` preserves that failure.

`callValue()` now selects the first potentially throwing argument’s alternatives under their original guards. Successful alternatives can invoke the callee; throwing alternatives preserve their errors. This removes the independent `throwing argument` decision that detached callee effects and error payloads from their causes. It also prevents a later guaranteed throw from replacing an earlier possible throw in the returned outcome.

Six update regressions and two argument regressions fail on baseline `8129316e` and pass after both changes. They require exact concrete states, no omissions, exact native membership, and no replay mismatches. The baseline worktree `/tmp/bippy-update-primitives-baseline` preserves identical test and fixture copies. `/tmp/bippy-update-primitives-expanded-baseline.log` retains all eight failures.

The same saved native snapshots still check the earlier repairs. Four assignment snapshots and seven throw snapshots remain exact. The eight reference-limit comparisons now have one strict pass for numeric conversion and seven retained failures. Getter-only and proxy writes still mismatch, as does null-reference attempt 0; every replay still passes.

A deterministic argument-order probe remains wrong. Its first argument increments a counter and throws; JavaScript never evaluates the second argument or invokes the callee. The analyzer emits `caught:2:0` instead of native `caught:1:0`. Its report mismatches in four matcher steps without exhaustion, but replay passes.

The fixture and strict failure remain under `/tmp/bippy-update-primitives-baseline/packages/bippy-analyzer/tests/fixtures/pending-argument-order.tsx` and `/tmp/bippy-update-primitives-pending-order.log`. `pending-argument-order-updates-comparison.json` preserves source, production, raw-model, and native evidence. It is not passing coverage. Fixing invocation guards does not repair `evaluateArguments()` sequencing.

The original-app model remains unchanged apart from render timestamps and production provenance. New files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-update-primitives-reviewed-home-model.json`: SHA-256 `4c698e368c6db994a78fc627f150023859ee3b8f2db5ec0f899299dd6efae561`
- `source-only-update-primitives-reviewed-memory-model.json`: SHA-256 `c1ea220a4ee12780e779166181ef5d7d0f2cccb992280c726c17baeac239b032`

Both retain 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots still compare partially. Five corpus controls repeat unchanged against identical captures; corpus JSON remains at 307 repositories.

Final gates pass 3,282 root tests with two existing skips and 1,236 analyzer tests across 76 files. Typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-update-primitives-final-validation.exit` records 0; `update-primitives-reviewed-gates.json` verifies the evidence. Complete language, causal-model, renderer, and 500-repository gates remain open.

### Guarded argument evaluation and captured call targets

The original deterministic argument-order snapshot now matches `caught:1:0`. The analyzer no longer evaluates the second argument after the first throws. `pending-argument-order-reviewed-comparison.json` checks the same saved native bytes and unchanged fixture, without observations or a new native render. The earlier mismatch and passing replay remain evidence.

`evaluateArguments()` now accepts a continuation. Ordinary arguments stay in an iterative loop; throwing alternatives resume the remaining expressions only on completing paths. Finite spread alternatives retain their arity and guards. Calls, `new`, `super`, and compiled-class wrappers use the same sequencing boundary.

Method calls capture callee/receiver pairs after evaluating receivers and keys under their guards. Getter effects run once per selected reference. Equivalent receiver-independent targets can share an invocation after those reads, without repeating argument evaluation.

The first candidate introduced a duplicate branch around an unchanged Next Script subtree. `/tmp/bippy-argument-order-first-package.log` retains the failing framework assertion. Separating reference capture from invocation restores that control without relaxing its expectation or repeating getters.

Eleven component regressions fail against baseline `ce9ee782` and pass after the repair. They cover deterministic and guarded throws, competing error payloads, callee/receiver/key failures, receiver binding, getter counts, optional calls, finite spreads, and constructor arguments. They require exact concrete states, no omissions, exact native membership, and no replay mismatches. The baseline worktree is `/tmp/bippy-argument-order-baseline`; its relative imports use baseline production with main-owned dependency links.

Seventeen direct evaluation controls pass on both revisions. A new control evaluates 10,000 ordinary arguments without recursive sequencing or an increased budget. This checks that bounded example, not general stack safety or performance.

An expanded `super()` case exposes a separate constructor-outcome defect. The argument failure now stops later expressions, but `class-component.ts` discards the constructor body’s returned completion. Its model emits `returned:1:0` instead of `caught:1:0`; the successful path remains `returned:2:11`.

The strict fixture and test remain under `/tmp/bippy-argument-order-baseline/packages/bippy-analyzer/tests/fixtures/pending-constructor/super.tsx` and `tests/pending-constructor.test.ts`. The test uses main production through absolute imports. Four unforced native captures retain four raw-model failures. Attempt 1 contradicts native membership; the other three match the successful snapshot. Every replay passes. `/tmp/bippy-argument-order-pending-constructor.log` and `pending-constructor-super-argument-order-attempt-*-comparison.json` preserve these failures, not passing coverage.

Four saved assignment snapshots, seven saved throw snapshots, and the numeric-update snapshot remain concrete and exact. Seven reference-limit failures remain against their original captures. Five corpus controls repeat unchanged across all five comparison fields. No repositories were added; the corpus remains at 307.

New source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-argument-order-reviewed-home-model.json`: SHA-256 `6b0fa434339da482b136616be73511be78293647e7c6768c9ee2dcbf6c0ea54d`
- `source-only-argument-order-reviewed-memory-model.json`: SHA-256 `11c2cb1e921412347587efe2f78fc75bd316cf527a10d1328b965fd0db0f6bd5`

Their serialized `model` fields match the primitive-update checkpoint. Both retain 11 states, seven wildcards, and one subtree omission; all 53 saved workflow snapshots remain partial. These trees do not establish transitions or workflow reachability.

Source review used the local React checkout at `82c44beb444eda5230c063eaa163d01f38817211`. `ReactFiberHooks.js` invokes components with their arguments; `ReactFiberClassComponent.js` constructs classes before adopting their instances. The retained ECMAScript source specifies abrupt completion between argument expressions and during spread iteration. These reads motivate the boundary, not complete React or iterator coverage.

Final gates pass 3,305 root tests with two existing skips and 1,259 analyzer tests across 77 files. Typecheck/build, realm checks, lint, formatting, and documentation checks pass. `/tmp/bippy-argument-order-final-validation.exit` records 0; `argument-order-reviewed-gates.json` verifies the retained evidence. Constructor outcomes, broader language semantics, causal models, renderer integration, and the 500-repository gate remain open.

### Constructor boundary counterexamples after argument sequencing

Three deterministic probes at `8a6cbd2d` independently confirm adjacent constructor defects:

| Probe                                    | Source-derived and native result | Model result   |
| ---------------------------------------- | -------------------------------- | -------------- |
| Constructor body throws                  | `caught:1`                       | `returned:1`   |
| Field initializer throws before the body | `caught:1:0`                     | `returned:1:1` |
| Constructor returns a replacement object | `new`                            | `old`          |

Each native comparison mismatches in four steps without budget exhaustion. Each model has no omissions, yet replay reports `sample-passed` with no mismatched samples. These are deterministic contradictions, not failures inferred from incomplete enumeration.

`/tmp/bippy-constructor-boundaries-baseline.log` retains all three strict failures. Fixtures and `constructor-boundaries.test.ts` live in `/tmp/bippy-argument-order-baseline/packages/bippy-analyzer/tests/`; the test imports main production through absolute paths. Its source-derived expectations precede source-only analysis and independent native Bippy rendering. Immutable `constructor-boundary-argument-order-*-comparison.json` files preserve source and production hashes, raw states, native snapshots, and replay reports.

The shared initializer also serves React class mounting. `initializeFields()` continues after storing a thrown initializer, while `constructLayer()` discards constructor results. Parent construction additionally uses a local boolean outside the heap journal. Repairing these paths requires preserving completion, replacement identity, initialization order, and guarded parent state together. No constructor repair is committed at this checkpoint.

These probes add no repositories or workflow acceptance. The argument-order gates and 307-repository count remain unchanged.

### Preserving constructor completion

The three deterministic constructor snapshots now match their original source-derived expectations: `caught:1`, `caught:1:0`, and `new`. All four saved `super()` snapshots also match `caught:1:0` / `returned:2:11`. These comparisons reuse identical source and native bytes without observations or new native rendering. Four earlier native contradictions are repaired; their failing records remain intact.

`initializeFields()` stops after throwing initializers and journals successful data-property writes. `constructLayer()` now returns completion values instead of discarding constructor results. Direct object returns replace the instance; thrown results propagate through the class chain. `SuperBinding.construct` returns a value, including failures, to ordinary and reflective callers.

Parent-construction status is stored in a journaled object. A parent failure leaves the path uninitialized so a guarded retry can run. A second successful parent call runs before the duplicate-binding error, matching the tested side-effect order. The initializer no longer fabricates a missing parent call after an explicit constructor finishes.

React class records retain construction completion. Rendering and lifecycle callbacks are gated by completing paths. A path-dependent replacement that the class record cannot represent stays unknown with reason `React class constructor replacement varies by path`. The tests do not establish full class mounting, lifecycle, or StrictMode behavior.

Ten strict component regressions fail on baseline `06b6380e` and pass after the repair. They cover the saved cases, guarded fields, parent retries, duplicate `super()`, replacement identity, and definite/guarded React constructor errors. Each checks exact raw states, no omissions, exact native membership, and no replay mismatches.

The baseline worktree is `/tmp/bippy-constructor-completion-baseline`; its relative imports use baseline production with dependency links. The expanded test is `tests/constructor-completion-expanded.test.ts`, with failures in `/tmp/bippy-constructor-completion-retained-baseline.log`. The first eight-case test was briefly overwritten during expansion, then restored; the ten-case copy and rerun use separate paths. The initial typecheck failures remain in `/tmp/bippy-constructor-completion-first-typecheck.log`.

An unnecessary command also copied four fixtures to `/tmp/{body,field,replacement,super}.tsx` without checking those convenience paths first. Those copies are not evidence. The original fixture and capture paths remain unchanged and are hash-checked by the saved comparisons.

Two derived-constructor counterexamples remain. A parent replacement object still produces model `old` instead of native `new`. Accessing `this` before `super()` still produces `returned:1` instead of native `caught:0`. Both deterministic native comparisons mismatch in four steps without exhaustion; both have no omissions and pass replay.

Their fixtures and strict test live under `/tmp/bippy-constructor-completion-baseline/packages/bippy-analyzer/tests/fixtures/derived-limits/` and `tests/derived-limits.test.ts`. The test imports main production. `/tmp/bippy-constructor-completion-derived-limits.log` and `derived-constructor-limit-completion-*-comparison.json` retain these failures, not passing coverage.

Thirteen earlier saved checks remain concrete and exact, and seven reference-limit failures remain unchanged. Five corpus controls repeat unchanged across all five comparison fields. The corpus still contains 307 repositories.

New source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-constructor-completion-reviewed-home-model.json`: SHA-256 `72ea97d4841c649293fafe2e9b4c0a21dc936aefa37665026f5b8d6cd8d66475`
- `source-only-constructor-completion-reviewed-memory-model.json`: SHA-256 `e9b2aa99d61c287ec2ad1fafb2c7a7d813f0109a6fcdcc37c536917b2ea81941`

Their serialized models match the argument-order checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots still compare partially. These remain guarded trees, not emitted transition systems or complete reachability models.

Final gates pass 3,325 root tests with two existing skips and 1,279 analyzer tests across 78 files. Typecheck/build, realm checks, formatting, and documentation checks pass. Lint retains two intentional fixture warnings for aliasing `this` and calling `super()` twice. `/tmp/bippy-constructor-completion-final-validation.exit` records 0; `constructor-completion-reviewed-gates.json` verifies the evidence, including class source and type-definition hashes. Complete language, renderer, causal-model, and 500-repository gates remain open.

### Live derived-constructor bindings

The two saved derived-constructor contradictions now match their original expectations: parent replacement returns `new`, and pre-`super()` access produces `caught:0`. `derived-this-binding-*-saved-comparison.json` reuses identical source and native snapshot bytes without observations or new native rendering. The old failures and passing replay remain evidence.

The journaled construction object now stores the initialized `this` value as well as parent-construction status. Native class constructors expose that binding through `SuperBinding.getThisValue`. Reads before initialization throw; derived fields and later reads use the parent’s replacement object. Arrows retain the live binding, while nested non-arrow functions keep their own receivers. Compiled function wrappers do not acquire native-class initialization checks.

The first expanded test exposed a remaining read-order error. `super[getKey()]` evaluated its key after the uninitialized receiver had thrown, producing `caught:1:0` instead of `caught:0:0`. `/tmp/bippy-derived-this-expanded.log` retains that failure. Member reads now guard known receiver/key failures and skip computed keys on absent finite optional paths.

A later getter test emitted `new:GXK` instead of `new:KG`: selected and unrelated getters ran before key evaluation. `/tmp/bippy-derived-this-super-getters-before.log` preserves that failure. Declared instance `super` getters now remain accessors until selected, with the actual receiver retained. Parent replacements represented by value kinds other than `object` remain unknown.

Eleven strict component regressions fail on baseline `d770182a` and pass after the repair. They check fields, replacement guards, captured arrows, nested-function receivers, `super` methods, optional keys, throwing keys, and getter order. Each requires exact concrete states, no omissions, exact native membership, and no replay mismatches. Baseline production is under `/tmp/bippy-derived-this-baseline`, with dependency links; its expanded test uses `tests/derived-this-expanded.test.ts`. The original ten-case test and both baseline logs remain separate.

Two adjacent deterministic contradictions remain:

| Probe                                                 | Source-derived and native result | Model result |
| ----------------------------------------------------- | -------------------------------- | ------------ |
| Retried parent allocates a fresh instance             | `false:2`                        | `true:2`     |
| Extracted `super` method is called without a receiver | `unbound`                        | `new`        |

Both native comparisons mismatch in four steps without exhaustion. Both models have no omissions and pass replay. Their fixtures and test remain under `/tmp/bippy-derived-this-baseline/packages/bippy-analyzer/tests/fixtures/derived-limits/` and `tests/derived-limits.test.ts`, using main production through absolute imports. `/tmp/bippy-derived-this-limits.log` and `derived-this-limit-*-comparison.json` preserve these failures, not passing coverage.

Seven saved constructor checks and thirteen earlier saved checks remain concrete and exact. Seven reference-limit failures remain unchanged. Five corpus controls repeat unchanged against identical captures; the corpus remains at 307 repositories.

New source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-derived-this-reviewed-home-model.json`: SHA-256 `e6f94ec05884be5636bf34b4f1447fb11c90d0b0fdc36bb0440e1d89cf67c188`
- `source-only-derived-this-reviewed-memory-model.json`: SHA-256 `96d8ea9b07e6c3a74389254b7b810ddf144419662e62c9b84e43878f585581b5`

Their serialized models match the constructor-completion checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial. The retained ECMAScript source specifies `BindThisValue`, `GetThisBinding`, and `super` property order. The local React checkout supplies the class construction/adoption and DevTools bridge `super` call examples; these reads are not integration coverage.

Final gates pass 3,347 root tests with two existing skips and 1,301 analyzer tests across 79 files. Typecheck/build, realm checks, formatting, and documentation checks pass. Lint retains two intentional pre-`super()` access warnings in fixtures. `/tmp/bippy-derived-this-final-validation.exit` records 0; `derived-this-reviewed-gates.json` checks production/type hashes and all 22 exact same-snapshot comparisons. Complete class, language, causal-model, renderer, and 500-repository gates remain open.

### Class allocation and call receivers

The saved allocation and extracted-method contradictions now match their original native snapshots. `class-identity-{allocation,extraction}-saved-comparison.json` records `false:2` and `unbound` using unchanged source/capture bytes, without observations or new native rendering. The original contradictions and their passing replay remain preserved.

Each native-class `super()` attempt now receives a fresh instance with the original prototype metadata. Failed instances retain their fields and frozen state. Duplicate calls construct another parent before rejecting the second binding; the first initialized receiver remains selected. Compiled function wrappers retain their earlier allocation path. This is not full reflective construction or `new.target` coverage.

Declared instance and static methods now default to an undefined receiver rather than storing an implicit class/instance binding. Explicit calls, binds, and lexical arrows keep their receivers. React’s instance lifecycle helpers supply the instance explicitly. Mounting reads state from the common completing constructor result, while incompatible path-dependent instances remain conservative.

The first full suite exposed a regression in `escaped-queue-callbacks.tsx`: the model retained `<em>` while native React reached `<strong>`. `/tmp/bippy-class-identity-first-package.log` preserves that mismatch and its passing replay. Escape walks now capture receivers at resolved member-call sites, not when reading methods as arguments. Memoized receiver-specific wrappers retain recursion termination and mutation invalidation. Bound receivers take precedence over default receivers; arrows retain lexical `this`.

Eight strict component checks cover allocation, extraction, direct/static/bound/arrow receivers, shared method identity, frozen failed instances, guarded retries, duplicate calls, and React mount updates. Six direct escape checks cover receiver separation, passed methods, bound receivers, arrows, recursion, and stale reads. Baseline `/tmp/bippy-class-identity-baseline` at `d83ce6f0` fails nine checks and passes five controls. Relative imports in those two baseline tests use baseline production; both tests and all eight fixtures are hash-identical to main.

Two adjacent deterministic failures remain outside passing coverage:

| Probe                                                     | Source-derived and native result | Model result |
| --------------------------------------------------------- | -------------------------------- | ------------ |
| Extracted method reads `this.value` with undefined `this` | `caught`                         | `returned`   |
| Derived constructor returns `Math.random()`               | `caught`                         | `returned`   |

Both native comparisons mismatch in four steps without exhaustion or model omissions, while replay passes. `class-identity-limit-*.json` and `/tmp/bippy-class-identity-limits.log` preserve the failures. Their fixtures and runner are in the new baseline worktree, but the runner imports main production explicitly. React source review also found that static derivation callbacks are invoked as extracted functions; the analyzer’s explicit class receiver still needs independent verification.

All 24 same-snapshot checks are now concrete and exact: two allocation/extraction, two derived-binding, seven constructor, and thirteen earlier controls. Seven reference-limit failures remain unchanged. Five corpus controls repeated unchanged; all 53 saved workflow snapshots remain partial. The corpus remains at 307 repositories.

Source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-class-identity-reviewed-home-model.json`: SHA-256 `a9844774cf708ee70542a1615e92a0cd068c4a8ef1eb2b604f15d1ac3c755a2e`
- `source-only-class-identity-reviewed-memory-model.json`: SHA-256 `6afd19d6049f5ac5f3ea01215a22bb5f8c1b0f584a19c5d23ebbd5baea1341f8`

Their serialized models match the derived-binding checkpoint: 11 states, seven wildcards, and one subtree omission. The new production hash lists include `escapes.ts` and `escape-memo.ts`.

A helper-preparation command initially invoked Bun without its stdin argument, so the helper files were not created. The first model/control launches failed to load those files. Their logs and nonzero markers remain; corrected launches use separate `*-retried` logs. No model, capture, or result evidence was overwritten.

Final gates pass 3,369 root tests with two existing skips and 1,323 analyzer tests across 81 files. Typecheck/build, realm checks, formatting, and documentation validation pass. Lint retains three intentional `this`-alias warnings and one duplicate-`super()` warning in fixtures. `class-identity-reviewed-gates.json` verifies baseline/main hashes, same-snapshot checks, retained failures, controls, and corpus bytes. The preserved ECMAScript source supplies construction, call-reference, and strict-receiver rules; the pinned React checkout supplies construction/adoption and instance-lifecycle call sites. No complete language, lifecycle, causal-model, renderer, or 500-repository claim follows.

### Primitive constructor results and static derivation calls

`529dc667` committed the allocation/receiver repair. The next repair uses the preserved numeric-return contradiction and two independent static-callback counterexamples. React’s `applyDerivedStateFromProps` and error-update payload call extracted functions, not class-bound methods. The pinned checkout shows those calls in `ReactFiberClassComponent.js` and `ReactFiberThrow.js`.

`class-results-before-{props,error}-comparison.json` preserves native `unbound` against model `bound`. Both mismatch in five steps without exhaustion or omissions; both pass replay. Two earlier capture helpers failed module resolution before producing snapshots: one used a main-checkout fixture, and the other used a noncanonical `/tmp` URL. Separate canonical-path helpers captured the unchanged baseline fixture copies successfully. Those failed logs remain, not native evidence.

Derived-constructor completion now checks the known return type, not only concrete primitive values. Unknown numbers and strings throw `TypeError`; guarded undefined returns retain their completing paths. Base constructors still ignore primitive results. React static derivation calls now supply `UNDEFINED_VALUE`; explicit binds and lexical arrows retain their receivers. The duplicate escape-member lookup branches were consolidated, and an obsolete prototype-receiver comment was removed.

Eight strict checks in `class-results.test.ts` cover numbers, strings, guarded returns, both static derivation callbacks, and base/bound/arrow controls. Baseline `/tmp/bippy-class-results-baseline` at `529dc667` fails five checks and passes three controls. `/tmp/bippy-class-results-confirmed-baseline.log` contains that clean baseline run. Both test and fixture bytes match main; relative imports use baseline production.

The first implementation imported `getTypeofValue` from the wrong module. Typecheck reported `TS2305`; 18 focused checks failed, and the source-only app models had zero states with a `getTypeofValue is not a function` render error. The initial controls and artifacts under `class-results-*` remain preserved. The helper is exported from `builtin-calls.ts`. Corrected gates and comparisons use separate `class-results-corrected-*` names; nothing was overwritten or counted as passing from the invalid candidate.

Three saved contradictions now match concrete expectations against identical snapshots: the unknown numeric constructor return and both static derivation callbacks. All 24 earlier saved controls remain exact, for 27 total. Seven reference-limit failures remain unchanged. The saved extracted-method property-read failure still emits `returned` instead of native `caught`, with four mismatch steps and passing replay. This remains outside passing coverage.

Corrected source-only models are under `/tmp/bippy-many-games-causal-investigation/`:

- `source-only-class-results-corrected-reviewed-home-model.json`: SHA-256 `b6161bf1c0096636cbf5d915bd09a7484f83903fd2725c3a0e4abe2014e8e35e`
- `source-only-class-results-corrected-reviewed-memory-model.json`: SHA-256 `2d24a01439de4229f3eac340d1c94571ffa0e9f8d68795e1fd91e9fa86652c8b`

Their serialized models match the class-identity checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial. Five corpus controls repeat unchanged against identical captures. The corpus remains at 307 repositories.

Corrected gates pass 3,385 root tests with two existing skips and 1,339 analyzer tests across 82 files. Typecheck/build, realm checks, lint, formatting, and documentation validation pass. `class-results-corrected-reviewed-gates.json` verifies production and baseline hashes, all 27 exact same-snapshot checks, retained failures, model/control evidence, and unchanged corpus bytes. Complete property-error, class/lifecycle/StrictMode, language, causal-model, renderer, and 500-repository gates remain open.

### Nullish property reads and writes

Known null/undefined receivers now produce modeled `TypeError` completions on reads and writes. The checks cover named/dynamic reads, captured assignment references, and dynamic method lookup. Error names remain concrete; messages remain unknown rather than assuming an engine-specific string. `typeof` now preserves a throwing operand’s completion.

The preserved ECMAScript `GetValue`/`PutValue` algorithms place receiver coercion at the read/write boundary. Computed-key expressions therefore still run first. Simple assignments evaluate the RHS before the nullish write fails; compound assignments and calls stop before later operands/arguments. Earlier key or RHS errors retain their payloads. The pinned React checkout’s error-update payload shows the caught error passed into `getDerivedStateFromError`.

Twelve strict component cases cover those boundaries, optional short circuiting, and guarded reads/`typeof`. Baseline `/tmp/bippy-nullish-properties-baseline` at `d108d480` fails nine cases and passes three controls. `tests/nullish-properties-expanded.test.ts` and its fixtures match main by hash; relative imports use baseline production. The original nine-case baseline and a later local-variable variant remain separate.

The first `typeof` fixture also read an undeclared browser-global name. That remains unknown under the source-only environment policy, so its concrete expectation was unsupported independently of the property failure. The original fixture is retained in the baseline and `/tmp/bippy-nullish-properties-typeof-global-preserved.tsx`; a separately named fixture uses a declared undefined local. No global absence was forced. An exploratory package run started while that test path changed and retained a missing-fixture failure; its counts are not the final gate.

Five original null-assignment snapshots and the extracted-method undefined-read snapshot now satisfy their unchanged raw expectations. All 27 earlier saved checks remain exact, for 33 total. Two previously mismatching native snapshots are repaired; the other four null snapshots had matched while their raw expectations failed. Getter-only and proxy writes remain unchanged strict failures.

New adjacent counterexamples remain under `tests/fixtures/property-limits/` and `tests/property-limits.test.ts` in the nullish baseline worktree. That runner imports main production explicitly:

| Probe                                  | Source-derived expectation | Model                 |
| -------------------------------------- | -------------------------- | --------------------- |
| Delete a property through null         | `caught`                   | `returned`            |
| Read a guarded getter or null receiver | `caught:0`, `ready:1`      | `caught:1`, `ready:1` |

`nullish-properties-limit-delete-0-comparison.json` mismatches native execution in four steps. Four unforced getter captures preserve two exact native snapshots and two mismatches in six steps. All four getter models fail the raw expectation; all five probes have no omissions/exhaustion and pass replay. No sampled getter path was forced, and exact membership on a successful path is not a repair.

Source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-nullish-properties-reviewed-home-model.json`: SHA-256 `3f426a4a8109af4c27d5be986bb28d533b5707e767ce002a9bd281b5efd9664e`
- `source-only-nullish-properties-reviewed-memory-model.json`: SHA-256 `bca0c34df5b84196d69c1452fd65bd0badc560aaba42872ec99d55198a9c6518`

Their serialized models match the corrected class-results checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial. Five corpus controls repeat unchanged against identical captures; the corpus stays at 307 repositories.

Final gates pass 3,409 root tests with two existing skips and 1,363 analyzer tests across 83 files. Typecheck/build, realms, lint, formatting, and documentation validation pass. `nullish-properties-reviewed-gates.json` verifies baseline/main hashes, all 33 exact same-snapshot checks, retained write/delete/getter failures, model/control evidence, and unchanged corpus bytes. Optional wrappers, sparse holes, coercion, destructuring, complete property errors, causal modeling, renderer integration, and the 500-repository gate remain open.

### Getter, delete, and proxy-set completion

`f54dc675` committed the nullish-read/write repair. Getter reads now run through `continueValue` under their selected receiver guards rather than an unguarded `mapValue`. The four saved getter snapshots now satisfy `caught:0` / `ready:1`, including the two original native contradictions.

Deletion now sequences receiver and key evaluation under completion guards. Earlier receiver failures stop key evaluation; nullish receivers throw after completing key evaluation. Non-reference operands preserve their completion. These checks do not establish complete optional deletion, descriptor, prototype, or strict-delete behavior.

Proxy assignment now reads the `set` trap through `getProperty`, preserves trap-lookup/call failures, and supplies the handler as the trap-call receiver. Successful delegation returns the original proxy, preserving assignment-reference identity. This is not complete `[[Set]]` support.

Eleven strict checks cover getters, deletion, throwing/getter-backed/guarded proxy traps, handler receivers, and identity/optional controls. Baseline `/tmp/bippy-property-effects-baseline` at `f54dc675` fails nine and passes two. Its `property-effects-completion.test.ts` and the selected fixtures match main by hash. Relative imports use baseline production.

The first candidate still failed the stricter `delete-guards` fixture: the completing path reported the deleted key as present. `/tmp/bippy-property-effects-first.log` and the original baseline fixture preserve that failure. A separately named `delete-branches` fixture checks completion only; it does not replace the presence expectation. The temporary preservation moves for that fixture and the earlier global-`typeof` fixture lacked destination-existence guards. Original baseline copies remain unchanged and verifiable.

The saved delete snapshot and proxy-setter snapshot now match their original expectations too. All 33 earlier checks remain exact, for 39 same-snapshot checks total. This repairs four original native contradictions across the six new checks. Of the original eight reference-limit snapshots, only the getter-only write remains a strict failure.

New probes remain under `tests/property-limits.test.ts`, `tests/proxy-forward-completed.test.ts`, `tests/proxy-accessor.test.ts`, and `tests/fixtures/property-limits/` in the new baseline worktree. They import main production explicitly:

| Probe                                           | Source-derived/native expectation   | Model                              |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------- |
| Falsy `set` trap in strict code                 | `caught`                            | `returned`                         |
| Forwarded setter reads through proxy `get` trap | `proxy`                             | `target`                           |
| Forwarded setter compares receiver identity     | `proxy`                             | `proxy`, `target`                  |
| Presence after guarded deletion                 | `caught:K:true`, `returned:K:false` | `caught:K:true`, `returned:K:true` |

The first two deterministic captures mismatch in four steps. The identity capture matches one model alternative but fails the raw expectation. Four unforced presence captures retain three exact memberships and one six-step mismatch; all four fail the raw expectation. All seven have no omissions/exhaustion and pass replay. `property-effects-limit-*-comparison.json` preserves this distinction.

The first forwarding fixture was missing its closing brace and failed transformation before capture. That source and parse-error log remain. A separately named completed fixture captured the identity check; a further accessor-read fixture isolates the wrong receiver without relying on proxy equality. The parse failure is not native evidence.

Source-only files under `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-property-effects-reviewed-home-model.json`: SHA-256 `960cf24caa203afdb304dbb1c41f058fe4e343758f5ed1634dc5b60bcba8c843`
- `source-only-property-effects-reviewed-memory-model.json`: SHA-256 `084c21f9887ca8047386151fec01bddf4fdd3143f07f4a573619d5da1f769886`

Their serialized models match the nullish checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial. Five corpus controls repeat unchanged against identical captures; the corpus remains at 307 repositories.

Final gates pass 3,431 root tests with two existing skips and 1,385 analyzer tests across 84 files. Typecheck/build, realms, lint, formatting, and documentation validation pass. `property-effects-reviewed-gates.json` verifies baseline/main hashes, all 39 exact same-snapshot checks, the retained readonly failure and seven newer probes, model/control evidence, and corpus bytes. The ECMAScript delete and proxy-set algorithms and pinned React state-derivation call sites informed the repair. Property presence, proxy forwarding/invariants, strict writes/deletes, complete language/lifecycle behavior, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Conditional property presence and spread snapshots

`a5a5075e` committed the getter/delete/proxy-trap repair. The next repair keeps guarded property presence separate from the value read at that key. `getOwnPropertyPresence` preserves original guards; `hasOwnKey` retains its boolean-or-unknown interface. `in` and `hasOwnProperty` now consume the guarded result.

`joinObjectEntries` uses conditional per-key entries instead of manufacturing an own property whose value is `undefined` on an absent path. Whole-object fallback joins no longer prefix the old entries, which could resurrect deleted keys. Property lookup distinguishes absence from present `undefined`, including inherited fallback. Finite spread copies snapshot both presence and values; uncertain key enumeration stays conservative.

Nine strict component checks cover deletion, undefined-valued own keys, addition, repeated writes/deletes, inherited fallback, explicit-undefined spread precedence, snapshots, and unrelated accessors. Five direct checks verify guards, absent-key fallback, snapshots, key-enumeration uncertainty, and nested-spread causes. Baseline `/tmp/bippy-property-presence-baseline` at `a5a5075e` fails twelve and passes the accessor and cause-preservation controls. `property-presence-reviewed.test.ts`, `property-presence-provenance-values.test.ts`, and the nine fixture files match main by hash. Earlier six- and eight-case baseline runs remain separately named.

Candidate evidence remains:

- `/tmp/bippy-property-presence-first.log`: spread flattening still erased an absent alternative.
- `/tmp/bippy-property-presence-expanded.log`: a direct test assumed identical predicate serialization. The values and guards were correct; the retained test now compares exact alternative guards and inputs, allowing normalized predicate serialization.
- The first broad gate passed 3,451 root / 1,405 analyzer tests, but an added accessor control exposed `new:0:0` instead of `new:1:1`. Conditional entries hid an unrelated getter and setter. `/tmp/bippy-property-presence-accessor-before.log` preserves that introduced regression. Accessor lookup now skips spreads that definitely lack the requested key. The accessor-reviewed suite passed too, but its receipt detected lost nested-spread causes. `/tmp/bippy-property-presence-accessors-provenance.log` and `/tmp/bippy-property-presence-provenance-before.log` preserve that regression. Property lookup now retains the underlying unknown value and its cause. Only the later `property-presence-provenance-*` artifacts validate final production.

All four original guarded-deletion captures now satisfy `caught:K:true` / `returned:K:false`, repairing the original six-step native mismatch. Their unchanged source and native bytes are verified by `property-presence-provenance-deletion-*-saved-comparison.json`. All 39 earlier same-snapshot checks remain exact, for 43 total.

The getter-only write and three proxy probes remain strict failures on the same snapshots. Falsy proxy-set results and forwarded accessor reads still mismatch native execution in four steps. Forwarded receiver identity still emits an extra `target` alternative despite exact native membership. Replay passes all three; no omissions or budget exhaustion explain away the failures. See `property-presence-provenance-write-*-saved-comparison.json` and the retained reference-limit comparison.

Source-only files in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-property-presence-provenance-reviewed-home-model.json`: SHA-256 `10601b5f6bfe1d1436e868a3d03a5ae9bff0174dbf8e5fe01ce40e6299f52bbd`
- `source-only-property-presence-provenance-reviewed-memory-model.json`: SHA-256 `a6a29dd1dcf8f1c2d328016eafdf7322981cfbf6a72986d5703719f39364915e`

The serialized models are not identical to the previous checkpoint. React Router’s `ErrorResponse` assigns `error` only when `data instanceof Error` (`@remix-run/router/dist/router.js:1294–1309`). Its shape description now ends in `...` rather than claiming a definite `error` key. Home has 16 changed reason/label fields. Memory has the same 16 description changes plus eight input-metadata permutations, totaling 136 raw leaf differences. A scoped comparison checks each input by its unchanged ID and verifies all other fields; it does not overwrite or normalize the frozen models. `property-presence-provenance-model-differences-{raw,verified}.json` preserves the comparisons. The prior strict unchanged-model assertions and the initial reason/label-only comparison failed and remain evidence.

Both models still have 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows remain unchanged against identical captures. No new app traces, observation inputs, forced randomness, budgets, or repositories were added.

Final gates pass 3,454 root tests with two existing skips and 1,408 analyzer tests across 86 files, plus typecheck/build, realms, lint, formatting, and documentation validation. `property-presence-provenance-reviewed-gates.json` verifies production/type/source hashes, the baseline, 43 exact saved checks, four retained write/proxy failures, models, controls, and unchanged corpus bytes. Descriptor and key-order behavior, complete enumeration/property/lifecycle semantics, causal modeling, renderer integration, and 500-repository acceptance remain open. Continue with proxy setter receiver forwarding and strict write failures, not the repaired guarded-deletion example.

### Proxy setter receiver forwarding

`5f664f8e` committed conditional property presence and spread snapshots. Proxy setter delegation now carries the original receiver separately from the lookup target. An absent or null `set` trap forwards that receiver through nested proxies; an inner trap receives it as its fourth argument. Ordinary accessors receive it as `this`, while explicitly bound setters retain their own binding. Branch-target assignment now uses completion guards instead of mutating every alternative and discarding setter errors.

Eight strict checks cover the original accessor and identity failures, nested traps, guarded throwing/successful targets, null traps, bound setters, ordinary inherited setters, and throw sequencing. Baseline `/tmp/bippy-proxy-receivers-baseline` at `5f664f8e` fails six and passes the two binding/ordinary controls; its test and eight fixtures match main by hash. The ECMAScript proxy `[[Set]]` and `OrdinarySetWithOwnDescriptor` algorithms distinguish target and receiver. The pinned React opaque-origin proxy test was also reviewed; it is not additional integration coverage.

Both original forwarding snapshots now satisfy the concrete `proxy` expectation. This repairs the four-step native mismatch and removes the identity probe’s spurious `target` alternative, which previously passed native membership and replay. All 43 earlier checks remain exact, for 45 same-snapshot checks. Getter-only writes and falsy `set` results still fail their original expectations.

New probes are preserved in `tests/fixtures/proxy-limits/`, `tests/proxy-limits.test.ts`, and `tests/proxy-get-receiver-inspected.test.ts` in that baseline worktree. They import main production explicitly:

| Probe                                           | Native/source-derived expectation | Model/comparison                        |
| ----------------------------------------------- | --------------------------------- | --------------------------------------- |
| Getter-backed `get` trap                        | `GT`                              | `empty`; four-step mismatch             |
| `defineProperty` during an ordinary proxy write | `caught:1:old`                    | `returned:0:new`; four-step mismatch    |
| `get` trap handler receiver                     | `handler`                         | Nonconcrete wildcard; four-step partial |

The first two have no omissions/exhaustion and pass replay. The receiver probe has no omissions/exhaustion but incomplete replay. Its first helper failed concrete-text extraction before saving the capture; a separately named inspected helper records a new native capture and the wildcard error. Neither run establishes an exact model. `proxy-receivers-limit-*-comparison.json` preserves these distinctions.

Source-only files in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-proxy-receivers-reviewed-home-model.json`: SHA-256 `a72e9a1fef6e36294de2e2bcf20d3fa7120ae1d771e3b0fb130faf44875f66e0`
- `source-only-proxy-receivers-reviewed-memory-model.json`: SHA-256 `1c8aa01c36d8d4c5d434357fcd967d614c09605000dbec7c99a929bce5b610fc`

Their serialized models match the previous provenance-reviewed checkpoint, including its conditional-key descriptions: 11 states, seven wildcards, and one subtree omission. All 53 saved workflow snapshots remain partial. Ten repeated corpus-control rows are unchanged against identical captures. No new app traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,470 root tests with two existing skips and 1,424 analyzer tests across 87 files, plus typecheck/build, realms, lint, formatting, and documentation validation. `proxy-receivers-reviewed-gates.json` verifies production/type/source hashes, baseline failures/controls, all 45 exact saved comparisons, retained write failures, new proxy probes, models, controls, and unchanged corpus bytes. Continue with `get` trap lookup/receivers, property-definition dispatch, and strict writes; do not treat setter forwarding as complete proxy, descriptor, reflection, lifecycle, causal-model, renderer, or 500-repository acceptance.

### Proxy read lookup and receivers

`c4fc952a` committed setter receiver forwarding. Proxy reads now retrieve `get` through interpreted property lookup, preserving getter effects and lookup failures. Trap calls receive the handler as `this`; absent/null traps forward the original receiver through nested proxies and ordinary object accessors. Explicit bindings still win. Computed-key evaluation precedes trap lookup, and lookup failures stop later call arguments.

Eight strict checks cover the saved handler/accessor cases, ordinary getter forwarding, nested traps, guarded getter failures and argument order, null traps, bound callbacks, and ordinary inherited getters. Baseline `/tmp/bippy-proxy-reads-baseline` at `c4fc952a` fails six and passes the two controls; its test and eight fixtures match main by hash. The ECMAScript proxy `[[Get]]` and `OrdinaryGet` algorithms informed the change.

The original getter-backed trap snapshot now yields `GT` rather than `empty`, repairing a deterministic native mismatch that passed replay. The saved handler-receiver snapshot now yields concrete `handler` rather than a wildcard/partial model with incomplete replay. Both compare exactly with passing replay on unchanged source/native bytes. All 45 earlier comparisons remain exact, for 47 total. The getter-only write, falsy `set` result, and ordinary-write `defineProperty` dispatch failures remain unchanged on their saved captures.

New `tests/fixtures/proxy-limits/{frozen-get,noncallable-get}.tsx` fixtures and `tests/proxy-limits.test.ts` in the baseline host import main production. Reading a frozen target through a trap that returns a different value yields native `caught`, model `other`. A numeric `get` trap yields native `caught`, model `returned`. Both mismatch in four steps with no omissions/exhaustion and passing replay. `proxy-reads-limit-*-comparison.json` retains these counterexamples; they are not passing coverage or corpus additions.

Source-only files in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-proxy-reads-reviewed-home-model.json`: SHA-256 `141b43490aad8f0603b1031ebacd1efe362f864c264d46c66f6eb9fc5495035f`
- `source-only-proxy-reads-reviewed-memory-model.json`: SHA-256 `6fa510d8dacf1a3f9685922b0e7a2e8e216077bf78ae8b98e279d144f9ac1279`

Serialized models match the setter checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,486 root tests with two existing skips and 1,440 analyzer tests across 88 files, plus typecheck/build, realms, lint, formatting, and documentation validation. `proxy-reads-reviewed-gates.json` verifies baseline/source/production hashes, 47 exact same-snapshot checks, the three retained write/definition failures, two new proxy counterexamples, models, controls, and unchanged corpus bytes. Trap callability, proxy invariants, definition dispatch, strict writes, complete proxy/descriptor/reflection/lifecycle semantics, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Proxy trap callability

`1d59b199` committed proxy getter lookup and receivers. The shared `getProxyMethod()` now rejects `get` and `set` traps whose modeled `typeof` is known not to be `function`, producing a modeled `TypeError` after trap lookup and before invocation. Nullish methods still delegate; unknown types retain existing call handling. Method/type alternatives pass through guarded continuations, preserving lookup effects, errors, and original input decisions.

Ten strict `proxy-methods` checks cover numeric and typed-unknown numeric traps, objects with a `call` property, noncallable proxy objects with an `apply` trap, getter branches, computed-write/RHS/lookup ordering, explicit binding, nullish fallback, and callable-proxy controls. Baseline `/tmp/bippy-proxy-methods-baseline` at `1d59b199` fails seven and passes three controls. Its `tests/proxy-methods-expanded.test.ts` and ten fixtures match main by hash; the earlier eight-case baseline remains separately preserved. The ECMAScript `GetMethod` and proxy `[[Get]]` algorithms informed the repair. React's pinned `ReactPerformanceTrack-test.js` also exercises throwing proxy reads on an opaque-origin window.

The unchanged noncallable-`get` snapshot now yields `caught`, repairing a four-step native mismatch that passed replay. All 47 earlier saved comparisons remain exact, for 48 total. Getter-only writes, falsy `set` results, ordinary-write `defineProperty` dispatch, and frozen-target read invariants remain unchanged strict failures on their saved captures.

Three additional source cases in the baseline's `tests/fixtures/proxy-limits/` remain outside passing coverage:

- `class-get.tsx`: a class used as a trap satisfies `IsCallable`, but calling it without `new` must throw. Native yields `caught`; the model yields `returned`.
- `noncallable-apply.tsx`: a numeric `apply` trap yields native `caught`, model `returned`.
- `guarded-freeze.tsx`: native source permits `frozen:true` or `open:false`; the model emits `frozen:true` or spurious `open:true`. `Object.freeze` currently writes an unjournaled `isFrozen` flag. Using that flag for guarded proxy invariants would reject the wrong path, so this phase does not add frozen-target validation.

The first two captures mismatch in four steps. Four unforced guarded-freeze captures produce one six-step mismatch and three five-step exact memberships; all four still fail the original raw expectation. All six reports have no omissions/exhaustion and passing replay. `proxy-methods-limit-*-comparison.json` preserves the original records; `proxy-callability-limit-*-saved-comparison.json` rechecks identical source/native bytes against final production.

The first `proxy-methods` broad gate passed. Diff review found that the new helper displaced the existing assignment-method JSDoc. Restoring that comment changed the production hash, so final gates, model freezes, and saved comparisons use new `proxy-callability` artifacts rather than relabeling old evidence.

Final source-only models in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-proxy-callability-reviewed-home-model.json`: SHA-256 `7806798d517879d60643a9b7be2a2dea4387b252e66b4d19868af1eee38473c1`
- `source-only-proxy-callability-reviewed-memory-model.json`: SHA-256 `be123228fe2ad96d26fcca3ea08a775432d2589ddbe037846999d457a379cc00`

Serialized models match the getter checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,506 root tests with two existing skips and 1,460 analyzer tests across 89 files, plus typecheck/build, realms, lint, formatting, and documentation validation. `proxy-callability-reviewed-gates.json` verifies source/production hashes, baseline, 48 exact saved checks, four retained write/definition/invariant failures, six additional strict failures, models, controls, and unchanged 307-entry corpus bytes. Complete callability, proxy/descriptor/integrity/strict-write/lifecycle semantics, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Strict getter-only and proxy write completion

`6289673a` committed proxy trap callability. Assignment references now carry lexical strictness into property writes. `PropertyAssignmentOptions` keeps that flag with the original receiver through guarded targets and proxy delegation. Getter-only accessors and falsy `set` results produce modeled `TypeError` completions in strict code; sloppy writes leave the property unchanged without throwing. Trap effects survive rejection. Ordinary setters still succeed after completing, regardless of their return value.

`strict-code.ts` uses the existing `ModuleRecord.isCommonJs` classification, then scans original AST regions for directives and classes. Strictness follows lexical containment, not the calling function. Block strings and escaped directives do not enable strict mode. The parser forces `sourceType: module`, so that parser field is not evidence of runtime strictness. Initial filename-extension overrides were removed before final validation; script/loader classification, eval, dynamic function constructors, and complete compiler strictness remain unverified. The older `evaluateUnboundThis()` heuristic is unchanged.

Twelve strict component cases cover the two saved failures, key/RHS order, inherited accessors, nested null-trap forwarding, trap effects, guarded and numeric results, explicit predicate correlation, and ordinary-setter/truthy controls. Ten CommonJS scope checks evaluate source statically first, then compare raw source in an independent native VM; they do not render application components. Baseline `/tmp/bippy-strict-writes-baseline` at `6289673a` fails 15 and passes seven controls. Its `strict-writes-final.test.ts`, `strict-write-scopes-final.test.ts`, and twelve fixtures match main by hash.

The original getter-only snapshot now yields `caught:old`; the original falsy-set snapshot now yields `caught`. Both satisfy their original strict expectations and exact native membership, repairing mismatches that passed replay. All 48 earlier saved comparisons remain exact, for 50 total. Definition dispatch, frozen-target read invariants, and six earlier class/apply/guarded-freeze probes remain unchanged failures on identical snapshots.

Two failing assertions remain outside passing coverage:

- The original eleven-case CJS scope suite includes class heritage and remains in the baseline and `/tmp/bippy-strict-write-scopes-heritage-preserved.test.ts`. `createClassValue()` stores a throwing heritage result instead of propagating it. The initial main log preserves that failure.
- Direct `${accepts}` boolean interpolation produces nonconcrete text. The original fixture remains in the baseline and `/tmp/bippy-strict-writes-boolean-interpolation-preserved.tsx`; the expanded failure log remains. The separate `strict-writes-correlated-branch.tsx` projects the condition explicitly and verifies `false:caught` / `true:returned`. It does not repair direct boolean interpolation.

New `tests/fixtures/strict-limits/{heritage,frozen-write,primitive-write,boolean}.tsx` cases preserve three four-step native mismatches and one five-step exact membership. The boolean model fails strict extraction with `Expected a concrete tree, received text`; its raw states remain recorded. All four have no omissions/exhaustion and passing replay. `strict-writes-limit-*-comparison.json` preserves the original captures; `strict-write-completion-limit-*-saved-comparison.json` rechecks identical source/native bytes against final production. These are not passing tests or corpus additions.

Initial `strict-writes` artifacts remain separate from final `strict-write-completion` evidence after removing the filename guesses. Final source-only files in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-strict-write-completion-reviewed-home-model.json`: SHA-256 `b8c7b7a9c58a826d45d84477922d2838859e98cb6675617b68b84a011ed2d838`
- `source-only-strict-write-completion-reviewed-memory-model.json`: SHA-256 `f81c8bf53b442f1ee59eea2c0ade15c54e432eb2ab6ed522d74a5630c6fad8ec`

Serialized models match the callability checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,540 root tests with two existing skips and 1,494 analyzer tests across 91 files, plus typecheck/build, realms, lint, formatting, and documentation validation. Lint retains the intentional `no-setter-return` warning in the ordinary-setter control. `strict-write-completion-reviewed-gates.json` verifies eleven production-source hashes including `strict-code.ts`, baseline, 50 exact saved checks, two retained definition/invariant failures, ten other strict probes, models, controls, and unchanged 307-entry corpus bytes. Broader write/descriptor/integrity/class-definition/strictness semantics, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Heritage and comma-expression completion

`20d37480` committed strict getter-only and proxy-write failures. The next investigation found two separate boundaries behind the preserved heritage example. The earlier diagnosis was incomplete: `(target.value = "new", Object)` discards the write error in comma evaluation before class creation receives it. Directly throwing heritage expressions also reach `createClassValue()` as a thrown value that it stores in the class body; class declarations then store the resulting value as a binding without propagating completion.

`createClassValue()` now selects completing superclass paths before collecting keys, defining statics, or applying the existing decorator handling. Each path keeps its selected superclass and evaluation context. Declarations return always-throwing results and fork mixed completions, binding only the nonthrowing alternatives. Comma expressions reuse the existing iterative operand evaluator and return the final value; earlier errors stop later operands, assignment, argument evaluation, and calls. This does not validate superclass constructability, prototype objects, decorators, or all class-definition semantics.

Nine class-heritage cases and four comma cases check payloads, ordering, guarded completion, unchanged assignment targets, call boundaries, inherited static values, null/no-heritage controls, and an unbound comma-result call. A 10,000-operand direct control verifies iterative sequencing without a budget increase. The exact original eleven-case CJS scope suite, including its previously failing heritage assertion, is restored by hash.

Baseline `/tmp/bippy-class-heritage-baseline` at `20d37480` fails eleven and passes fourteen controls across 25 checks. Its `class-heritage.test.ts`, `sequence-completion.test.ts`, `strict-write-scopes-heritage.test.ts`, and thirteen fixtures match main by hash. The first candidate repaired direct heritage failures but still failed the two comma-based heritage assertions; `/tmp/bippy-class-heritage-first.log` preserves that result. The final focused run passes all 25. The ECMAScript `ClassDefinitionEvaluation`, binding-class-declaration, and comma-operator algorithms informed the changes; React's pinned reconciler source constructs instances after obtaining the class constructor.

The original saved heritage snapshot now yields `caught`, repairing a four-step native mismatch that passed replay. All fifty earlier saved comparisons remain exact, for 51 total. Definition dispatch, frozen-target read invariants, and nine earlier class/apply/guarded-freeze/write/boolean probes remain unchanged failures on identical captures.

Six new `tests/fixtures/class-definition-limits/` probes in the baseline host import main production and preserve further failures:

| Case             | Native expectation | Model         |
| ---------------- | ------------------ | ------------- |
| `invalid-parent` | `caught:H`         | `returned:HS` |
| `prototype`      | `caught:P`         | `returned:S`  |
| `key`            | `caught:K`         | `returned:KS` |
| `field`          | `caught:F`         | `returned:FL` |
| `block`          | `caught:B`         | `returned:BL` |
| `getter`         | `A`                | `GA`          |

All six mismatch in four steps with no omissions/exhaustion and passing replay. They expose missing superclass/prototype validation, swallowed computed-key/static-field/static-block errors, and eager static getter evaluation. `class-heritage-limit-*-comparison.json` retains source/production hashes, raw models, and native snapshots. These are not passing tests or corpus additions.

Final source-only models in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-class-heritage-reviewed-home-model.json`: SHA-256 `e7fe6b65d94a24385f7a4014c0b825698b6af19e18f138af111622072d7c4b18`
- `source-only-class-heritage-reviewed-memory-model.json`: SHA-256 `de85ee96b6102addd54d487e02d841b377782735c894de99920728be74e6cf43`

Serialized models match the strict-write checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,568 root tests with two existing skips and 1,522 analyzer tests across 93 files, plus typecheck/build, realms, lint, formatting, and documentation validation. Lint retains four unused-class-binding warnings in effectful declaration fixtures; removing those declarations would remove the tested evaluation. `class-heritage-reviewed-gates.json` verifies source hashes, baseline, 51 exact saved checks, two retained definition/invariant failures, fifteen other strict probes, models, controls, and unchanged 307-entry corpus bytes. Complete class/scope/descriptor/language/lifecycle semantics, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Computed class-key completion

`40e61a98` committed heritage and comma completion. Class-member collection now evaluates computed key expressions through guarded continuations before defining the class. `evaluateClassMembers()` preserves finite key alternatives, completing contexts, and ordered member prefixes. A throwing key stops later keys, static work, and constructor-call arguments. Concrete key evaluation remains iterative. Existing unknown-key, getter/setter, coercion, and class-scope limits are not treated as repaired.

Nine strict components cover the original key error, static work declared before a failing key, later keys and setter names, guarded failures, finite member names, repeated-key ordering, deferred instance fields, null/undefined payloads, and call boundaries. A 10,000-key direct control checks concrete sequencing without a budget increase. Baseline `/tmp/bippy-class-keys-baseline` at `40e61a98` fails seven and passes three controls; its test and nine fixtures match main by hash.

The initial implementation imported `toPropertyKey` from `values.ts`, which does not export it. Typecheck reports `TS2305`; seven focused checks failed, including empty models. Those logs remain at `/tmp/bippy-class-keys-first{,-typecheck}.log`. The corrected import is from `primitive-shapes.ts`; the corrected focused run passes 29 checks, and only corrected artifacts validate this phase.

The original computed-key snapshot now yields `caught:K`, repairing a four-step native mismatch that passed replay. All 51 earlier saved comparisons remain exact, for 52 total. Definition dispatch, frozen-target get invariants, and fourteen earlier strict probes remain unchanged failures on identical native snapshots. The five remaining class-definition probes still expose superclass/prototype validation, static-field/static-block completion, and eager static getter gaps.

Static initialization needs more than an early return on error: class properties still live in an unjournaled map. New fixtures in the baseline's `tests/fixtures/class-key-limits/` preserve this and two other limits:

| Case             | Source expectation                 | Model            |
| ---------------- | ---------------------------------- | ---------------- |
| `coercion`       | `caught:C`                         | `returned:S`     |
| `tdz`            | `caught:`                          | `returned:S`     |
| `static-capture` | `caught:missing`, `returned:ready` | `returned:ready` |
| `properties`     | `missing:false`, `ready:true`      | `ready:true`     |

The first three native captures mismatch in four steps. Four unforced property-mutation captures produce two four-step mismatches and two exact memberships; all four still fail the raw expectation. All seven have no omissions/exhaustion and passing replay. `class-keys-limit-*-comparison.json` preserves source/production hashes, raw models, and native snapshots. Effectful key coercion and class-name temporal dead zones remain unmodeled; guarded class writes lose absent paths. These are not passing tests or corpus additions.

The ECMAScript class-element/field-definition algorithms and the pinned React class-construction source informed the change. The member evaluator runs keys before field initializers; it does not invoke application bodies natively during analysis.

Final source-only models in `/tmp/bippy-many-games-causal-investigation/` are:

- `source-only-class-keys-reviewed-home-model.json`: SHA-256 `713b95523771a6dda94f30eb0cf99027daadffd4739d8cae1a1cb662e67f65f4`
- `source-only-class-keys-reviewed-memory-model.json`: SHA-256 `5d90f5e2696982800b0414eae2678ca560fb385022bf93ee8a8a7b7bdc66fa64`

Serialized models match the heritage checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial; ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,587 root tests with two existing skips and 1,541 analyzer tests across 94 files, plus typecheck/build, realms, lint, formatting, and documentation validation. Lint retains six unused-class-binding warnings in effectful declaration fixtures. `class-keys-reviewed-gates.json` verifies source hashes, baseline, 52 exact saved checks, two retained definition/invariant failures, twenty-one other strict probes, models, controls, and unchanged 307-entry corpus bytes. Complete class/scope/descriptor/language/lifecycle semantics, causal modeling, renderer integration, and 500-repository acceptance remain open.

### Callable property storage and prototype ownership

After `769684fc`, function/class values and their React component definitions now share `StaticObjectValue` property storage instead of maps. Explicit writes and deletions use the existing heap journal; class storage links to parent-class storage for inherited reads. Presence remains distinct from an explicitly stored undefined. Call frames retain property snapshots, and known-key comparisons still gate recursive-call reuse. Compiler helpers, component naming, legacy-context reads, hoisting, and escape reads use the same storage. Wrapper-object maps and descriptor-sensitive behavior remain separate limits.

Function own-property methods previously returned unknown before reaching the common builtin dispatch; they now reach the presence check. Function/class prototypes are initialized before guarded program work. This matters even when program code first reads a prototype inside a branch: a lazy cache must not make that intrinsic appear newly allocated on only that path. `hasPrototype` tracks own prototype shape through function and component definitions. Methods, arrows, ordinary async functions, and bound functions do not acquire ordinary constructor prototypes; generator shape has a prototype. This flag is not an implementation of `IsConstructor`.

Fourteen strict component cases cover class/function property additions, replacement, undefined presence, inherited fallback and shadowing, deletion, ordinary and bound controls, guarded prototype replacement, prototype and prototype-method property writes, and prototype-kind/enumerability controls. The configurable class-name field remains enumerable while the intrinsic function prototype does not. Final baseline `/tmp/bippy-callable-storage-baseline` at `769684fc` fails eleven cases and passes three controls; its test and fourteen fixtures match main by hash. Earlier baseline stages remain in `/tmp/bippy-callable-properties-baseline` and `/tmp/bippy-callable-state-baseline`.

Failures were retained rather than relabeled:

- The initial duplicate import prevented test collection, and typecheck identified a missing context import, remaining map accesses, and a private helper used as an export. Corrected code exports the existing `getKnownOwnKeys` helper.
- A cross-worktree inspection helper could not import main's `file:` fixture URL. The main-owned retry succeeded; neither preparation failure nor its output is semantic validation.
- The first broad run failed constructor-function components and the CommonJS fixture because the prototype reader treated modeled undefined as a present property. The corrected reader checks presence.
- A subsequent 3,607-test broad pass still missed a guarded prototype regression. `callable-properties-prototype-regression.log` fails one of eleven checks; the corresponding baseline passes that control. Original prototype and prototype-method captures also retained missing-path contradictions.
- Eagerly allocating an ordinary prototype for every method prevented the fresh-receiver recursion guard from reaching a fixpoint. `callable-state-final-package-tests.log` retains one failure and 1,566 passes. AST method information and prototype-shape flags repair this without relaxing the recursion guard or changing budgets.
- `callable-storage-enumerability-before.log` retains the intrinsic-prototype enumerability failure. The final control also checks that a class's explicitly defined name field remains enumerable.

The four original class-property snapshots and four later prototype/method-property snapshots now satisfy strict concrete expectations and identical native captures. All 52 earlier saved comparisons remain exact, for 60 total. The original raw failures, including exact memberships that accepted incomplete models and passing replay, remain in `/tmp/bippy-many-games-causal-investigation/`. Final outputs use `callable-storage-*`; earlier `callable-properties-*` and `callable-state-*` outputs are not final evidence.

Two older definition/invariant contradictions and seventeen other strict probes remain unchanged failures. In particular, static field/block completion and escaped partial classes are not repaired by changing property storage. Superclass validation, eager static getters, class-name temporal dead zones, effectful key coercion, descriptors, integrity, reflection, wrapper mutations, conditional hoisting, and instance-method metadata remain unverified.

Reviewed sources include ECMAScript `MakeConstructor`, method-definition evaluation, and class-definition evaluation, plus the pinned React class-construction/context/static-property paths. Analysis still interprets application bodies; independent Bippy rendering supplies native evidence separately.

Final source-only model wrappers are:

- `source-only-callable-storage-reviewed-home-model.json`: SHA-256 `120242bd206eb76e2969ad1de0243e2bde9434ef792d6e35a8d679444637eec9`
- `source-only-callable-storage-reviewed-memory-model.json`: SHA-256 `27e047a37ac049af69bd4c54bb81e6dbe9923f821d06b5eedfafbd47e648d372`

Serialized models match the computed-key checkpoint: 11 states, seven wildcards, and one subtree omission. All 53 saved workflows remain partial; ten repeated corpus-control rows remain unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added. The receipt checks twenty production/type hashes, including changed library/materializer/component adapters, not just the interpreter.

Final validation passes 3,615 root tests with two existing skips and 1,569 analyzer tests across 95 files, plus typecheck/build, realms, lint, formatting, documentation, and provenance gates. `callable-storage-reviewed-gates.json` verifies the baseline, corrected production, 60 exact saved checks, nineteen retained strict failures, models, controls, and unchanged 307-entry corpus bytes. This remains guarded-tree analysis, not a completed transition/reachability model or 500-repository acceptance.

### Static field and block completion

After `6713c752` established journaled callable storage and prototype ownership, `defineClass()` now returns a completion-aware `StaticValue`. Static fields install their value only after their initializer completes. Static blocks evaluate in a separate scope with a completion boundary. A throwing initializer skips later static work; selected completing paths retain their context and escaped class identity. Methods and prototypes already exist before static initialization. Class decoration and compiled-wrapper setup are entered only after class definition completes. Completion of the decorators/setup themselves remains unverified.

Ten strict component cases cover the original field/block errors, escaped partial classes, guarded field presence, preservation of an existing method when its replacement initializer throws, null/undefined payloads, constructor-call arguments, source order, finalizers, and locally handled errors. Baseline `/tmp/bippy-static-initializers-baseline` at `6713c752` fails eight and passes two controls. `static-initializers-reviewed.test.ts` and its ten selected fixtures match main by hash. The initial duplicate named method/field fixture passed semantic checks but failed TypeScript's lint parser. Its original source, test, lint failure, and failed provenance log remain. The passing fixture uses a computed key for the replacement field, preserving the same expectation without suppressing the diagnostic. Reviewed full gates validate the updated fixture set; reused models and saved comparisons have identical production/type hashes. An early reviewed receipt ran before the root-test/build job wrote its exit file and failed with `ENOENT`; that log remains. The completed receipt is recorded in `static-initializers-reviewed-provenance-complete.log` after the owned job exited successfully. Nonthrowing initialization stays iterative; the existing 10,000-static-key/field control remains in the full suite.

Three unchanged native snapshots now satisfy strict raw expectations and exact comparison: field `caught:F`, block `caught:B`, and escaped class `caught:missing` or `returned:ready`. They previously mismatched despite passing replay. All 60 earlier saved checks remain exact, for 63 total. Two older definition/invariant contradictions and fourteen other earlier strict probes remain unchanged failures.

A new guarded-loop probe still fails. Its original eleven-case candidate suite and source remain unchanged in the baseline; the loop fixture was removed from the passing fixture set only after verifying preserved hashes. Neither evaluating the block directly nor adding its synthetic-function completion boundary fixed the loop's later-iteration effects. `/tmp/bippy-static-initializers-{expanded,block}.log` retain the failure.

The ordinary-function control also fails under the baseline's own interpreter before this change. `/tmp/bippy-static-initializers-ordinary-loop-baseline.log` shows missing `caught:01` and spurious `caught:012`, `caught:012L`, and `returned:012` states. The class-block probe emits `caught:012` rather than `caught:01`. This remains a loop continuation/guard problem, not a repaired initializer case.

Four independent Bippy captures preserve the loop limits under `static-initializers-limit-{loop,ordinary-loop}-{0,1}-comparison.json`: two native mismatches (six and eight steps), two exact memberships, all four failing strict raw expectations, with no omissions/exhaustion and passing replay. Sources are in the baseline's `tests/fixtures/static-limits/`; the ordinary control's test imports baseline relatively. No native application body is executed during analysis.

ECMAScript `DefineField`, class static-block and class-definition evaluation, and the pinned React class-construction path informed the implementation. Descriptor-sensitive field definition, eager static getters, static-block scope completeness, class-name temporal dead zones, superclass validation, effectful coercion, general loop completion, decorator/compiled-setup completion, lifecycle, and causal reachability remain unverified.

Final source-only model wrappers are:

- `source-only-static-initializers-reviewed-home-model.json`: SHA-256 `340e415fbf5688c028ff854bfabe9d436f477f4190b92b513268d1ea7bfad334`
- `source-only-static-initializers-reviewed-memory-model.json`: SHA-256 `000b39d0a3bd71ee5bfa65d33f8068eb1bf9a67e86bec795cc3e1841359d08e0`

Serialized models match the callable-storage checkpoint: 11 states, seven wildcards, one subtree omission. All 53 saved workflow snapshots remain partial, and ten repeated corpus-control rows are unchanged on identical captures. No app workflow traces, observations, forced inputs, budgets, or repositories were added.

Final gates pass 3,635 root tests with two existing skips and 1,589 analyzer tests across 96 files, plus typecheck/build, realms, lint, formatting, documentation, and provenance checks. `static-initializers-reviewed-gates.json` verifies twenty production/type hashes, the baseline, 63 exact saved comparisons, sixteen retained earlier strict failures, four new loop failures, models, controls, and unchanged 307-entry corpus bytes. Causal-model, renderer-integration, P1–P9, and 500-repository acceptance remain incomplete.

### Scoped loop-body continuations

Following static-initializer commit `abe61a74`, `/tmp/bippy-loop-completion-baseline` preserves that revision and uses its own source with main-owned dependency links. The selected `loop-completion-correlated.test.ts` and fourteen fixtures match main by hash: twelve baseline failures and three controls, including a generated 10,000-item ordinary `for…of` loop. Strict cases cover class blocks, outer catches, scalar/heap effects, ordinary returns, `for`/`while`/`do…while`, known `for…of`/`for…in`, skipped increments after throws, nested loops, multiple exits, and nonthrowing/continue controls.

The initial repair reforked a body outcome after its heap state had already been separated by deferred returning paths. It passed the new cases but introduced `machine.next = 8` in the existing switch-state-machine control, whose source permits only 4 or 10. `/tmp/bippy-loop-completion-candidate-package.log` retains one failure and 1,608 passes. Candidate interpreter/loop copies remain under `/tmp/bippy-loop-completion-refork-{interpreter,loops}.ts`.

A subsequent candidate resumed remaining iterations inside the body's continuation when its guard structurally differed from the entry guard. It restored the state-machine control and passed the new fixtures, but timed out `compiled-tslib-async.js` at the unchanged 20-second test limit, then left later component renders failing: 408 failures/1,208 passes. The isolated timeout reproduces; the unchanged baseline fixture passes. `/tmp/bippy-loop-completion-{scoped-package,tslib-scoped,tslib-baseline}.log` preserve this evidence. No timeout, budget, native behavior, or assertion was weakened.

The current implementation uses an explicit `EvaluationContext.scopedCompletionDepth`. `forkPaths()` advances it only when terminal and completing paths coexist. `evaluateLoopBody()` runs remaining iterations inside that completion context before terminal state rejoins; ordinary iterations remain in the caller's iterative loop. This avoids treating arbitrary guard structure as evidence of an early exit. `continueStatements()` retains the original completion predicate after the loop. Optional iterations and mixed jumps retain their previous handling. The state-machine assertion, 10,000-item control, and unchanged compiled fixture now pass. The initial full version passes 1,616 analyzer and 3,662 root tests with two existing skips. A final conditional-string control checks that the original throw flag remains correlated with the loop outcome; it does not repair direct boolean interpolation. Reviewed full validation of this expanded fixture set passes 3,664 root tests with two existing skips and 1,618 analyzer tests across 97 files, plus typecheck, build, realms, lint, formatting, documentation, and provenance checks.

The four original static-initializer loop snapshots now pass strict raw expectations and exact comparison on identical captures, including two that previously had exact membership despite wrong raw states. Together with the 63 earlier saved checks, this makes 67 verified comparisons; `loop-continuations-reviewed-gates.json` checks each independently. Sixteen older strict contradictions remain.

Five further limits were frozen and independently captured under `loop-body-completion-limit-{init,test,update-error,continue,break}-0-comparison.json`. Main-owned saved comparisons use `loop-continuations-phase-*-saved-comparison.json`. Initializer/test errors and mixed return/break have nonconcrete text despite exact membership. An update throw emits `returned:BUBUL` instead of `caught:BU`; mixed throw/continue retains `caught:012` instead of `caught:01`. Those two native captures mismatch. All five pass replay and have no omissions/exhaustion; none is passing strict coverage.

ECMAScript `ForBodyEvaluation`/`LoopContinues` and the pinned React class-construction path were reviewed. Loop initializer/test/update completion, optional iterations, mixed jumps/labels, iterator protocol, per-iteration lexical binding, class validation/scope/getters/descriptors, lifecycle, whole-program causality, reachability, and general scalability remain unverified.

Earlier loop model wrappers omitted the changed `loops.ts` from their support-hash inventory. They remain untouched. Corrected source-only wrappers include all 21 production/type hashes:

- `source-only-loop-continuations-provenance-home-model.json`: SHA-256 `3b0bae278a443a9b23e85556670d7fba294be2adb2303a52f39cbe672bf3e462`
- `source-only-loop-continuations-provenance-memory-model.json`: SHA-256 `9b53d39a3e4c6394ee82fab3026dd06580c8505e0e6022c4095bb016b898960d`

Both serialized models equal the static-initializer checkpoint. The 53 saved workflows remain partial, and ten repeated corpus-control rows are unchanged. There are no new app workflow traces, observations, forced inputs, increased budgets, or repositories. Corpus acceptance remains 307/500.

The static-initializer commit's first ad-hoc precommit hash helper incorrectly treated the production array as a record and tried to read `evaluate/0.ts`; its compound shell continued and committed. The corrected `static-initializers-post-commit-verification.json` checks each actual filename/hash pair, all gate exits, commit success, and the then-clean working tree. The earlier successful provenance receipt checked the same production hashes.

### Loop initializer, test, and update completion

After `ed7375a9`, `/tmp/bippy-loop-expressions-baseline` preserves the prior interpreter. Seventeen selected fixtures and `loop-expressions-clean.test.ts` match main by hash; fourteen fail on baseline and three controls pass. The original twelve-case and expanded seventeen-case suites remain under separate names. Final fixtures remove unused random flags, use descriptive names, and include conditional-string initializer/outcome correlation. The earlier sources remain unchanged in the baseline; the original native captures still use their original source files. This does not repair direct boolean interpolation.

`continueStatementValue()` distinguishes completing, throwing, and mixed expression results. Mixed paths pass the guarded nonthrowing value into the statement continuation. Conditional-loop tests check completion before truthiness and reuse the completing test value rather than evaluate an effectful test again. `for` declaration headers use their original AST statement evaluator, preserving ordered declarators and stopping at the first error. Expression initializers and updates use the same completion boundary. Nonthrowing iterations remain iterative; guarded body/update combinations preserve effect order and payloads.

Cases cover initializer/test/update errors, guarded variants, declaration order, expression headers, null/undefined payloads, updates after a definite continue, body/update errors, zero iterations, while/do…while tests, skipped tests after break, and one-iteration controls. ECMAScript `ForLoopEvaluation`, `ForBodyEvaluation`, and the pinned React construction path were reviewed. The initial focused and full analyzer suites pass. Reviewed validation of the final cleaned fixture set passes 3,698 root tests with two existing skips and 1,652 analyzer tests across 98 files, plus typecheck, build, realms, lint, formatting, documentation, and provenance checks. Fixture cleanup began while the first full gate job was still active; that job subsequently reported success, but it is not used to validate the final fixture set. Its logs remain, and the reviewed job runs after it exits with the final files unchanged.

The original `init`, `test`, and `update-error` snapshots now meet strict concrete expectations and exact comparison on identical native captures. The first two previously had exact membership despite nonconcrete output; the update capture previously mismatched. All 67 earlier saved checks remain exact, for 70 individually verified comparisons in `loop-expressions-reviewed-gates.json`. Sixteen older strict contradictions and the two mixed-jump limits remain.

Three additional failures are frozen under `loop-expressions-limit-{for-of,for-in,unknown-test}-0-comparison.json`, with unchanged-source/saved-capture reanalysis under `loop-expressions-expression-*-saved-comparison.json`. Their expected results are `caught:R` for iterable-expression errors and `returned:TBTL` or `returned:TL` for a bounded unknown test. Each instead has nonconcrete text despite exact four-step membership, passing replay, and no omissions/exhaustion. They are not passing strict coverage.

Final source-only wrappers preserve all 21 production/type hashes:

- `source-only-loop-expressions-reviewed-home-model.json`: SHA-256 `abe758e0c65543fa378a4b02a2de72336757b22d6cd617bfec72b8529c2b9895`
- `source-only-loop-expressions-reviewed-memory-model.json`: SHA-256 `7dd9034766dfb7cef1a3dbb05f9e7723b2e555d6220dbb2069a5b27fa22127e7`

Serialized models equal the loop-continuation checkpoint. The 53 saved workflows remain partial and ten repeated corpus-control rows are unchanged. Models and saved comparisons can be reused across the fixture cleanup because all production/type bytes remain identical. No app workflow traces, observations, forced inputs, increased budgets, or repositories were added; acceptance remains 307/500.

Iterable expressions, iterator protocol, uncertain tails, optional iterations, mixed jumps/labels, per-iteration lexical bindings, destructuring, class validation/scope/getters/descriptors, renderer lifecycle, causal transitions, reachability, and general scalability remain unverified. `loop-expressions-single-iteration.tsx` intentionally retains its constant-condition lint warning.

### Loop source-expression completion

The detached `/tmp/bippy-loop-sources-baseline` at `ff4a6563` reproduces seven failures and three controls across ten fixtures. `loops.ts` now evaluates a `for…of`/`for…in` source once and passes completing values and their contexts through `continueStatementValue()` before extracting iterations. Throwing sources skip assignment-target evaluation and body effects. Tests cover guarded arrays/objects, correlation, getter failures, null/undefined payloads, empty arrays, nullish `for…in`, and strings. ECMAScript `ForIn/OfHeadEvaluation` and the pinned React constructor path were reviewed.

Validation passes 3,718 root tests with two existing skips and 1,672 analyzer tests across 99 files, plus typecheck, build, realms, lint, formatting and documentation checks. The receipt is `/tmp/bippy-many-games-causal-investigation/loop-sources-reviewed-gates.json`; the successful log is `/tmp/bippy-loop-sources-provenance-complete.log`. An earlier receipt attempt lacked the review exit file and remains preserved. All 21 production/type hashes match the models and saved comparisons. The legacy argument-order helper now records that full inventory rather than only the unchanged interpreter hash.

Both original iterable-expression captures now meet concrete expectations, bringing saved exact checks from 70 to 72. Nineteen older strict failures remain. Five additional probes preserve iterator-getter, next-getter, null-for-of, eager iteration/absent closing, and loop-head temporal-dead-zone failures. The first three produce nonconcrete text despite exact membership. The closing probe produces `returned:NNNNBL` instead of `returned:NBRL`; the temporal-dead-zone probe produces `returned:1L` instead of `caught:`. Both mismatch native captures. All five pass replay without omissions or matcher exhaustion; none is repaired by source-expression completion.

Full serialized source-only models equal the loop-expression checkpoint. The 53 saved workflows remain partial; ten corpus controls remain unchanged; acceptance remains 307/500. No application observations, new workflow traces, forced inputs or increased budgets were introduced. Concurrent conformance fuzz-test files appeared after the root gate; they belong to separate work and are not included in this validation claim.

At the user's request, the architecture page moved into `packages/bippy-analyzer/docs/architecture.md`. Its 86 relative links and plan reference were rebased, incoming links updated, and the relocated page's links and executable examples validated. The active package is `bippy-analyzer`, not a new `packages/analyzer` directory. Module-graph source research is the next requested workstream.

### Module graph research and parity plan

The user requested deep source research into Knip, Turbopack, webpack, Rolldown, SWC and esbuild, followed by improvements toward parity. Notes are in [Module graph research and parity work](packages/bippy-analyzer/docs/module-graph-research.md). They pin six locally cloned revisions, identify the inspected mechanisms and code, compare Bippy's current graph, and separate proposals from implemented behavior. No full upstream toolchain suite or comparative benchmark has been run.

The first bounded implementation follows terminal export bindings rather than selecting the first internal star export. `/tmp/bippy-module-exports-baseline` preserves `741d591d`. Tests retain twenty source-derived expectations across ten cases and both declaration orders. Internal conflicts propagate structured ambiguity; alias diamonds, explicit overrides and cyclic paths retain their intended resolution. Namespace enumeration, ESM instantiation errors, CommonJS/external-star uncertainty, incremental invalidation and dependency-occurrence provenance remain separate work.

The initial cross-tool assumption was too broad. Installed esbuild 0.28.2 rejects the valid-source cyclic case, whereas Node 24.21.0 links it. Node rejects the same-module namespace diamond that esbuild accepts and the reviewed specification resolves. Initial tests and failing logs remain under `/tmp/bippy-module-exports-*`; source-derived analyzer expectations are unchanged. Final test data separately records exact native and bundler outcomes, including these disagreements. Native checks only construct/link modules; they never evaluate them. A failed URL-based helper setup is preserved separately from semantic failures.

The candidate's full suite exposed an actual regression in the existing `commonjs-package` fixture: the new ESM conflict rule was applied to CommonJS getter loops reconstructed as star re-exports. The correction retains previous lookup handling when `ModuleRecord.isCommonJs` is true. The unchanged native fixture and all twenty source-derived export cases pass. This does not establish complete CommonJS semantics.

The concurrent `5550f6b7 init` commit included the notes, first candidate, tests and type interface along with other work. It was preserved, not reset or attributed solely to this repair. Subsequent broad jobs exited successfully: the analyzer job reports 1,805 passed and 40 expected failures; the root job reports 3,920 passed, two expected failures and two skips. Concurrent fixtures changed between and during those jobs, so these are not one frozen full-suite checkpoint or counts of newly repaired behavior. Typecheck, build, realms, scoped lint/format, relocated architecture examples/links, and research links pass. The owned twenty-case suite and linking helper remain hash-equal to the reviewed baseline copies.

The separate differential suites were not weakened by this work. Their committed `5550f6b7` versions report 110 passes and 38 expected failures on `741d591d`. Immutable external copies with expected-failure annotations removed reproduce 38 strict failures and 110 passes. Those are retained counterexamples, not additional semantic coverage or repository acceptance. Later concurrent fixture revisions require separate accounting.

`/tmp/bippy-many-games-causal-investigation/module-export-origins-reviewed-gates.json` records 25 production/type/graph-source hashes, 72 unchanged strict/exact saved checks, and 24 unchanged strict failures. Full serialized source-only models match the loop-source checkpoint; 53 saved workflows remain partial and ten repeated corpus controls are unchanged. Corpus acceptance remains 307/500. The earlier candidate comparisons and CommonJS failure are preserved. The research-link validator caught a guessed specification anchor; it was corrected to the source's `sec-resolveexport` anchor without suppressing the failed check.

Next steps: coordinate a frozen all-fixture gate, inspect namespace and external uncertainty counterexamples, and implement invalidation only after defining graph lifetime. Do not equate import reachability, export usage, bundler liveness or task dependencies with React causal reachability. No transition-system rewrite, native application evaluation during analysis, source observations, new workflow traces, increased budgets or corpus additions were introduced.

### Namespace export membership

`getNamespaceMember()` and `materializeNamespace()` now omit proven internal ESM star ambiguities without changing CommonJS lookup. Eight source-derived namespace/property cases have strict native ESM captures and replay checks; six fail on `5e6686ce`, while override and diamond controls pass. The fixtures live under `tests/components/internal/namespace-exports` and are exercised explicitly, not through the application-fixture launcher.

Native ESM and Vitest SSR disagree on five namespace observations. The installed Vite module runner's `exportAll` copies the first key and keeps insertion order. The dedicated suite asserts those SSR observations separately and uses V8 module records, JSX-only lowering, actual React, and Bippy commit recording for source semantics. Static models and concrete expectations precede independent execution. No native application execution was added to analysis.

`Object.hasOwn` was unmodeled: the initial spread probe's uncertainty did not demonstrate a spread-copy defect. An unnecessary eager-spread candidate was preserved and reverted. The implemented API reuses own-property presence, boxes known primitives, supports a missing key argument, and rejects nullish targets before key coercion. Effectful key coercion and proxy descriptors remain incomplete. The wrong initial error-constructor signature and failed typecheck are retained in `/tmp/bippy-namespace-exports-own*` logs.

Two whole-working-tree frozen attempts are preserved. The first mistakenly put these module cases under the auto-launched application fixture directory, causing a missing `src/main.tsx` and an unhandled commit timeout. The second includes concurrent unfinished async differential tests and a `compiled-tslib-async.js` 20-second timeout followed by empty runtime captures. Neither is an accepted full-suite checkpoint. No timeout, budget, source expectation, or independently authored expected-failure annotation was weakened. Final validation isolates the owned patch on `5e6686ce`; uncommitted concurrent work remains untouched and outside that candidate's scope.

Eight immutable native models/captures/comparisons are under `/tmp/bippy-many-games-causal-investigation/namespace-exports-native-*`. Their standalone analysis helper completed assertions but stayed alive; its exact PID, start, command and descriptors were inspected before termination. The nonzero exit and lifetime record are preserved, not presented as SDK cleanup. Native capture children exited successfully.

The owned candidate initially passed 1,810 analyzer tests with 38 existing expected failures, and 3,887 root tests with 38 expected failures and two skips. A subsequent review still found an overconfident answer: converting a namespace to enumerable string exports before `Object.hasOwn` incorrectly returned `no` for its non-enumerable `Symbol.toStringTag`. The native result is `yes`. The rejected model/capture remain in `namespace-symbol-*` artifacts. Removing that lossy conversion restores uncertainty; a ninth safety check expects both modeled alternatives and the native `yes`, not a full semantic match. Positive expectations were not relaxed.

Final revalidation uses the `namespace-membership` phase and `/tmp/bippy-namespace-membership-owned`, a fresh frozen `5e6686ce` tree plus only the owned patch. The analyzer gate passes 1,811 tests with 38 existing expected failures across 105 files; the root gate passes 3,888 tests with 38 expected failures and two existing skips. These counts do not include unfinished uncommitted concurrent work or turn expected failures into semantic passes. Typecheck, build, realms, scoped lint/format, and documentation checks pass. The root log retains its source-test URL 404 without claiming a repair or cause.

`/tmp/bippy-many-games-causal-investigation/namespace-membership-reviewed-gates.json` verifies 25 production/type/graph-source hashes and equality of all analyzer/Bippy source files with the frozen candidate. The 72 historical strict/exact probes and 24 historical strict failures are unchanged; the same eight new native captures remain strict/exact with identical full models. The namespace-symbol case remains a separately recorded strict failure, bringing the retained count to 25. Full source-only application models are unchanged, 53 workflows remain partial, and ten corpus controls are unchanged. The final ledger update changes documentation only after that frozen run.

Separately authored async differential cases reproduce 31 failures and 15 controls on unchanged `5e6686ce`; they were not annotated, reset or staged by this work. A whole-current-working-tree pass is not claimed. Corpus acceptance remains 307/500. The six-tool research page records the namespace semantics, SSR disagreement, capture boundary and remaining parity work.

### Opaque external star exports

The next module-graph pass separates unavailable export information from known absence and definite ambiguity. `UnresolvedSymbol.isUncertain` propagates unmodeled external-star uncertainty through ESM barrels. Explicit bindings/re-exports retain precedence, default exclusion remains intact, and known conflicting bindings still prove ambiguity. CommonJS fallback and modeled-library early returns remain separate; this is not complete external or module-instantiation semantics.

`/tmp/bippy-external-stars-baseline` preserves `0a3031cd`. Fourteen cases in both declaration orders compare opaque and allowlisted graphs over identical files, then independently link through V8 and build through esbuild without application evaluation. The reviewed baseline has 16 failures and 12 controls; the candidate's 57 focused checks pass, including the previous export-origin and namespace suites. The unchanged CommonJS fixture passes. Initial esbuild checks on elidable TypeScript re-exports are preserved; the reviewed consumer uses a live imported value without changing source-derived expectations.

Source review revisited ECMAScript ResolveExport, webpack's provided/unknown export checks, Rolldown's NoMatch/Found/External distinction, esbuild's dynamic-export propagation, and React's module/default/own-property loading branches at their pinned local revisions. The research page records the boundary and remaining gaps.

`/tmp/bippy-external-stars-owned` freezes `0a3031cd` plus six owned files, excluding unfinished concurrent work without changing it. Gates pass 1,839 analyzer tests with 38 existing expected failures across 106 files, and 3,916 root tests with 38 expected failures and two existing skips. Typecheck, build, realms, scoped lint/format and documentation checks pass. Counts of expected failures are not repaired semantics; a whole-current-working-tree pass is not claimed.

`/tmp/bippy-many-games-causal-investigation/external-stars-reviewed-gates.json` verifies 25 production/type/graph-source hashes and equality of all analyzer/Bippy source files with the frozen tree. All 80 strict/exact saved checks and 25 retained strict limits are unchanged on identical sources/captures. Full source-only application models and the eight saved native namespace models are unchanged; 53 workflows remain partial and ten corpus controls are unchanged. Final notes add documentation only after freezing. No new captures, observation inputs, increased budgets or repositories were introduced. Corpus acceptance remains 307/500; modeled-library early returns, unresolved requests, module instantiation, provenance and incremental invalidation remain open.

### Modeled star export identity

The next pass removes the modeled-library star early return. A modeled value/reference is not a terminal JavaScript binding. Differing external versus source references now retain uncertainty instead of claiming a conflict without origin evidence; identical references remain usable. A known non-external representative is retained so two known conflicting bindings still establish ambiguity regardless of the modeled star's declaration order. CommonJS lookup remains separate.

`/tmp/bippy-modeled-stars-baseline` preserves `c06b6e8a`. Fourteen cases in both declaration orders use the actual installed Redux 5.0.1 package through an unchanged symlink, with before/after ESM source hashes. The baseline has 16 failures and 12 controls; 85 focused candidate checks pass. Tests distinguish source-derived conservative outcomes from native linking results: uncertain modeled identity is not a claim that a valid import is definitely ambiguous. No Redux function or application body is executed by the linking checks.

The native linker now uses Node ESM resolution and the explicit parent-resolution flag, including Redux's real conditional import target. Existing origin/external suites use that same loader. Source review covered the React clone, webpack's terminal-binding comparison, the library model registry and actual Redux ESM declarations/exports. `/tmp/bippy-modeled-stars-owned` freezes `c06b6e8a` plus seven owned files. Gates pass 1,867 analyzer tests with 38 existing expected failures across 107 files, and 3,944 root tests with 38 expected failures and two existing skips. Typecheck, build, realms, scoped lint/format and documentation checks pass; 48 older linking checks also pass on the unchanged baseline with the updated native resolver. Concurrent differential work remains untouched and excluded.

`/tmp/bippy-many-games-causal-investigation/modeled-stars-final-reviewed-gates.json` verifies all analyzer/Bippy source bytes against the frozen tree, 25 production/type/graph hashes, the library registry and matching Redux manifest/ESM bytes in main and the frozen installation. All 80 strict/exact saved checks and 25 retained strict limits are unchanged on identical sources/captures. Full source-only application models and eight saved native namespace models remain unchanged; 53 workflows are partial, ten corpus controls are unchanged, and acceptance remains 307/500. The 28 graph checks include deliberate uncertainty expectations, not 28 exact rendering repairs. Final documentation-only edits follow the frozen run; terminal-origin resolution for modeled values, instantiation, richer provenance and cache invalidation remain open.

### Graph lifetime characterization

At `503f4a76`, source review and controlled filesystem probes confirm that loaded graph records persist independently of the source cache, missing graph records and resolver failures persist, and resolver targets remain cached after extension-priority, package-export and tsconfig-path changes. Source-cache entries also miss changes in transform dependencies and equal-size/equal-mtime source replacements. A fresh graph sharing a stale resolver or transform cache is insufficient. Loaded and unread modules can combine different filesystem versions; an existing graph is not an atomic snapshot.

`tests/module-graph-lifetime.test.ts` characterizes fourteen cases, including unchanged identity, deletion, virtual-module registration, ordinary/queried transforms and renderer derivation. `derive` retains loaded records; a newly constructed renderer sees the tested source edit without any component render or application-body execution. These assertions intentionally expose current cache boundaries, not repaired freshness. Keep source/project inputs fixed during analysis and replay. No production code, reload API or cache optimization is introduced. Source review revisited the React clone's runtime chunk cache and webpack's filesystem snapshot validation rather than treating either as a drop-in graph cache.

Validation uses `503f4a76` plus four owned test/documentation files under `/tmp/bippy-graph-lifetime-owned`. Frozen gates pass 1,881 analyzer tests with 38 existing expected failures across 108 files, and 3,958 root tests with 38 expected failures and two existing skips. Build, typecheck, realms, scoped lint/format and documentation checks pass. The focused graph/resolver suites pass 92 checks. The root source-test 404 remains in its log without a cause or repair claim.

`/tmp/bippy-many-games-causal-investigation/graph-lifetime-reviewed-gates.json` verifies all 246 analyzer/Bippy source files against committed `503f4a76` and the frozen candidate, including the unchanged 25-file production inventory. Earlier model/capture artifacts are retained by hash; the historical 80 strict/exact checks, 25 retained strict limits, workflows and corpus controls were not rerun in this production-unchanged pass. Concurrent differential changes remain excluded and untouched. Only the final ledger update follows the freeze. Watch-mode refresh, transform/config dependency provenance and coherent regeneration remain open; corpus acceptance remains 307/500.

### Unavailable module export propagation

At `2a05e242`, star aggregation discarded unresolved requests and unsupported internal sources as if they had no matching export. A shared unavailable-module result now carries `isUncertain` through direct imports and re-exports, and ESM star aggregation retains it. Proven source conflicts, explicit declaration precedence, default exclusion and CommonJS star lookup remain separate. No loader success or module instantiation is inferred from a resolved declaration.

`tests/unavailable-module-exports.test.ts` exercises eighteen cases in both declaration orders: missing relative/package requests, nested named/namespace/local re-export paths, known conflicts, explicit/default/empty controls, unsupported sources with an independent transform control, and a file removed after resolution. The preserved `2a05e242` baseline has 24 failures and 12 controls; 135 focused candidate checks pass. Native V8 links and esbuild builds are asserted independently without application evaluation. Native loading still fails for missing dependencies even when Bippy resolves an explicit declaration. The ECMAScript loading precondition and actual React manifest failure path were reviewed; parsing, global instantiation and richer failure provenance remain open.

`/tmp/bippy-unavailable-modules-owned` freezes `2a05e242` plus four owned files. Gates pass 1,917 analyzer tests with 38 existing expected failures across 109 files, and 3,994 root tests with 38 expected failures and two existing skips. Build, typecheck, realms, scoped lint/format and documentation checks pass. These frozen results exclude unfinished concurrent differential work, which remains untouched.

`/tmp/bippy-many-games-causal-investigation/unavailable-modules-reviewed-gates.json` verifies 25 production/type/graph hashes and all analyzer/Bippy source bytes against the frozen tree. All 80 strict/exact saved checks and 25 retained strict limits are unchanged on identical sources/captures. Full source-only application models and eight saved native namespace models remain unchanged; 53 workflows are partial and ten corpus controls are unchanged. Unlike the preceding documentation-only pass, these historical checks were rerun for the production change. Final ledger notes follow the freeze. The 36 new checks include uncertainty and loading-failure expectations, not 36 exact rendering repairs. Global loading/instantiation, parser failures, loader-specific semantics and cache invalidation remain open; acceptance remains 307/500.

### Unparsed export uncertainty

The parser-boundary probe at `3ba5e36f` preserved thirteen initial cases in `/tmp/bippy-many-games-causal-investigation/parser-boundary-probe.json`. It rules out a blanket parser-error rejection: current options report valid CommonJS top-level returns, omit diagnostics for some invalid declarations, and sometimes retain statements alongside errors. Contextual mode plus semantic checks agrees with native compilation only on these controlled cases; production parsing options are unchanged. Source review read the actual React Node loader, installed Oxc parser documentation/options, and esbuild's separate parse-success flag.

The bounded repair treats diagnostics plus an empty statement list as unavailable export analysis, not an empty module. `resolveExport` retains uncertainty and `collectExportNames` reports incomplete names, while keeping records and diagnostics. Query-transform failures do not fall back to valid raw source. Nine export cases across disk/query/virtual inputs plus fourteen parser controls cover genuine empty input, malformed dependency propagation and remaining validity limits. Native ESM linking, CommonJS wrapper compilation and esbuild builds never evaluate application bodies. The initial 40-case baseline and candidate runs are retained separately from the final empty-source control.

The final baseline has 20 failures and 21 controls; 176 focused candidate checks pass. `/tmp/bippy-unparsed-exports-owned` freezes `3ba5e36f` plus four owned files. Gates pass 1,958 analyzer tests with 38 existing expected failures across 110 files, and 4,035 root tests with 38 expected failures and two existing skips. Build, typecheck, realms, scoped lint/format and documentation checks pass. Concurrent differential work remains untouched and excluded from the frozen scope.

`/tmp/bippy-many-games-causal-investigation/unparsed-exports-reviewed-gates.json` verifies 25 production/type/graph hashes, all analyzer/Bippy source bytes against the frozen tree, matching installed parser manifest/API/docs bytes, and the retained initial parser probe. All 80 strict/exact saved checks and 25 retained strict limits are unchanged on identical sources/captures. Full source-only application models and eight saved native namespace models remain unchanged; 53 workflows are partial and ten corpus controls are unchanged. Documentation-only source citations and final ledger notes follow the freeze. The 41 new checks include parser-validity limits and are not 41 exact rendering repairs. Nonfatal diagnostics, namespace creation, global loading/instantiation and format-aware validation remain open; acceptance remains 307/500.

### Namespace symbol ownership and registry identity

The original namespace-symbol limit is now required to match its native `yes` capture exactly. For known symbol keys on modeled ESM namespace values, own-property checks recognize the specified non-enumerable `Symbol.toStringTag`; other symbols are absent. No enumerable export view is materialized to infer these facts. CommonJS-backed namespaces and non-symbol own-key queries retain their existing behavior.

The prerequisite identity repair separates `Symbol.for("Symbol.toStringTag")` from the well-known symbol. Reserved registry names, allocation IDs and escape-prefix names use distinct internal keys while preserving registry descriptions, formatting and object-symbol enumeration. Ordinary registry keys, including React's tags, retain their existing identities. React's actual `ReactSymbols.js`, the specification's namespace property definition, and Vite's namespace tag descriptor were reviewed.

The revised namespace suite has three baseline failures and eight controls; two native cases cover ownership/enumerability and registry-key separation. Seven value-level checks cover identity/description preservation and allocation/prefix collisions. Initial single-text-child fixtures produced no HostText for the extractor; their sources/logs are retained, and mixed host children were used before the semantic baseline was rerun. This setup correction is not a semantic repair.

`/tmp/bippy-namespace-symbols-owned` freezes `a7a026a9` plus nine owned files. It passes 1,967 analyzer tests with 38 existing expected failures across 111 files, and 4,044 root tests with 38 expected failures and two existing skips. Build, typecheck, realms, scoped lint/format and documentation checks pass. The `namespace-symbols-reviewed-gates.json` receipt verifies all 246 analyzer/Bippy source files against the frozen tree and 25 selected production hashes. Documentation-only final notes follow freezing.

The 80 prior exact saved checks and 24 other strict limits remain unchanged. The former symbol limit is now exact on its unchanged source/capture; two new native fixture captures follow frozen source-only models. This yields 83 strict/exact checks and 24 retained limits. Full application and eight prior native namespace models remain unchanged, 53 workflows remain partial and ten corpus controls are unchanged. Initial overlapping positional lane launches caused a protected `EEXIST`; corrected `--lane=1` completes the other four controls. A premature workflow check failed before model readiness and was rerun. Initial model and successful lane-zero launcher exit statuses were not recorded; their completed artifacts are verified directly, without a cleanup claim. Concurrent differential work remains untouched; acceptance remains 307/500.

### UI-five corpus expansion: 317 repositories

Ten original Vite todo/kanban applications bring the corpus from 307 to **317 distinct GitHub repository IDs**, leaving **183**. Selected reports contain four exact initial comparisons, five partial comparisons and one budget-exhausted, inconclusive stored mismatch. Every prior manifest/result row and its raw bytes through the last array element remain unchanged; results were appended, not formatted. No analyzer/Bippy production source changed.

The exact entries are Sadikou, Devpedrofurquim, Thapatechnical and Azlanibrahim1. Their stronger policies interpret original installed Lucide or React Router sources. Source-only models, frozen without observations before those policies' comparisons, also match the native captures exactly. These policy models follow the original captures; only the base source-only models precede native execution. Exact initial fibers do not establish attributes, navigation, task operations, drag behavior or reachability. Azlan's dynamic-key diagnostic remains.

Gulugulu33 retains Ant Design's addonAfter warning and 3.3% strict coverage. Phixyn retains the opaque router/NavLink slot limitation and 15.9% strict coverage. Drag Track retains thirteen bounded states, three repeat omissions and twelve incomplete replay assignments. Muhammad Faizan Tariq retains partial DnD provider/portal coverage. Marmelab retains the original first-child warning, original twelve-post data provider and 0.15% strict coverage; opaque Admin membership does not verify its board behavior.

Rendy's original usehooks-ts source reduces the bounded model from 512 to two states, but both comparisons still exhaust 200001 matcher steps. The stored mismatch is inconclusive, despite passing sampled replay. Its base policy, 260 omissions and both repeated exhausted results remain separate evidence. No budgets, UUIDs, storage, dates, theme, responses, interactions or authored defaults were changed.

All ten frozen installs and independent installed-tree/actual-launcher audits pass. Source/configuration bundles were read before native execution. Native captures and both base repetitions are retained; five source-policy trials also repeat full report/runtime/static/state-space/replay fields. Final source-only comparisons re-enumerate the frozen full models and use the unchanged native snapshots without observation injection. `/tmp/bippy-ui-five-{verified,import}.json` records selections, hashes, audits and limitations; original evidence stays under `/tmp/bippy-parser-ui-expansion-{three,four}`.

Three initial source-model children completed artifacts but retained resources. Their exact PID/parent/start/command ownership was checked before termination; launcher status 1 is preserved. Later isolated model children explicitly exit after writing evidence. Neither path proves SDK cleanup. Both native batch launchers, the stronger-policy launcher and post-capture runtime audit launchers exit zero.

The owned-only freeze at `/tmp/bippy-ui-five-owned` passes offline frozen installation, build, typecheck, fifteen manifest tests, executable architecture documentation checks and scoped formatting. Both schemas, prior raw-byte/row preservation and all unchanged analyzer/Bippy source hashes verify separately. This data-only gate does not rerun the full suite or certify concurrent differential changes. Final documentation notes follow that freeze.

Two disjoint saved-discovery ranges were prepared under `/tmp/bippy-parser-ui-expansion-{six,seven}`: 100 and 99 pinned repositories, plus one retained preparation failure. These 199 preparations add no acceptance. Five original CRA applications have separately reviewed source/startup bundles and frozen-install attempts under `/tmp/bippy-ui-eight-*`; they are not counted yet. The 500-repository, causal-model, renderer-independent and whole-space gates remain open. Concurrent differential work is untouched; nothing pushed.

### CRA/timer/quiz corpus expansion: 325 repositories

Eight more original repositories bring the corpus to **325 distinct GitHub IDs**, leaving **175**. Three CRA and five Vite applications produce six exact initial reports and two partial reports. Their full comparison fields repeat twice against identical independent Bippy captures. Base source-only models precede capture and independently reproduce the reported exact/partial membership without observation inputs. `/tmp/bippy-ui-next-{verified,import}.json` records source/model/capture hashes and before/after installed-tree/runtime audits. Prior 317 raw rows remain unchanged; no production source changed.

Nas5w's exact React16.9 fibers coexist with two original TS2306 diagnostics about importing `types.d.ts`. They remain in the capture and report; no compiler-success or unobscured-pixel claim follows. Suporteb7web and ChrisWiles preserve authored tasks, styled-components and autofocus. Jose Guilhermeg preserves the idle 25:00 timer and original sound loading; Weibenfalk preserves its Start screen without invoking OpenTDB. Godkingjay preserves the original base path, setup controls, empty score history and DOM-only pagination, which fiber matching does not verify. None establishes task, timer, quiz or audio transitions.

Heitor's unfinished Home remains partial with fixed 00:00 text, opaque icons and the original `date-theme` typo. Ayokanmi's original local JSON fetch produces four subject cards; the partial report retains seven opaque icons and the native resource-404 warning without attributing its cause. Both sampled replays pass, not full interaction/whole-space checks. No storage, date, random, backend, theme or user-action inputs were supplied.

Machado and Biantris remain uncounted after installed-tree audits reject their Yarn fsevents resolution. Ghost Pomodoro remains uncounted: original Vite serves no React commits and reports 404s with no runtime snapshot/report; no HTML was invented. The copied Vite version-probe parser initially launched original CRA scripts instead of version-only commands. Exact process ancestry/start/command was recorded before termination; a process-exit race caused the stop helper's assertion to fail, and subsequent inspection found none of its recorded processes alive. Corrected probes and fresh tree checks pass for the three selected CRA apps. These are harness setup failures, not app repairs or cleanup proof.

Godkingjay's first runtime audit rejects npm9.2 versus launcher npm10.9.2. Its original installed npm dependency shadows the outer tool; a separate probe verifies that exact local package/version alongside Node22.16 and pnpm10.12.1. The app, lock and launcher remain unchanged. Original failed receipts are retained. Selected source/native/repetition/post-audit launchers exit zero; isolated model helpers explicitly exit after artifacts and do not establish SDK cleanup. Concurrent differential work stays separate; nothing pushed.

The isolated `/tmp/bippy-ui-next-owned` candidate at `b3887f4d` plus exactly four data/docs files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. `/tmp/bippy-ui-next-owned-gates.json` records all six successful exits. This data-only gate does not rerun the full suite or certify concurrent tests. Batch ten has six source-reviewed preparations entering frozen installation, not additional acceptance.

### UI-ten corpus expansion: 331 repositories

Six original Vite repositories bring the corpus to **331 distinct GitHub IDs**, leaving **169**. `/tmp/bippy-ui-ten-{verified,import}.json` records all six frozen source-only models, independent native captures, two identical same-capture repetitions, before/after installed-tree and actual-launcher runtime audits, and fresh GitHub identities. All selected launchers exit zero; original source and locks remain unchanged. Prior 325 raw result rows are preserved. No production change or full-suite claim accompanies this batch.

Five reports remain partial: Scdjango's guest login route has 2.9% strict coverage and a resource-404 warning; Labtasker's public landing has 16.9%; Orodrigogo's web-development timer Home has 12.5%; Ayokanmi's Chakra3/React19 quiz Home has 5.4%; M0hc3n's empty-name Home has 11.8%. Router/provider opacity, seven Chakra text-slot divergences and the original whitespace-slot mismatch remain. Ayokanmi uses 168446 matcher steps without exhaustion. No backend, task, credential, theme, question or name input was supplied.

Krutie's initial XState quiz screen matches exactly, but its bounded model has **240 states, three wildcards and sixteen incomplete sampled replay assignments**. That membership does not validate XState semantics or transitions. The native resource-402 warning and original inspector remain. Orodrigogo retains both `chrome is not defined` errors and its authored ten-minute fallback; this is the original Vite web workflow, not Chrome-extension background/storage/notification acceptance. No browser API or random/time values were invented. Model-child explicit exits remain separate from SDK cleanup proof.

The preceding eight additions are committed in `32713d2c`; nothing pushed. The frozen `/tmp/bippy-ui-ten-owned` candidate at that parent plus exactly four data/docs files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting; `/tmp/bippy-ui-ten-owned-gates.json` records all six successful exits. The full suite and concurrent differential work were not rerun or certified.

Batch eleven has twelve reviewed CRA preparations. Eleven pass install/tree/runtime audits; Ronnehag's lock lacks two declared dependencies and installation fails. Erfanshafaat's placeholder homepage causes `ERR_INVALID_URL`; Delicious Insights' React runtime cannot load. Neither produces an analysis report, and neither counts. Nine remaining candidates have native reports and two unchanged-capture repetitions but await final audit/import. Concurrent differential edits remain untouched.

### UI-eleven corpus expansion: 340 repositories

Nine audited CRA repositories bring the corpus to **340 distinct GitHub IDs**, leaving **160**. Three initial reports are exact, two truncated, three partial and one a genuine non-budget-exhausted mismatch. `/tmp/bippy-ui-eleven-{verified,import}.json` records frozen pre-capture source models, independent native captures, two identical same-capture repetitions, before/after installed-tree and runtime audits, unchanged sources/locks and fresh identities. All selected launchers exit zero. Prior 331 raw result rows remain unchanged; production code is unchanged.

Wllm Chandler's original twelve-character board, Elisa Amaral's idle 25:00 RESTING timer and Caknoooo's styled Start screen match exactly, with one state each and no opaque nodes/wildcards. Wllm's missing-key warning remains. Caknoooo's original lib-root tsconfig stays byte-identical. No click, shuffle, timer/audio, OpenTDB, footer-DOM or compiler-success claim follows from those fiber matches.

0shuvo0's sixteen-card and Michfah's twelve-card boards remain truncated: each has one repeat omission above two; their bounded models have three/four states and dynamic-key diagnostics. Four sampled assignments pass for each without verifying random order, attributes or gameplay. Palgorhythm's partial Redux Provider has **zero strict coverage**, one repeat omission, one wildcard and two incomplete assignments. Fontainm's partial MUI/reveal/tilt board has 2.2% strict coverage and 79 opaque tree nodes. Nicolaeciobanuu's idle timer has 90.2% strict coverage and one opaque icon; notification permission behavior is untouched.

Quocbao's original read-only Firebase GET returns tasks and an authored duplicate-key warning. The report mismatches at `TodoDetails` after the static path ends, without budget exhaustion. Its five bounded states, repeat omission and two incomplete replay assignments do not resolve that mismatch. No task data was supplied and no POST/PATCH/DELETE was triggered. Remote data availability is witnessed, not a backend or whole-space guarantee.

Node16.20.2 launchers use npm6.14.18 for v1 npm locks and npm8.19.4 for newer locks, preserving peer policy without overrides or conversion; actual tools and installed locations match before/after. Ronnehag remains excluded for missing lock dependencies; Erfanshafaat for its invalid placeholder homepage; Delicious Insights for React-runtime loading failure. Failed source/native attempts remain separate, not silently retried or repaired. Model-child explicit exits are not SDK cleanup proof.

The six prior additions are committed in `86d1e812`; nothing pushed. The isolated `/tmp/bippy-ui-eleven-owned` candidate at that parent plus exactly four data/docs files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. `/tmp/bippy-ui-eleven-owned-gates.json` records all six successful exits; full-suite and concurrent differential certification remain separate.

Batch twelve has twelve reviewed source bundles and eight install/tree/runtime-approved candidates. Joselyndrf's unpinned global JSON-server requirement is excluded without a substitute. Developer Junaid and Ruineto have inconsistent npm locks; Rahul's install changes the tracked `yarn.lock`, rejected by the source/tree audit. These failures remain uncounted and unrepaired. Two disjoint clone-preparation lanes cover the remaining 178 metadata candidates; clones alone do not count. Concurrent differential changes remain untouched.

#### UI-twelve corpus expansion: 348 repositories

Eight audited CRA repositories bring the corpus to **348 distinct GitHub IDs**, leaving **152**. Two initial reports are exact, one truncated and five partial. `/tmp/bippy-ui-twelve-{verified,import}.json` records source-only models frozen before independent native captures, two identical same-capture repetitions, before/after installed-tree/runtime audits, unchanged sources/locks and fresh identities. All selected launcher stages exit zero; prior 340 raw result rows and all 246 production source files remain unchanged.

- **Exact:** Gizem's 33-node difficulty selection has one state; Nathan's original 40-card board matches 164 fibers but retains two bounded states and one unwitnessed `Object.values` branch. Nathan's `imageKey` DOM-prop warning remains. Neither proves card interactions, random image identity or attributes.
- **Truncated:** Saad's authored OpenTDB question/category requests produce Welcome with 24 category iterations. Seven bounded states, a repeat omission above two and a dynamic-key diagnostic remain. Six sampled assignments and outside-enumeration matching replay pass; network cardinality and quiz transitions are not exhaustive.
- **Partial:** DCavalcante's options screen has 83.8% strict coverage and four opaque icons; Shehza's root-to-welcome startup has 31.6% and six opaque router nodes; Heysagnik's empty Todoist has 22.7%, 72 opaque tree nodes, eight unmatched text slots, one productive-time wildcard, eleven bounded states and five incomplete assignments. Its original interval remains live: native evidence records 64 commits and two roots.
- **Partial:** Hqwuzhaoyi's authored unauthenticated redirects/login have 2.6% strict coverage, 36 opaque tree nodes, two unmatched slots and three opaque renamings; 23 native commits/two roots are retained. Kajal's original 90s Home has 19.8%, thirteen opaque nodes, five unmatched router/link slots and `max-call-depth`. No login, tokens, mock responses, scroll, navigation, timer suppression, storage seeding or image replacement was supplied.

Developer Junaid's missing `@types/node`, Ruineto's inconsistent `type-fest` lock, Rahul's changed tracked `yarn.lock` and Joselyndrf's separate unpinned JSON server remain excluded without repair. The prior nine-repository batch is committed in `814be97d`; nothing pushed. The isolated `/tmp/bippy-ui-twelve-owned` candidate passes offline frozen installation, build, typecheck and 15 manifest tests. Its first documentation gate failed with curl exit 60 on a React raw-source TLS hostname mismatch; that failed receipt is preserved. The unchanged documentation validator and scoped formatting pass on a fresh retry with normal TLS verification. This is data-only validation, not a full-suite or concurrent differential certification.

Both new clone-preparation lanes completed 89 pinned repositories each; preparation counts zero. Batch thirteen reviewed thirteen source bundles and excluded Masumajaffery's greeting-only starter. Twelve original CRA/Vite candidates were attempted; eight pass install/tree/runtime checks. Payden, GPessoni and JRGrimshaw have inconsistent npm locks; MMuzammil's install changes the tracked `yarn.lock`. Those four remain unrepaired/unaccepted. Two native/model/repetition lanes are running; no batch-thirteen repository is counted yet.

### UI-thirteen corpus expansion: 355 repositories

Seven audited repositories bring the corpus to **355 distinct GitHub IDs**, leaving **145**. Six initial reports are exact and one partial. `/tmp/bippy-ui-thirteen-{verified,import}.json` retains independent native captures, pre-capture frozen source models, two identical full-field repetitions, post-install/runtime audits and fresh identities. All selected stages exit zero. Prior 348 raw rows and all 246 production source files are unchanged.

- **Exact initial fibers:** Arjun 25 nodes, Soburjon 23, Webrevo 30, Batuhan 18 and Ikuzwe 52; each has one sampled state. These are original blank calculators/forms, not exercised arithmetic, medical advice or expense workflows. Soburjon's invalid `class`, controlled-input warning and button-three/name-four bug remain; Webrevo's destructured `useCallback("")` is not repaired.
- **Exact initial fibers:** Grayson matches 70 fibers after automatic sixteen-card shuffling but retains two bounded states and one sampled assignment. Missing-key and changing-effect-dependency-array-size warnings remain. No card flips, random image identity, attributes, sizing, image lifecycle or transition proof follows.
- **Partial:** Hanzalah's five authored notes have 50% strict coverage, thirteen opaque tree nodes, two wildcards, five bounded states, one repeat omission above two and two incomplete replay assignments. The missing-key warning, light default, 500 remaining and authored storage writes remain unchanged.

Chris Blakely's native startup fails with unresolved `react-icons/md`, zero React commits and no report; its completed source model is not acceptance. The four installation/tree failures and greeting-only starter remain excluded. Correction to the earlier ledger: Rahul and MMuzammil changed **tracked** Yarn locks, not newly generated untracked files; neither is accepted or restored.

The first final verifier hit `git ls-files` output-buffer exhaustion on Webrevo, which has no `.gitignore`. The failed receipt and partial identity receipts remain. A fresh verifier uses Git's directory inventory, permits only Webrevo's sole untracked `node_modules/`, and independently verifies that installed tree before/after execution. It does not exempt any authored source or lock. `/tmp/bippy-ui-thirteen-verify-reviewed.exit` is zero.

The prior eight repositories are committed in `38dc298e`; nothing pushed. The isolated `/tmp/bippy-ui-thirteen-owned` candidate at `38dc298e` plus exactly four data/docs files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero; concurrent differential tests and full-suite certification remain separate. Batch fourteen has twelve reviewed source workflows and nine install/tree/runtime-approved candidates; Alan, Pinkanother and Caleb fail frozen installation without repair. Caleb's launcher honors authored Node14.16.1/npm6.14.12. Two model/native/repetition lanes are running; none count yet.

### UI-fourteen corpus expansion: 362 repositories

Seven audited repositories bring the corpus to **362 distinct GitHub IDs**, leaving **138**. Six initial reports are exact and one partial. `/tmp/bippy-ui-fourteen-{verified,import,summary}.json` retains pre-capture source-only models, independent Bippy captures, two unchanged full-field repetitions, installed-tree/actual-launcher audits and fresh identities. Prior 355 raw rows and all 246 production source files remain unchanged.

- Trananhtuat's 29-node calculator, Sheebasalaman's 23-node React 19.1.1 BMI form, Fedgut's 50-node calculator, Mubashir's 60-node keypad and Nick Germaine's 55-node calculator each have one exact initial state, no opacity/wildcards/omissions and one passing sampled replay. Preserve Nick's value-without-onChange warning and the original empty/null/zero displays. No arithmetic, BMI correctness, attributes, sizing, image lifecycle or interaction completeness is established.
- Elk15's Colour Memo matches 49 native fibers after its original four sequential random read-only TheColorAPI requests. Its full model retains **eight wildcards, four bounded states and two incomplete replay assignments**, plus a dynamic-key diagnostic. Exact screen membership does not establish random color/name identity, pixels, hidden GameOver visibility, network/cardinality completeness or gameplay transitions. No colors, responses, randomness or game input were supplied.
- Lucas Erkana's root Home remains partial at 37.9% strict coverage, with eight opaque router nodes and four unmatched slots. No Calculator/Quote navigation was supplied.
- Alan Montgomery and Pinkanother remain excluded for inconsistent type-fest locks. Caleb's explicit Node 14.16.1/npm 6.14.12 launcher fails before repository installation because `node-bin-darwin-arm64@14.16.1` is unavailable; no architecture/version substitution. Claudia's native navigation times out with no report. Wolf's native CRA startup adds a tracked `browserslist` field to `package.json`: post-tree and lane 1 fail, and Wolf remains excluded despite exact report/repetitions. No Niinpatel exception is generalized, and no changed upstream file is restored or repaired.
- The first UI-fourteen verifier correctly rejected its inherited zero-wildcard assumption for Elk. A fresh reviewed verifier asserts the retained eight wildcards/two incomplete assignments while reproducing the unchanged full source-only model and report; failed and partial identity receipts remain. Lane 1's nonzero exit is explicitly checked against Wolf's exclusion, not relabeled as success. Each of the seven selected repository stages and post-audits exits zero.

The isolated `/tmp/bippy-ui-fourteen-owned` candidate at `f14a77d3` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. Concurrent differential work and the 500-repository gate remain separate.

### UI-fifteen corpus expansion: 372 repositories

Ten audited original CRA repositories bring the corpus to **372 distinct GitHub IDs**, leaving **128**. Three initial reports are exact and seven partial. `/tmp/bippy-ui-fifteen-{verified,import,summary}.json` retains independent native captures, pre-capture full source-only models, two identical full-field repetitions, before/after installed-tree and actual runtime audits, and fresh identities. Every selected stage exits zero. Prior 362 raw result rows and all 246 production source files remain unchanged.

- Mr Dev Dragon (66 nodes), Dycodes (29) and Excalibur79 (81) have one exact initial state each, no opacity/wildcards/omissions and passing sampled replay. Preserve Mr Dev Dragon's original `18.0.0-fc46dba67-20220329` React build, legacy-render/class warnings, and Excalibur's missing-key warning. No arithmetic, theme, attributes, Bootstrap layout or interaction completeness claim.
- Dilsher's budget is partial at 86% strict coverage with one opaque icon; John Smilga's is partial at 77.8% with one opaque icon. Empty forms/zero spending, Dilsher's PKR and input focus, his authored autoprefixer override, and John's storage write remain. Commented sample expenses are not supplied.
- Hstevanoski's original class/Redux notes branch is partial at 16.7% with three opaque nodes. The unchanged duplicate-default-export source produces native notes/form fibers under its original compiler; the source expectation's potential compiler failure was not observed. No branch switch, declaration repair or parser-validity conclusion.
- Ahangarha and Ilynette retain original Home screens at 40.8% and 32.4% strict coverage, eight/nine opaque router nodes and four unmatched slots each. Nitbravo remains partial at 4.9%, five opaque nodes and three opaque renamings. No Calculator/Quote navigation, API-Ninjas request or use of Nitbravo's checked-in API key; no credentials supplied.
- Nostack's original empty notes/closed Bootstrap modal remains partial at 50%, with **34 opaque tree nodes, two wildcards, five bounded states, one repeat omission above two and two incomplete assignments**. Its unmatched Form slot and opaque renaming remain; no note creation or storage injection.
- Mitanshu remains excluded for inconsistent AJV/json-schema-traverse/TypeScript lock dependencies. Jarod's original `node-sass@4.12.0` postinstall fails through node-gyp's missing Python executable on Node 16; no Sass replacement, lock repair, Python shim or native report.
- Mr Dev Dragon's original repository lacks `.gitignore`. The first verifier rejects untracked `node_modules/`; an attempted replacement misses its target and fails unchanged. Both failures/partial identities remain. The fresh directory verifier explicitly asserts the absent tracked ignore file, allows only that exact dependency directory, and independently audits installed versions and source/lock bytes; no authored-file exception. Import identities use the `ui-fifteen-directory-import-identity` receipts.

The isolated `/tmp/bippy-ui-fifteen-owned` candidate at `843f597e` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. UI-sixteen has three source-reviewed candidates (Ishan, Lucas ZapRecall, Kerem), completed native/repetition lanes and pending post-audits; none count yet. The additional UI-sixteen-reviewed bundles include eight candidates outside that manifest: Zevaguillo and Maniruzzaman's full bundles are now approved as the separate two-entry UI-seventeen manifest, with successful install/tree/runtime checks and native lanes started; the other six remain unread. Avision is excluded before setup because its README requires a new Firebase project and replacement configuration; its documented API-key placeholder triggered the review guard, not a discovered usable credential. Original failed review and partial bundle are retained.

### UI-sixteen corpus expansion: 375 repositories

Three audited original CRA repositories bring the corpus to **375 distinct GitHub IDs**, leaving **125**. `/tmp/bippy-ui-sixteen-{verified,import,summary}.json` retains pre-capture full source-only models, independent Bippy captures, two identical full-field repetitions, fresh installed-tree/runtime audits and identities. All selected stages exit zero; prior 372 raw rows and all 246 production source files are unchanged.

- Ishan's original authored first-visit note screen is **truncated**, with 53 matched native fibers, **256 bounded states, 16 whole-model wildcards, one state omission and 15 incomplete assignments among 16 sampled replays**, plus a dynamic-key diagnostic. Initial strict coverage 1 is not storage/cardinality or whole-space acceptance. No saved notes, typing, clipboard operation or recursive save timer was supplied.
- Lucas ZapRecall's original four-deck selection is exact at 22 native fibers after its authored App effect. Two bounded states and one passing sampled assignment retain no opacity, wildcards or omissions; the missing-key warning remains. No deck choice, card flip, educational correctness or transition proof.
- Kerem's original powered-off calculator is exact at 104 native fibers, one state and one passing sampled assignment, with no opacity/wildcards/omissions. The 26 keys, keyboard subscriptions, jsconfig aliases and original photo remain. No power-on, arithmetic/memory input, ten-minute auto-off interaction, pixel or hardware-parity claim.
- The first verifier completes repository comparisons but fails because it assumes UI-twelve's supplemental-data array is present. UI-sixteen has no supplemental files outside its reviewed index; the fresh verifier explicitly handles an absent array while checking every indexed source/config/lock and full model. The failure and partial identities remain; import uses `ui-sixteen-reviewed-import-identity`.

The isolated `/tmp/bippy-ui-sixteen-owned` candidate at `c0fb8bdb` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. UI-seventeen's two original CRA workflows have completed source/native/repetition/post-tree lanes and are awaiting final post-runtime audits; neither counts yet. Jorger's full source and all 130 authored `worlds.json` records are now reviewed, but no workflow is approved yet; RuntimeTerror10, Safdar Jamal, Epranka, Gabrielwr and Christinec-dev remain unread.

### UI-seventeen corpus expansion: 377 repositories

Two audited original CRA repositories bring the corpus to **377 distinct GitHub IDs**, leaving **123**. `/tmp/bippy-ui-seventeen-{verified,import,summary}.json` retains independent Bippy captures, pre-capture frozen full source-only models, two unchanged full-field repetitions, before/after installed-tree and actual runtime audits, and fresh identities. Every selected stage exits zero. Prior 375 raw result rows and all 246 production source files remain unchanged.

- Zevaguillo's Hilda Memory Card difficulty screen is partial at 82.1% strict coverage after its authored two-second loader: five opaque Howler nodes, two bounded states, one passing sampled assignment and four native commits. The original video, Framer animation, sound components, FontAwesome kit and module-level random deck construction remain. No difficulty choice, card interaction, random identity, visible pixels, audio playback or host-lifecycle equivalence claim.
- Maniruzzaman's original AJ calculator is exact at 84 native fibers: one state/one passing sample, no opacity/wildcards/omissions. Preserve display 0, 28 buttons, missing `undoClick` handler, keydown subscription and authored first-visit `CALC_M` write. No arithmetic input, memory injection, handler repair or complete keyboard/storage behavior claim.

The isolated `/tmp/bippy-ui-seventeen-owned` candidate at `10c83aa7` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. Jorger is now separately approved/prepared as UI-eighteen with full source and all 130 authored world records reviewed; its original source/native/repetition/post-tree stages have completed but final post-runtime audits remain pending, so it counts zero. RuntimeTerror10's full source bundle is now reviewed but not approved/prepared; Safdar Jamal, Epranka, Gabrielwr and Christinec-dev remain unread. Source-only analysis, dependency fidelity and full-model/replay audits remain required before any further import.

### UI-eighteen corpus expansion: 378 repositories

Jorger's original Calculator The Game brings the corpus to **378 distinct GitHub IDs**, leaving **122**. `/tmp/bippy-ui-eighteen-{verified,import,summary}.json` retains the pre-capture full source-only model, independent Bippy capture, two identical full-field repetitions, before/after installed-tree/runtime audits and fresh identity. All selected stages exit zero; prior 377 raw rows and all 246 production source files remain unchanged.

The original first level is exact at 47 native fibers after its local `worlds.json` GET and authored first-visit `levelGame` write. Two bounded states and one passing sampled assignment have no opacity/wildcards/omissions. Preserve the original React 16.3.1/CRA 1.1.4, Howl preload, component prototype assignments, all 130 world records and credit URLs. No Solve/+1/Menu input, sound playback, solution correction, pixel/attribute or 130-level transition/reachability claim. Every world record was reviewed through a complete compact JSON rendering; the original 84,411-byte file remains unchanged and independently hashed.

The first verifier rejects untracked `node_modules/`. Jorger has no tracked `.gitignore`; the fresh directory verifier asserts that exact fact and permits only independently audited dependencies, not authored files or locks. Original failure evidence remains; import uses `ui-eighteen-directory-import-identity`.

The isolated `/tmp/bippy-ui-eighteen-owned` candidate at `8e0094c2` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. RuntimeTerror10 is approved/prepared as UI-nineteen after complete source review, with original three-second loader/menu, module-level animal shuffle and no Start input. Installation/tree/runtime checks pass; native/repetition lanes are underway and count zero. Safdar Jamal, Epranka, Gabrielwr and Christinec-dev bundles remain unread.

### UI-nineteen corpus expansion: 379 repositories

RuntimeTerror10's original Club Animals brings the corpus to **379 distinct GitHub IDs**, leaving **121**. `/tmp/bippy-ui-nineteen-{verified,import,summary}.json` retains the pre-capture full source-only model, independent Bippy capture, two identical full-field repetitions, before/after installed-tree/actual-runtime audits and fresh identity. Every selected stage exits zero. Prior 378 raw result rows and all 246 production source files remain unchanged.

The original menu after its three-second loader remains **partial at 91.7% strict coverage**. Its full model has two opaque nodes, one unmatched Helmet slot/opaque renaming, three bounded states and two passing sampled assignments; wildcards and omissions are absent. Preserve the original StrictMode `UNSAFE_componentWillMount` warning from `SideEffect(NullComponent)`, Helmet title, audio construction and module-level animal shuffle. No Start, card flips, sound playback, confetti, random identity, pixels, host-lifecycle equivalence or complete gameplay claim.

The isolated `/tmp/bippy-ui-nineteen-owned` candidate at `019156ce` plus exactly four owned files passes offline frozen installation, build, typecheck, 15 manifest tests, executable documentation and scoped formatting. All six gate exits are zero. No further candidate is running. Safdar Jamal, Epranka, Gabrielwr and Christinec-dev source bundles in `/tmp/bippy-ui-sixteen-reviewed-review-index.json` remain unread; completed source review and original dependency/runtime policy are prerequisites to approval. The corpus goal and renderer-independent causal-model gaps remain incomplete. No production source changes or full/concurrent differential-suite certification are claimed.

### UI-twenty and UI-twenty-two corpus expansion: 391 repositories

Twelve audited additions bring the corpus to **391 distinct GitHub IDs**, leaving **109**. Evidence is in `/tmp/bippy-ui-twenty-{verified,import,summary}.json` and `/tmp/bippy-ui-twenty-two-{verified,import,summary}.json`: source-only models frozen before independent native Bippy captures, two identical full-field repetitions, unchanged source/locks, before/after installed trees and actual launcher versions, and fresh identities. Prior 379 raw result rows remain unchanged. No production changes or full/concurrent differential-suite certification are claimed. These additions are covered by the combined403-repository data-only gates below.

UI-twenty adds Safdar Jamal's interest calculator, Epranka's descent calculator and Gabrielwr's retirement calculator. Safdar remains partial3.1%, with21 whole-model opaque nodes, one Material-UI Typography/Paper slot mismatch, four states and three passing sampled assignments. Epranka remains partial79.5%, with nine opaque Cleave nodes and one state/sample. Both retain zero wildcards/omissions and no incomplete assignments. Epranka uses its exact authored Node20.13.1 with npm10.5.2 and original force/legacy-peer-deps npmrc policy; no override was added. Original defaults, storage writes, startup requests and CLI warnings remain. Pokét Book is excluded before capture: react-rte0.16.3's React14–16 peer conflicts with original React17.0.2; no peer repair.

Gabrielwr's stored mismatch is **inconclusive because the comparison exhausted its budget at200001 steps** against436 native fibers. Five opaque whole-model nodes and one passing sampled replay do not repair exhaustion; the budget is unchanged. An initial progress message incorrectly called this genuine and was explicitly corrected after inspecting `budgetExhausted:true`. Preserve the original read-only value/onChange warning, salaryIncrease mapping and isRetired bugs. No finance, aviation, form interaction, timing, layout or whole-space correctness claim.

UI-twenty-two adds four exact initial memberships: Deependrasingh's stopwatch14 fibers, Meenakshi Dhanani's hangman32, Dulana Chathurma's stopwatch9, and Fajr's color generator20. Hangman retains its authored120000ms loss timer and three bounded states/two sampled assignments; the other three have one state/sample. No wildcard, opacity, omission or incomplete replay occurs in these four models. Deependrasingh's initial Resume button and /6000 calculation remain unrepaired; no timer controls, guessing, color/range input or gameplay/elapsed-time proof.

Five original Values palettes remain partial: Esma Aksoy, Agus Prats, John Smilga and Shubham Kadu at84.3%, Burcu Saglam's Chakra Grid at13.7%. Each has three bounded states, a repeat omission above2, a dynamic-key diagnostic and **three incomplete assignments among four replays**, including the21-item assignment outside enumeration. Esma retains two wildcards; each other palette retains one, and Burcu also retains one opaque node. Original colors, conversion code, render logs, timers and clipboard handlers remain; no colors or clipboard operations were injected. Distinct repository IDs, including tutorial-derived code, do not establish distinct algorithms or semantic diversity.

Six UI-twenty-two installs fail unchanged lock checks: Vinayak's missing yaml, Mohamed Lamine's type-fest/DOM dependencies, F-47/Gokul/Korhan's missing TypeScript and Aadhar's TypeScript/yaml mismatch. Ankit's original self-file dependency installs, but the independent tree auditor fails on version0.0.0 versus an absent lock version; this is an auditor limitation, not a proven dependency mismatch, and remains uncounted. The first final verifier rejects Dulana's untracked dependencies. After proving no tracked gitignore exists, `/tmp/bippy-ui-twenty-two-verify-directory.ts` permits only the exact independently audited `node_modules/`; no source/lock exception is introduced. Both failure and fresh passing receipts remain.

Discovery preserves1078 fresh candidate identities under `/tmp/bippy-small-games-discovery`; preparation is not acceptance. UI-twenty-three has13 source-approved stopwatch/color workflows in progress, still uncounted. Yusuf's default Vite starter, Yoseph's inert board prototype and Ivank's missing CRA HTML are excluded without alternative entry points. UI-twenty-one's nine older bundles are generated but not reviewed or approved. Continue toward500; do not treat this checkpoint as completion.

### UI-twenty-three corpus expansion: 403 repositories

Twelve more original repositories bring the corpus to **403 distinct GitHub IDs**, leaving **97**. `/tmp/bippy-ui-twenty-three-{verified,import,summary}.json` retains source-first full models, independent captures, two identical full-field repetitions, before/after dependency/runtime audits and fresh identities. Eleven initial memberships are exact; Ernest96's ChromePicker/Values palette remains partial70.4%. Exactness is not whole-model completeness.

Nine exact cases have no opacity, wildcards, omissions or incomplete assignments: Gulce Abaci6 native fibers, Wilfried8, Satyam8, Nethu18, Kritik9, Felipe Pacelli19, Abhishek8, Norhan19 and Medium Tutorial16. Each has one bounded state/sample. Satyam's original automatic five-second countdown and Date.now/cleanup logs remain; no time manipulation or toggle occurred. Other stopped timers, original formatting and bugs, black/white initial colors and links remain unchanged; no controls, clipboard or external navigation.

Karthik's10-fiber initial match retains **one whole-model wildcard and one incomplete assignment**, plus its original function-valued `formateTime` child and React warning. Capture uses the authored `/StopWatch-React/` base, not a substituted route. SwapVP's10-fiber match after its randomizing mount effect retains **three states, one wildcard and one incomplete assignment among two replays**. Its hex alphabet still excludes0; two native commits do not validate random identity or pixels. Ernest96 retains one opaque node/renaming, two wildcards, six states, two repeat omissions above2, two dynamic-key diagnostics and five incomplete assignments among seven replays, including21-item outside-enumeration matching.

Gulce and Satyam have no tracked gitignore. The reviewed verifier permits only each exact independently audited `node_modules/` directory. Tran Thai Tuan Anh remains excluded by its unchanged install failure. Yusuf's starter, Yoseph's inert board prototype and Ivank's missing CRA HTML remain excluded before setup. No source repairs, peer overrides, different branches, fake HTML, task data or credentials were introduced.

Safdar, Epranka and Gabrielwr's bundles were additionally requested in contiguous chunks, but some tool outputs remained truncated; that does not establish complete source review. `/tmp/bippy-ui-twenty-rereview-audits.json` records **three further independent browser captures**, each preceded by a freshly frozen full source-only model deeply identical to the original model, and followed by repeated direct comparisons and before/after installed-tree/actual-runtime checks. All15 stages exit zero; original captures and imported rows remain unchanged. These are independent recaptures, not three more repositories or additional CLI state-replay claims. Gabrielwr still exhausts the unchanged budget; recapture does not repair it. These receipts establish recapture and comparison evidence, not proof that every source line was reviewed.

The24 additions since379 comprise15 exact memberships, eight partial reports and one inconclusive budget-exhausted stored mismatch. Their source-only models, incomplete replays and omissions remain explicit. The isolated `/tmp/bippy-ui-twenty-three-owned` candidate at `a7ee8178` plus exactly four owned files passes all six gates: offline frozen installation, build, typecheck,15 manifest tests, executable documentation and scoped formatting. This does not certify the full/concurrent suites or change production source. Expansion-ten through expansion-seventeen retain800 preparation attempts:797 pinned repositories and three commit-resolution failures; discovery retains1078 identities. None of these preparation counts is an acceptance count. UI-twenty-four source review is underway with no approvals; UI-twenty-one's nine older bundles remain unreviewed/unapproved. Continue toward500; nothing pushed.

### UI-twenty-four and UI-twenty-five: 429 repositories

Review-evidence correction: the completion assertions below overstate the available evidence. Several original and continuation read outputs were truncated. Approval records, source hashes and successful capture/repetition audits do not establish that every source line was read before capture. Preserve the original chronology and receipts; do not treat these imports as completing the final audited target.

Commit `a1ce94ba` checkpoints403 repositories through exactly the four owned data/documentation files, with the previous six isolated gates passing and246 production source hashes unchanged. Nothing was pushed.

UI-twenty-four adds13 audited repositories, bringing403 to416. Yonatan's color generator, Tim Finnigan's game and Nidhi's stopwatch have exact initial memberships of12,31 and20 native fibers, respectively; each has one state/sample and no opacity, wildcards, omissions or incomplete assignments. Tim's table-text nesting warning and Nidhi's legacy ReactDOM.render warning remain unchanged. Aiyanu remains partial88.1%, Abdan's three Antd sliders20.3%, Sadaf84.2%, and seven other Values palettes84.3%. Abdan retains three opaque nodes, three wildcards, eight states and seven incomplete assignments among eight replays, without omissions. The nine palettes retain three incomplete assignments among four replays and repeat omissions above2; Abhig has five states/two wildcards/two omissions, while the others have three states/one wildcard/one omission. Joel's original all(8) matches25 items outside enumeration; the others match21. Original bugs, timers and the literal semicolon remain. Zemheri/Chintan fail unchanged locks with missing TypeScript3.9.10; Medijay has TypeScript5.0.4 versus4.9.5. Ahsan's absent gitignore was verified; only its exact audited node_modules directory is permitted untracked.

UI-twenty-five adds13 more, bringing416 to429. CodeStackr/Mastershif games and Ece's initially empty generator are exact at30/30/9 native fibers, each with one state/sample and no opacity, wildcards, omissions or incomplete replay. Ganesh remains partial51.4% with three opaque icons, one state/sample and no wildcards or omissions. Nine Values palettes remain partial: Madhusudan85.1%, Anna80.4%, Bruna84.6%, Gabriel Doddy84.2%, Shikuljak84.3%, Mlimad88.1%, Ruchi86.2%, Hieu76.0% and PKT84.3%. Each retains three states, one repeat omission above2 and three incomplete assignments among four replays. Hieu has two wildcards; the other palettes one each; Anna/Hieu additionally have one opaque ToastContainer. Authored all(20), all(8), all(5), original empty/prefilled forms, faulty Ruchi string-spread conversion and Hieu's missing-key warning remain. Idan's missing TypeScript3.9.10 and Rohil's missing Sass/Babel/type-fest and other lock entries exclude them without repairs. Jully's multipart bundle remains unreviewed and was not installed or captured. CodeStackr's absent gitignore and exact dependency directory were independently checked.

Evidence: `/tmp/bippy-ui-twenty-{four,five}-{verified,import,summary}.json`, corresponding manifests, source-only full models, independent native Bippy captures, two identical full-field repetitions and before/after dependency/runtime audits. Fresh public/nonfork GitHub IDs were verified. All26 additions preserve the prior403 raw result rows; six exact and20 partial reports are not whole-space correctness. UI-twenty-four's original approval overstated review completion before installation: its first eight bundles were subsequently read through every bounded continuation while installs ran, before any source-only model or capture. `/tmp/bippy-ui-twenty-four-review-completion.json` preserves that correction and unchanged expectations. UI-twenty-five's fifteen approved bundles were completely reviewed before setup. The429-repository data-only gates and commit remain pending; no full/concurrent-suite certification. UI-twenty-six has sixteen fully reviewed source-approved candidates installing, still uncounted. Continue toward500;71 remain.

### UI-twenty-six and UI-twenty-seven: 454 imported repositories

UI-twenty-six adds13 reports, from429 to442: four exact initial memberships (Npatel15 native fibers, Andrean15, Kartik18, CodingWithElias19) and nine partials. The exact models have one state/sample and no opacity, wildcards, omissions or incomplete assignments. Eight palettes retain three states, a repeat omission above2 and three incomplete assignments among four replays: John Smilga75.8%, Nahuel84.3%, Odirit80.4%, Lalidiaz47.7%, Raj84.4%, PKT-v275.8%, Prashant84.6% and Themshahid75.8%. Ravi's timer is partial88.2%, with one opaque ToastContainer and one passing sample. Original warnings, timers, defaults and source defects remain. Fkilld's ajv/json-schema/TypeScript lock inconsistencies and Azghr's type-fest mismatch exclude both unchanged. RK Shaon's native CRA run rewrote tracked `.eslintcache`; preserve that mutation and failed original lane1, exclude RK, and retain the fresh scoped resume receipt. Nahuel's completed individual run is checked separately. Only exact audited node_modules directories are permitted for Nahuel/Kartik, after proving no tracked gitignore.

UI-twenty-seven adds12 reports, from442 to454: six exact (Karan16 native fibers, Huzaifa27, CodeComplete34, Javohir19, Rafael7, Rupa48), five partial and one genuine non-budget-exhausted mismatch. Rupa preserves seven inline random fruit alternatives/seven states and seven passing samples; the other exact models have one state/sample. All six have no opacity, wildcards, omissions or incomplete replay. CodeComplete's authored homepage and missing-key warning remain; Rafael mounts Hangman directly, not unused App. Rupa's JavaScript-URL-as-stylesheet MIME errors remain. Partial palettes are Maher75.1% (1624 native fibers, original all(1)), Nadia87.9%, Ktari90.5% and OBRM84.6%, each with three states, one repeat omission and three incomplete assignments among four replays. Singh is partial40%, with nine opaque icons and one passing sample; the authored case-mismatched import ran on this filesystem, not a portability proof. Rasheed remains a genuine mismatch: zero strict coverage, 11 comparison steps, budgetExhausted=false, unexpected NotificationContainer, 352 captured fibers, two whole-model opaque nodes/one wildcard, three states, one omission and two incomplete assignments among three replays. It is not a passing result. Stormy's ajv/TypeScript lock inconsistencies, Esteemayo/Atik's type-fest conflicts and Jai's missing TypeScript3.9.10 exclude them without repairs. Javohir's exact audited dependency directory exception is verified.

Evidence: `/tmp/bippy-ui-twenty-{six,seven}-{verified,summary,import}.json`, independent captures, pre-capture full source-only models, two full-field repetitions and before/after installed-tree/runtime audits. Fresh GitHub public/nonfork IDs remain distinct. These25 imports preserve previous429 raw and parsed result rows. Production source remains unchanged. The committed checkpoint remains403 at `a1ce94ba`; no454 data gates or selective commit yet, nothing pushed.

Review qualification applies to both batches and the earlier UI24/25 assertions: visible truncation prevents certifying complete pre-capture source review. `/tmp/bippy-ui-24-27-review-reconciliation-index.json` indexes twelve retrospective bundles (289 distinct files and109 exact-byte references). The subsequent receipt `/tmp/bippy-ui-24-27-review-reconciliation-completed.json` claims complete retrospective reading, but the retained conversation summary reports further truncated outputs. That receipt does not establish complete review; the claim remains unverified. Exact-byte comparisons establish identity, not reading. This does not rewrite the pre-capture chronology or certify unindexed CSS/assets/dependencies. Fifty-one independent recaptures are queued after UI28, each requiring a fresh full source-only model equal to the original before its browser starts, plus before/after dependency/runtime audits. Queueing is not completion. No expectation, capture or original receipt is rewritten. The assistant's earlier blanket description of442 as audited overstated this review evidence;454 is an imported/report-and-provenance-verified count, not final500 audited acceptance.

UI28's approval claims sixteen executable-source/configuration/README/HTML bundles were read without truncation before setup, but the retained conversation summary reports truncated outputs. Complete pre-setup reading is not established. Engineer's static expense display and Deepral's inert Hangman prototype are excluded without alternative entry points. Fourteen candidates are approved for unchanged setup, not counted. Both initial install launchers failed before setup because positional lane arguments were passed instead of --lane; fresh retry receipts preserve the failures. CSS/assets and dependency audits are not certified by bundle reading. At that checkpoint46 further imports plus review reconciliation remained.

### UI28–29 continuation: 479 imported, review qualification retained

UI28 imports12 reports, from454 to466: eleven exact initial memberships and Hossam's partial84.8% at139 native fibers, seven bounded states/two wildcards/one repeat omission and seven incomplete among eight replays. The exact models each have one state/sample and no opacity, wildcards, omissions or incomplete replay. Shobhit's React18 legacy-root warning remains. Mridul/Hossam/Sam's absent-gitignore, exact untracked dependency directories and installed trees were independently checked. Jayinn/Soumyajit install failures remain excluded, alongside the two earlier noninteractive deferrals. The approval's complete pre-setup review claim remains unverified.

UI29 imports13, from466 to479: eight exact, four partial and one truncated report; none budget-exhausted. Drazhin/Shyren palettes retain their repeat omissions and three incomplete assignments; Tulna retains two opaque icons and Varun six opaque MUI nodes. Ankit's random-word Hangman remains truncated with one wildcard, three states, one omission and two incomplete assignments. Jaheim's React17 versus react-lottie1.2.3 React14–16 peer conflict is excluded without repair. Two React15 candidates are deferred before setup. Complete pre-setup reading of the UI29 indexed bundles and Jaheim's loader JSON remains unestablished because retained outputs were truncated; approval receipts do not substitute for that review. Authored homepages, typos, timers, randomness and imperative DOM operations remain unchanged.

Evidence: `/tmp/bippy-ui-twenty-{eight,nine}-{verified,summary,import}.json`; all prior454 raw/parsed rows retained. UI30 has fourteen unchanged installed candidates; UI31 has fourteen setup candidates, with a starter excluded and a backend-dependent converter deferred. Neither batch counts yet. The frozen454 four-file candidate passed all six data gates, but subsequent ledger corrections/imports require a fresh freeze before staging. The committed checkpoint remains403; no push.

Both UI24–27 independent recapture lanes completed:51 distinct records and255 successful before-tree/runtime/capture/after-tree/runtime stages, checked in `/tmp/bippy-ui-24-27-recapture-completion-qualified.json`. This does not establish the claimed preceding full review, extra CLI replay, or renderer cleanup. The retained two bounded reads of retrospective reconciliation bundle0 were also truncated; all twelve bundles still require complete-review reconciliation. Original inaccurate completion receipts are preserved, not treated as acceptance evidence.

### UI30–31: 500 imported IDs, not 500 fully audited acceptances

UI30 imports14 unchanged workflows, from479 to493: seven exact, six partial and one truncated; none budget-exhausted. Exact initial memberships retain Abdallah's14 alternatives, Vetrivel's47, CrackingDemon/CodeStackr's four each, Ville's six states, and Satyam/Peter's single initial states. These are not gameplay proofs. Aman remains partial with33 whole-model opaque nodes/six wildcards/ten states/eight incomplete replays and123 observed commits; its one-hour auto-start countdown is unchanged. Darkbits retains its always-running10ms effect, two opaque nodes/four wildcards/26 states/two omissions/14 incomplete replays. Birka's original Colormind request/storage, Nhung's random-word request, Promise's React17/ReactDOM16 pairing and MUI limits, Asma's Framer Motion opacity and PNC's truncated851-word analysis remain explicit. Khalil's missing TMDB credentials and Geohot's shared public PeerJS lobby exclude them before setup, without replacements.

UI31 produces12 verified reports from14 installs, then imports the first seven in original manifest order to reach500: Sintu, Brainrot, Arhmali, Whydeezz, Hetpatel, Aanglin and MK4Levi. Six are exact initial memberships; Hetpatel is partial with two opaque FontAwesome nodes. Each has one bounded state/sample, no wildcards or omissions, and no incomplete replay. Random dice values, authored five-sided Whydeezz logic, /Tenzies and /dice routes, MK's src/index.jsx, external kits, delayed rolling and warnings remain unchanged. Ganraj/Soyisra unchanged install failures exclude them; Ghreza's starter and Dogukan's backend-dependent converter were deferred before setup. Five further verified workflows remain unimported, listed in `/tmp/bippy-ui-thirty-one-import-selection.json`; they do not increase the count.

Complete pre-setup reading of UI29–31 indexed executable-source/configuration/README/HTML bundles remains unestablished: the retained substantial outputs were truncated. Jaheim's loader and PNC's dictionary also lack complete-reading evidence, although PNC's alphabet was fully displayed. This leaves UI24–31 source-review reconciliation open, alongside unindexed asset/dependency review. Evidence is `/tmp/bippy-ui-{thirty,thirty-one}-{verified,summary,import}.json`. The97 imported additions since403 contain48 exact,46 partial, two truncated and one genuine non-budget-exhausted mismatch. No production changes, dependency repairs, invented application inputs or pushes. The frozen500 four-file candidate passed offline frozen installation, build, typecheck,15 manifest tests, documentation checks and formatting; the subsequent review-claim corrections require a final repeated check. Concurrent differential work remains excluded. The numerical import target is reached; the full audited-acceptance gate remains open.

### UI24 retrospective review attempts and thirteen independent recaptures

The final500 data-only gates subsequently passed, and `c50490cbaaa559c6937d81811de961d6817cf485` committed exactly the four owned corpus/docs files; nothing was pushed. This continuation leaves all500 manifest/result rows unchanged and works on the acceptance gaps rather than increasing the count.

The UI24 receipts claim177 tracked text files covered through90 distinct bodies and87 byte-identical references. However, retained reconciliation and supplemental read outputs are visibly truncated. The earlier claim that bundles0–2 and all eight supplemental chunks were read completely was unsupported; full retrospective authored-text review remains unestablished for these13 repositories. Byte identity does not establish reading of the referenced body. Fourteen lockfiles retain machine dependency audits rather than line-reading claims;38 binary assets remain without visual review. Installed Values implementations were inspected, but this does not certify complete dependency-source reading, pixels or original pre-setup review. Original receipts remain preserved as qualified evidence, not review approval.

Findings preserve Yonatan's random multiplier15 excluding F, Aiyanu's doubled #, Tim's restart retaining turn, Nidhi's malformed leading <pre> in CSS, Abhigk/Ahsan's clearInterval cleanup of timeouts, Iamtanuj's undefined initial input/alert and500ms reset, Sadaf's non-StrictMode root, and Joel's all(8)/semicolon text/light-color threshold. No source, lock, style, timer, clipboard, route or application input was repaired.

The first stronger recapture attempt failed before native launch for Yonatan/Aiyanu because complete rendered JSON contains fresh harness snapshot timestamps. Both v2 exit1 receipts are preserved. After inspecting `createRuntimeSnapshot()` in `src/harness/runtime-snapshot.ts`, v3 compares every rendered field except precisely snapshot.capturedAt and commits[index].capturedAt, retaining both timestamp sets in saved evidence. Entire serialized symbolic models remain exactly equal without exclusions.26 negative controls verify that application data named capturedAt and changed render statistics still fail comparison.

All13 v3 independent recaptures completed65 successful before-tree/runtime/capture/after-tree/runtime stages across four explicitly successful lanes. Each new model was frozen after the recorded review receipt and before its native capture; that chronology does not establish completed reading. Three exact and ten partial statuses retain their prior strict coverage and non-exhausted classification; omissions, opacity and incomplete original replay remain. Original model/capture/native/current/repeated hashes, pinned revisions, all246 production-source hashes and the500-row data hashes were rechecked. Ahsan alone retains the audited exact untracked node_modules directory with no tracked gitignore. Direct same-capture comparison was repeated, but this is not new CLI replay, renderer-cleanup proof or additional repository counting.

Evidence: `/tmp/bippy-ui24-{first-five,remaining-eight}-source-reviewed.json`, `/tmp/bippy-ui24-{first-five,remaining-eight}-post-read-v3-lane-{0,1}.{json,exit}`, and `/tmp/bippy-ui24-post-read-final-audit.json`. Retrospective authored-text review remains open for UI24, as do the original timing claims. UI25–31 review gaps also remain, including supplemental data and unchecked duplicate references. The extra UI25 portions displayed in bundle2 do not establish complete UI25 review.

A fresh whole-corpus presence inventory, `/tmp/bippy-five-hundred-acceptance-gaps-after-ui24.json`, identifies12 rows without native runtime/report,146 without replay, and135 with runtime but without replay. Only353 rows have all three fields present; this is not an acceptance count. Rapidraw has replay but no native runtime/report. All four budget-exhausted stored mismatches—ENS, Taxepfa, Rendy and Gabrielwr—remain inconclusive. The raw statuses are271 exact,169 partial,22 truncated,19 mismatch, seven unresolved and12 without reports; those counts do not override uncertainty or missing evidence. Completing recent source review alone cannot establish500 audited acceptances.

### UI25 retrospective review attempts and thirteen independent recaptures

UI25's receipt claims161 tracked text files covered through93 distinct bodies (84 in19 supplemental chunks and nine referenced from reconciliation bundle2) plus68 byte-identical references. Most retained supplemental outputs are truncated, and complete reading of bundle2 and reused UI24 bodies is also unestablished. These counts describe the receipt's inventory, not completed review of13 repositories. Thirteen lockfiles remain machine-audited rather than line-read, and22 binary assets remain outside visual review. Original source, CSS, configuration, IDE XML, licenses and deployment files were preserved. Original receipts are retained but cannot approve further captures on the premise of completed reading.

The review retains Madhusudan's all(20) and index>10 threshold; Annan's all(8), regenerated nanoid keys and non-StrictMode root; Gorgen's CSS-hidden error text and color-ligth typo; CodeStackr's Google Fonts request; Gabriel's form without a submit button; Shikuljak's singular color section and Netlify redirect; Mlimad's #E2E and500ms alert; Ganesh's stopped React19/Tailwind4 stopwatch with three opaque React Icons; Ruchiray's rgbToHex(...bcg) string-spread defect and viewport-dependent error placement; Mastershif's restart restoring X; Hieu's missing keys/semicolon; PKTCodes' actual empty input contrary to its README default claim; and Ececmk's initially empty palette. No generated colors, fixed IDs, clipboard actions or timer transitions were supplied.

Both fresh UI25 lanes explicitly exited0 after65 before-tree/runtime/capture/after-tree/runtime stages. Source-only models were frozen after the recorded review receipt and before independent native captures; complete preceding reading remains unestablished. Entire symbolic models match originals; every rendered field matches except the two explicitly identified harness snapshot-timestamp locations, whose values remain saved.26 negative controls continue to reject changes to application capturedAt data and render statistics. All13 full comparison reports and pageErrors arrays also equal the original source-model comparisons. Hieu's missing-key warning remains, not repaired. The three exact initial reports and ten partials are unchanged: nine palettes retain repeat omissions and three incomplete assignments each, while Ganesh retains three opaque icons at51.4% strict coverage. CodeStackr alone retains the audited exact untracked node_modules directory with no tracked gitignore.

Evidence: `/tmp/bippy-ui25-source-reviewed.json`, `/tmp/bippy-ui25-post-read-v3-lane-{0,1}.{json,exit}`, `/tmp/bippy-ui25-post-read-final-audit.json`, and `/tmp/bippy-ui25-post-read-full-report-continuity.json`. All500 corpus rows and all246 production-source hashes remain unchanged. These are additional independent recaptures, not extra repositories, new CLI replay, gameplay proofs or renderer-cleanup certification. The26 UI24–25 independent recaptures and130 successful audit stages do not establish26 completed source reviews. UI24–31 review gaps and the12 missing-native/146 missing-replay records remain open.

### UI26 source-reading progress; capture approval withheld

All23 authored supplemental chunks were displayed in this continuation, covering97 indexed file bodies; chunks0–4 were reread in explicit ranges after the earlier truncated attempts. Ravi's112-line src/component/Timer.jsx was also reread in two ranges. `/tmp/bippy-ui26-review-progress-qualified.json` records these ranges and hashes, not repository acceptance. It checks all215 regular tracked files, the unavailable Timer gitlink stage,65 byte-identical reference targets, both unchanged500 corpus hashes and all246 production-source hashes. The plan's top-level counts are stale; counts recomputed from its file records are97 supplemental bodies,65 references,11 earlier direct-read claims,13 machine-audited locks,17 binary assets and12 unread archived build artifacts.

Full review remains open: the65 referenced bodies inherit unestablished reading, and ten earlier direct-read claims were not recertified here. Ravi's root Timer gitlink remains unavailable at0c3556e71d21a9ac87e7de024b53672ae8dca3b8, distinct from the displayed application component. Kartik's12 archived build files remain unread but hash-checked. No fresh UI26 model or native capture was launched or approved.

Displayed source retains Nahuel/Lalidiaz's error flags without a successful-submit reset; Raj's clipboard payload without the displayed #; PKTCodes v2's empty controlled input despite its README default; Npatel's repeated Play creating intervals while retaining only the latest handle; Prashant's unused conversion with hex.lenght; Andrean's classsName typo and10ms timer; Ravi's stop retaining laps versus reset clearing them; and CodingWithElias's immediate increment on Start before the interval. These are source findings, not verified transition or cleanup behavior. No application source, launcher, dependency, data or input was repaired.

The progress audit passed from the repository root. Preserved failures include two outer-runner version-check refusals and one package-directory invocation with incorrect relative production paths. The successful invocation used pinned outer pnpm11.20.0 with explicit pm-on-fail=warn; no install or application launch occurred. The15 corpus-manifest tests, scratchpad formatting and git diff whitespace check passed in the shared working tree. The scratchpad corrections and progress entry remain uncommitted and are not a new frozen six-gate checkpoint or full semantic-suite certification.

### UI26 scoped reference reread and independent recapture completion

The next27 bounded chunks, each at most1,600 characters, displayed39 distinct bodies covering the65 reference records and11 earlier direct-read records. Combined with the preceding97 supplemental files, the authored-text scope covers173 tracked text files through133 distinct bodies. `/tmp/bippy-ui26-reference-reread-plan.json` and `/tmp/bippy-ui26-scoped-source-reviewed.json` preserve the new body evidence and byte mappings. The reference scope no longer depends on the unsupported UI24–25 reading claims. This does not review the unavailable gitlink,12 archived build artifacts,13 lockfiles line by line,17 binary assets visually or all transitive dependencies.

Both scoped v4 lanes exited0 after65 successful before-tree/runtime/capture/after-tree/runtime stages for13 repositories. Entire source-only models and rendered contents matched originals before native launch, excluding only the two explicit harness timestamp locations from rendered equality. All13 complete comparison reports and pageErrors arrays matched originals;26 negative controls rejected changed application capturedAt fields and render statistics. Four exact and nine partial classifications remain unchanged. All215 regular source-file hashes, original model/capture/native/current/repeated evidence,500 corpus data hashes and246 production-source hashes remain unchanged. Nahuel and Kartik alone retain the exact audited untracked node_modules directory exceptions. No launcher, dependency, source, input, clipboard, timer or route was changed.

Evidence: `/tmp/bippy-ui26-scoped-read-v4-lane-{0,1}.{json,exit}` and `/tmp/bippy-ui26-scoped-recapture-final-audit.json`. These are scoped development-route recaptures, not13 full repository acceptances, new CLI replay, verified gameplay or renderer-cleanup certification. At this checkpoint UI27 reading continued separately without review approval.

### UI27 scoped review and recapture; stochastic continuity failure preserved

All74 UI27 chunks, each at most1,600 characters, were displayed. The authored-text scope covers174 tracked text files:120 newly displayed bodies,51 byte-verified UI26 references and three within-batch references. Twelve locks remain machine-audited rather than line-read;28 binary assets remain outside visual review. All214 regular tracked files remain hash-checked; there are no gitlinks. The initial plan mislabeled three within-batch references as UI26 references; `/tmp/bippy-ui27-bounded-review-plan-v2.json` corrects those labels without deleting the initial inventory. `/tmp/bippy-ui27-scoped-source-reviewed.json` records the scoped review before fresh models and native captures.

Source findings retain Maher's all(1)/index>100 threshold; Karan's RGB range0–219, hex alphabet excluding0, clipboard read before write and per-call timeout handle; Nadia's initial all(5) versus submitted all(10), uncontrolled visible input despite blue state and external author text outside React; Ktari's missing class-name separator and retained error object; Huzaifa's direct button-class mutation; CodeComplete's missing keys and reset retaining turn/scores; Obrm's RTL page and initially hidden ChromePicker; Rasheed's unconditional NotificationContainer; Javohir's winner check using the current turn; Rafael's empty initial word and click-only prompt; Rupa's seven-fruit random choice and repeated wrong-guess counting; and Sanket's O-first board, in-place cell mutation, case-mismatched Card import and reset only after a winner. No source, network request, permission, random choice, prompt, input, stylesheet or route was repaired.

Twelve fresh native snapshots followed equal full source-only models/rendered content, with only explicit harness timestamps excluded from rendered equality. Eleven complete reports and pageErrors arrays match originals. Rasheed remains a genuine non-exhausted mismatch at the unexpected NotificationContainer; it was not made transparent or omitted. The inspected installed library source mounts that container even with an empty notification list. Six exact, five partial and one mismatch classifications remain unchanged, but those classifications do not establish full report continuity.

Rupa's continuity stage failed: its original capture has five masked letters and the fresh capture six, consistent with the authored random fruit lengths. matchedText changed6→7, runtimeFibers47→48 and stepsUsed48→59; both reports remain exact/non-exhausted. Its two original JavaScript-as-stylesheet MIME errors also arrived in reverse order. The full equality assertion remains strict. No reroll, seed, error sorting, normalization, original-result overwrite or analyzer repair was performed. Post-capture tree/runtime audits were completed separately and match originals.

Lane0 exited1 and lane1 exited0. Across all12 records there are59 successful stages and one failed continuity stage, not60 successes;24 timestamp-exclusion controls passed. `/tmp/bippy-ui27-scoped-recapture-qualified-audit.json` preserves the distinction, observed reports, page-error order, and model/capture hashes. Original evidence,500 corpus data rows and246 production-source hashes remain unchanged. Javohir alone retains its exact audited untracked node_modules directory exception. This is scoped review/recapture evidence, not12 full repository acceptances, new CLI replay or lifecycle certification.

### UI28: twelve scoped reviews and independent recaptures

All176 bounded UI28 chunks have now been displayed, including Hossam's complete155,949-byte tracked Bootstrap RTL stylesheet. The scope covers168 tracked text files through111 newly displayed bodies and57 byte-verified prior references. Twelve locks remain machine-audited—not line-read—and37 binaries remain outside visual review. All217 regular tracked files remain hash-checked; no gitlinks were inventoried. Embedded image text is not a visual asset review.

The partition receipts are `/tmp/bippy-ui28-{first-three,next-three,five,hossam}-scoped-source-reviewed.json`. Their individual review-before-model-before-capture timestamps remain authoritative for recorded chronology; the later aggregate `/tmp/bippy-ui28-scoped-source-reviewed.json` does not backdate reading. The eleven-record checkpoint and its then-pending Hossam scope remain preserved separately. All twelve independent recaptures completed60 successful stages and24 negative timestamp controls. Full serialized models and rendered contents matched before browser launch, excluding only the two explicit harness snapshot timestamp locations. All twelve full comparison reports and pageErrors arrays match originals: eleven exact/non-exhausted and Hossam partial/non-exhausted. `/tmp/bippy-ui28-scoped-final-audit.json` checks these results, original evidence, all217 tracked file hashes and246 production-source hashes. The500-row corpus remains unchanged.

Source findings remain unrepaired: Malik's board is module-global, cell coordinates are swapped and its antidiagonal repeats an endpoint; Mridul retains a next-player message on draws; TheNewC0der advances immediately before scheduling10ms ticks and writes document.title; Shobhit starts with O, updates win state during render and retains the player on restart; Sam's stopwatch starts automatically and BMI inputs remain unvalidated; Nikhil's lap elements lack keys and its timer lacks unmount cleanup. Hossam's initial all(10) palette, empty input,1500ms error timers, Bootstrap5.0.2 RTL styles and relative source-map reference remain unchanged. His partial report still retains139 native fibers, seven bounded states, two wildcards, one repeat omission and seven incomplete among eight original replays.

Mridul, Hossam and Sam retain only their exact audited untracked node_modules directory exceptions. No timer, random choice, input, request, stylesheet, route, launcher, dependency version or original result was repaired. These are retrospective scoped reviews and recaptures, not twelve full repository acceptances, new CLI replay, transition coverage, visual correctness or renderer-cleanup certification. Five hundred imported repositories still do not establish500 audited acceptances.

### UI29: scoped review completed; random-word continuity failure retained

All95 bounded UI29 chunks were displayed, covering138 distinct text bodies,67 byte-verified UI28 references and two within-batch references. The scope totals207 tracked text files;14 locks remain machine-audited rather than line-read, and38 binaries remain outside visual review. All259 regular tracked files remain hash-checked; no gitlinks or symlinks were found. The partition receipts `/tmp/bippy-ui29-{first-two,next-four,remaining-seven}-scoped-source-reviewed.json` preserve recorded review-before-model-before-capture chronology. `/tmp/bippy-ui29-scoped-source-reviewed.json` is a later aggregate, not a backdated approval. Dictionaries, styles, configuration, tests and authored launchers remain unchanged.

Thirteen fresh native snapshots followed equal full source-only models and rendered contents, excluding only explicit harness snapshot timestamps. Twelve complete comparison reports match originals; all thirteen pageErrors arrays match. Eight exact, four partial and one truncated classifications remain non-exhausted. Ankit's truncated report failed full continuity: its original two letter cells became six, consistent with the authored random dictionary and word-length-dependent state. matchedFibers/runtimeFibers changed40→44, repeatIterations2→6 and stepsUsed44→52. Its missing-key warning is unchanged. No reroll, seed, sorting, application-data/statistics normalization, budget change or source repair was used to force equality.

Ankit's capture stage exited1; its post-capture installation/runtime audits were completed separately and matched originals. Across13 records,64 stages succeeded and one continuity stage failed—not65 successes. All26 negative timestamp controls passed. `/tmp/bippy-ui29-scoped-qualified-final-audit.json` retains the report deltas, cell counts, model/capture hashes and separate post-audit qualification. The original evidence,500-row corpus and246 production-source hashes remain unchanged. No untracked dependency-directory exceptions were needed in these thirteen clones.

Source findings remain separate from modeled interaction coverage. Drazhin keeps its weight-zero branch, scroll listener without removal, node-sass and3000ms copied timer; Shyren's successful submission does not reset its error flag. Ankan/Sanskar use module-global boards and direct innerHTML without occupied-cell guards; Sanskar retains count on reset and lacks draw detection. Pramod stores digit0 and mutates its state array on reset. Erhed retains six fixed initial colors, nested color mutation and temporary-input clipboard copying. Hamza permits stopped laps without interval unmount cleanup; Adib retains its authored /react-stopwatch/ base and10ms increments. Tulna remounts on reset; Oybek truncates history on jump and stores digit0. Varun's unmount cleanup only resets the title, not rAF/interval handles. Osman retains localStorage startTime across mode toggles. Ankit retains its dictionary, word-length-dependent chances/images, mutable guess Set and missing keys.

These are scoped retrospective reviews and independent recaptures, not thirteen full repository acceptances, new CLI replay, visual/timing correctness, transition coverage, full transitive-source review or renderer-cleanup certification.

### UI30: scoped review completed; three continuity failures retained

All127 bounded UI30 chunks were displayed. The scope covers231 tracked text files:173 distinct bodies,52 byte-verified UI29 references and six within-batch references. Fourteen locks remain machine-audited rather than line-read;49 binaries and vector renderings remain outside visual review. All294 regular tracked files are unchanged; no gitlinks or symlinks were found. `/tmp/bippy-ui30-scoped-source-reviewed.json` aggregates four partition receipts; their individual review-before-model-before-native timestamps are authoritative, not the later aggregate timestamp.

Fourteen independent native snapshots followed equal full source-only models and rendered contents, excluding only the two explicit harness timestamp locations. Eleven full comparison reports and all14 pageErrors arrays match originals. Seven exact, six partial and one truncated classifications remain non-exhausted. All28 negative timestamp controls passed. `/tmp/bippy-ui30-scoped-qualified-final-audit.json` records67 successful stages and three failed continuity stages, with separate successful post-capture installation/runtime audits for the failed captures.

Abdallah's random mask grew from four to six letters: matchedText8→10, runtimeFibers54→56 and stepsUsed67→57; both reports remain exact. Nhung's authored API returned could originally and copperplate freshly: masked letters/repeatIterations5→11, runtimeFibers23→29, strictCoverage0.9565217391304348→0.9655172413793104 and stepsUsed32→38. Its wildcard head retains the actual response, and both reports remain partial. PNC's random word shrank from six to four letters: matchedFibers/runtimeFibers56→52, repeatIterations6→4 and stepsUsed67→61; both reports remain truncated. No reroll, seeding, substitute API response, sorting, normalization, budget increase or source repair was used to force continuity.

CrackingDemon had not started when Nhung stopped its lane; the separate resume runner performed its first capture, not another attempt at Nhung. Next-two and middle-four runner -audited.json scope strings inherited first-two wording. That textual label is inaccurate; the actual partition approval paths, selected IDs, assertions and artifacts remain unchanged. The qualified audit corrects the label without overwriting those receipts. `/tmp/bippy-ui30-outer-runner-observed.json` records current unqualified pnpm10.12.1/Node24.21.0 after earlier captures, not a backdated probe or proof of historic11.20.0/24.19.0. Explicit corepack launchers and the per-app before/after runtime probes are separate evidence and match originals.

Authored behavior remains intact. Abdallah retains dis/abled attributes, persistent endState and a constructor keydown listener without removal; Birka retains its automatic colormind API POST and Saved Palettes storage. Aman's3600-second countdown starts automatically; Promise keeps React17/ReactDOM16 and omitted percent arguments on color changes. Satyam retains the600000-hour divisor and dependent countdown intervals. Nhung visibly reveals the puzzle; Vetrivel retains47 programming languages and repeated keyboard guesses. CrackingDemon retains wrong.lenght and a literal dollar sign. Ville keeps five challenges and a500ms win timer; Darkbits retains automatic10ms fresh-array updates even while stopped and pause history on reset. Asma keeps in-place board mutation and authored motion/Sass dependencies; CodeStackr keeps four random words. Peter retains10ms class timers and subsecond button conditions without unmount cleanup.

PNC's entire851-word dictionary was displayed, closing its earlier truncated supplemental-reading gap without changing the data. Christ and Christmas retain uppercase C, which cannot be entered through its lowercase-only authored keyboard/input handling. Its per-render random draw, CSS-hidden answer text, keypress subscriptions and Enter restart remain unchanged. This source finding is not a newly executed interaction test.

The500-row corpus, original evidence and246 production-source hashes remain unchanged. These scoped reviews and captures do not establish14 full repository acceptances, new CLI replay, full transitive-source review, visual/timing/transition correctness or renderer cleanup.

### UI31 earlier checkpoint: six scoped recaptures; Aanglin unapproved

UI31's inventory covers only its seven imported records, not five verified-but-unimported extras:149 regular tracked files, including118 text files, seven locks and24 binaries. Bounded chunks0–55 and383–392 have now been displayed;56–382 remain unread. Source reading approved Sintu, Brainrot, Arhmali, Whydee, Het and MK through separate first-three, next-two and MK receipts. Their combined scope is88 text files, six machine-audited locks and16 binaries outside visual review, totaling110 tracked files. SVG text review does not establish visual correctness.

Six independent native captures passed30 stages and12 negative timestamp controls. Full source-only models, rendered contents except the two explicit harness timestamps, all six comparison reports and all six pageErrors arrays match originals. Five exact reports and Het's partial report remain non-exhausted. `/tmp/bippy-ui31-six-scoped-final-audit.json` records the checks, partition chronology and original-evidence hashes; all149 batch tracked files, the corpus and246 production-source files remain unchanged.

The first source-approval attempt stopped on unexpected untracked node_modules, before any approval receipt or native launch. That failure is retained in `/tmp/bippy-ui31-first-three-source-approval-first-failure.json`. Sintu and Brainrot have no tracked gitignore; their exact node_modules/ exceptions were checked against the original phase policy before approval. No broader exception or source repair was made.

Authored behavior remains intact. Sintu starts at1 and wins only on6; its unused StrictMode import does not wrap the root. Brainrot starts with images1/2 and retains class spelling and missing alt attributes. Arhmali retains its external FontAwesome kit and one-second rolling timeout. Whydee retains /Tenzies, predepoly, dice values1–5, three Won calls per render and fixed confetti dimensions. Het delays both rolling-state writes by1000ms, writes true then false consecutively and reads this.rolling for its button class. MK retains src/index.jsx, per-render allNewDice evaluation, nanoids, Math.ceil(random*6) including zero at exact random zero, and a winning flag not cleared by unholding. These are source findings, not newly executed interaction tests.

Aanglin is not approved for recapture. Its146,706-byte tracked build JavaScript and376,137-byte source map remain mostly unread, and the separate main.0357f457.js.LICENSE.txt at chunk147 is also unread. The first six-record aggregate overlooked that license file; `/tmp/bippy-ui31-six-scoped-source-reviewed-v2.json` corrects the wording without overwriting the earlier receipt or changing its selected set. Smaller archived CSS/web-vitals bundle and map text was displayed, but mappings were not decoded or verified equivalent to development source. The large archives remain pending, not silently excluded. Its live-source two-second dice animation and authored /dice paths remain unchanged.

These six scoped reviews and recaptures do not establish full repository acceptance, new CLI replay, full transitive-source review, visual/timing/transition correctness or renderer cleanup. The next unread bounded chunk is56. Five hundred audited acceptances remain unestablished.

UI26 inventory initially failed with EISDIR on Ravi's tracked Timer gitlink at0c3556e71d21a9ac87e7de024b53672ae8dca3b8. Its directory is empty and no .gitmodules URL is supplied. The reviewed root entry instead imports src/component/Timer.jsx; the gitlink's unavailable source is not fabricated or labeled reviewed. Kartik also tracks a143,965-byte build bundle and364,408-byte source map. Its recorded CRA5 npm-start recipe uses src/index.js/public/index.html; installed webpack-dev-server configuration serves public files and virtual development outputs. The12 archived build artifacts remain hashed, unchanged and explicitly unread—not exempt from mutation checks. The initial120-chunk inventory is retained. `/tmp/bippy-ui26-authored-review-plan.json` records a narrower pending23-chunk authored-source review plus these separate gaps; it is not approval or completion. No new UI26 post-read capture has been launched.

### UI31: Aanglin review and seventh scoped recapture completed

All393 bounded UI31 chunks have now been displayed without truncation. The continuation completed232–382 after the preceding review reached231; the main bundle, separate license, complete source-map text, embedded sources and names are no longer unread gaps. Aanglin's scope includes30 text files (19 new bodies,10 UI30 references and one within-batch reference), one machine-audited lock and eight binaries outside visual review. Its39 tracked files, pinned revision and referenced bytes were checked before approval at2026-09-14T21:16:50.490Z. Earlier unread-range receipts remain historical evidence, not current blockers.

The main map contains34 embedded sources,197,585 mapping characters and1,409 names. Separate machine comparisons found its five embedded application JavaScript bodies byte-equal to the live tracked files. Displaying encoded mappings does not establish decoded mapping correctness or equivalence of compiled code. The archived ReactDOM export reports18.2.0-next-9e3b772b8-20220608 while renderer metadata reports18.2.0; these archive observations are distinct from installed-tree and launcher audits. Authored /dice/, initial one/one, FontAwesome requests, two random draws per roll and the2000ms timeout without unmount cleanup remain unchanged. No interaction or visual test was added.

Aanglin's independent native recapture passed all five stages and both negative timestamp controls. Its complete source model and rendered contents, excluding only snapshot.capturedAt and commits[index].capturedAt, matched originals before native launch. Its full report and pageErrors also matched. UI31 now has seven scoped recaptures,35 successful stages and14 controls: six exact and Het partial, all non-exhausted. All149 batch tracked files, original evidence, the500-row corpus and246 production hashes remain unchanged at the final audit.

Evidence: `/tmp/bippy-ui31-aanglin-scoped-source-reviewed.json`, `/tmp/bippy-ui31-aanglin-scoped-read-v4-lane-0.json` and `/tmp/bippy-ui31-all-scoped-final-audit-v2.json`. The first aggregate audit failed before execution because its generated TypeScript had an unterminated string; its script/log/exit remain preserved. The corrected v2 audited existing evidence without rerunning native capture. Aggregate timestamps do not backdate partition approvals. No matching Aanglin scoped runner/server process remained in the subsequent process check; this does not certify renderer cleanup.

Five verified-but-unimported extras remain unimported. UI24/UI25 complete-reading gaps, UI26 Ravi's unavailable gitlink and Kartik's12 unread archived artifacts remain unresolved. Seven scoped reviews are not seven full acceptances, new CLI replay, transitive-source review, workflow/timing/visual correctness or cleanup certification. Five hundred imported repositories still do not establish500 audited acceptances.

### UI24: bounded tracked-text review and v4 recaptures completed

A fresh55-chunk review has now displayed all new UI24 tracked text without truncation. Its177 text files resolve through75 newly displayed bodies,76 byte-verified references to completed UI31 scopes and26 within-batch references. All229 tracked files include14 machine-audited locks and38 binaries outside visual review; no gitlinks or symlinks were found. Ahsan's exact untracked node_modules/ exception was checked against the original verify-directory policy and absent tracked gitignore. Earlier UI24 inventory and qualified v3 receipts remain unchanged; this later reading does not establish their earlier completeness.

After the new approval,13 independent v4 recaptures passed65 stages and26 negative timestamp controls. Every full source-only model and rendered result, apart from the two explicit harness timestamps, matched originals before native launch. All full comparison reports and pageErrors arrays matched: three exact and ten partial, all non-exhausted. Source review preceded each model freeze and native snapshot. All229 tracked files, original model/capture/report evidence, the500-row corpus and246 production hashes were unchanged at the final audit. These captures are separate from the older13 v3 recaptures, not13 additional repositories or new CLI replay evidence.

Source findings remain unrepaired. Yonatan's random*15 excludes F from hex digits, its mode buttons reset to black and its log reads the prior color. Aiyanu displays a doubled #. Most Values-based generators retain their submit-error flag; Joel instead clears it, uses all(8) and renders a literal semicolon. Tim allows play after a win and restart does not reset turn; occupied cells alert, direct table text remains and no draw condition exists. Nidhi retains the literal <pre> CSS prefix,10ms increments, interval cleanup, minute wrapping and reset without resetting isPaused. Abhig/Ahsan clear timeout handles through clearInterval; Tanuj retains initially undefined color,500ms timeout and percecnt-value spelling. These are source findings, not executed interaction checks.

Evidence: `/tmp/bippy-ui24-scoped-source-reviewed.json`, `/tmp/bippy-ui24-scoped-read-v4-lane-{0,1}.json` and `/tmp/bippy-ui24-scoped-final-audit.json`. The remaining UI25 gap now has a fresh inventory at `/tmp/bippy-ui25-scoped-bounded-review-plan.json`:196 tracked files, comprising161 text,13 locks and22 binaries. Its68 chunks0–67 remain unread and unapproved; inventory/hash checks alone do not close that gap. Full acceptance, transitive review, workflow/timing/visual correctness, new CLI replay and renderer cleanup remain separate. Five hundred audited acceptances are still unestablished.

## Immediate continuation

1. Review fixes are checkpointed at `80b8f278`, initial commit causes at `608d38ab`, guarded heap/read/N-way fixes at `c3b76b75`, predicate caching at `ac3d6a8c`, and replay claims at `985b78e0`. The guarded timer checkpoint `d9d6abc3` adds registration, cancellation, and task-only replay constraints. Architecture documentation is checkpointed at `a85cdf1e`. Promise/task journaling is checkpointed at `9562e79f`, adoption and cleanup ordering at `b845c6eb`, CRA macros/bundled compiler versions at `3a21a706`, incomplete replay membership at `0a0ce65a`, corpus option/child-environment handling at `d1c9d91b`, await microtask ordering at `200d4629`, corpus compiler environments at `c5da0c82`, and native Vite command-line modes at `2dbacfcc`. Nothing pushed.
2. Both saved captures still match with 100% strict coverage and no replay contradictions. Sentry is `sample-passed` (1 replay); PostHog is `sample-incomplete` (2 replays, 1 inconclusive missing-container path). Do not describe PostHog's entire sample as verified.
3. The latest owned-candidate frozen checkpoint passes **4,044 root tests**, with 38 existing expected failures and two React-19 DevTools skips; this includes **1,967 analyzer passes / 38 expected failures / 111 files**. It tests `a7a026a9` plus nine namespace-symbol files, not unfinished uncommitted concurrent tests. The earlier fourteen lifetime checks still characterize cache limits rather than repairing freshness. The previous shared frozen checkpoint remains 3,718 root / 1,672 analyzer passes. Root typecheck/build, realm checks, scoped lint/format and documentation checks pass. Current tooling uses Node 24.21.0; timings are not a controlled comparison with earlier environments. Preferred outside-match replay now checks matching candidates without raising the replay budget. The working corpus contains **500 imported repositories**, checked against distinct GitHub repository IDs. Complete source-review evidence remains under reconciliation, so reaching the imported count does not certify 500 fully audited acceptances. P1/P2 and the 500-repository gate remain incomplete.
4. Complete effect-cause coverage beyond the tested paths; do not confuse this first implementation with full lifecycle/lane/branch isolation.
5. Audit replay classification and incomplete claims, including historical `exact` entries with contradictions.
6. Review and integrate the already-pushed correlation branch without duplicating its work.
7. Reconcile stale-result and parity branches against the **same** captures.
8. Fix generic semantic and renderer defects in root-cause batches.
9. Execute coverage-driven witnesses and expand the live corpus toward 500 repositories.
10. Re-run acceptance gates and update this ledger after each meaningful checkpoint.

---

## 1. Baseline and evidence conventions

### Repository state at plan creation

| Item                           | Value                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| Pull request                   | [aidenybai/bippy#115](https://github.com/aidenybai/bippy/pull/115)     |
| Package                        | `packages/bippy-analyzer`, private `bippy-analyzer`                    |
| Branch                         | `devin/1788659752-parser-package`                                      |
| Checked-out committed baseline | `3c2db5d8`                                                             |
| Plan baseline date             | 2026-09-10                                                             |
| Local source changes           | Two review fixes and regression tests; not yet committed               |
| Last local parser suite        | 720 tests passed, 39 files                                             |
| Local validation caveat        | Full suite used canonical macOS `TMPDIR=/private/tmp`                  |
| Other local checks             | Parser typecheck, targeted lint, formatting, `git diff --check` passed |
| Fresh local corpus replay      | Not performed in this continuation yet                                 |

The 720-test result verifies the current local fixes, not the unmerged worker branches and not all real-world corpus claims.

### Evidence labels

Use these labels in updates rather than conflating different kinds of completion:

- **Implemented:** code exists on the checked-in branch; this is not a universal correctness claim.
- **Locally verified:** reproduced on the current local tree with commands and results recorded.
- **Historical:** a checked-in result or previous validated run; may depend on an older capture/environment.
- **Worker-reported:** an earlier worker's report, not yet independently verified after integration.
- **Open:** a task, defect, or hypothesis requiring investigation.
- **Blocked:** an explicit external dependency or missing capability, with a concrete next action.

A task is checked off only when its stated acceptance evidence exists. Keep worker-reported improvements separate from the baseline counts until they are integrated and revalidated.

### Checked-in corpus baseline

Counts below were recalculated from `packages/parser/corpus/manifest.json` and `corpus/results.json`, not copied blindly from the PR description.

| Category                            | Count |
| ----------------------------------- | ----: |
| Manifest entries                    |   207 |
| Distinct normalized repository URLs |   207 |
| Results records                     |   207 |
| Entries historically live-captured  |   195 |
| `exact`                             |   111 |
| `partial`                           |    62 |
| `mismatch`                          |     7 |
| `truncated`                         |     8 |
| `unresolved`                        |     7 |
| Static-only / no comparison report  |    12 |
| `unsound` in baseline results       |     0 |

**Important:** zero checked-in `unsound` rows does not establish soundness. Later unmerged captures expose Typebot as unsound, and existing exact rows already contain replay mismatches.

### Newly verified accounting gaps

A direct inspection of the current results file found:

- **135 records with runtime metadata have no `stateReplay` summary.** The corpus does not yet have uniform independent-replay evidence.
- Four records labeled `exact` contain replay mismatches:

| Entry                 | Symbolic/adjusted state count | Replay sample / reported assignments | Mismatches | Marked corrected |
| --------------------- | ----------------------------: | -----------------------------------: | ---------: | ---------------: |
| `sentry`              |                            52 |                              16 / 40 |          9 |                9 |
| `mantine-admin`       |                           175 |                              16 / 72 |          9 |                9 |
| `form-builder`        |                        68,097 |                             16 / 255 |         16 |                0 |
| `mantine-react-table` |                   443,451,396 |                             16 / 252 |         16 |                0 |

The assignment denominator is the harness's reported assignment count, not necessarily every assignment of the full symbolic space. In particular, a count derived from a bounded state view must not be advertised as exhaustive coverage.

These findings require classification, not a blanket label change: some mismatches may be caused by incomplete claims; others are genuine interference. Either way, `exact` for a captured page must not be presented as a globally validated state space.

---

## 2. Non-negotiable engineering constraints

- Follow root `AGENTS.md` and the code-quality standard in `packages/bippy`.
- TypeScript for project-authored code; interfaces over type aliases where appropriate; declarations at module scope.
- Arrow functions, kebab-case files, descriptive names, minimal casts, no dead helpers or duplicated abstractions.
- No unnecessary comments. Necessary workaround comments use `// HACK:` and explain the reason.
- Use `pnpm` for project scripts and `tsx` for checked-in TypeScript scripts. Bun is for ad-hoc probes only.
- Clone `facebook/react` and read the relevant source before implementing React behavior. An inspected local checkout exists at `/tmp/bippy-parser-pr115-react`; record the version/commit relevant to each behavior, not merely that a clone exists.
- Use oxc's actual AST types and generated visitor keys; do not introduce a second hand-written AST model.
- Prefer standard libraries and authoritative declarations to handwritten tables when they express the needed truth.
- Validate external data with Zod. Typed infrastructure errors belong in `src/errors.ts` and must propagate through the appropriate boundary.
- An exception thrown by analyzed application code is part of program semantics. An exception thrown by our infrastructure is not an app state and must not silently disappear into an unknown.
- Maintain one analysis strategy. Application code is interpreted; real React constructs the fibers. Build-tool transforms and the independently running runtime oracle have different, explicit execution roles.
- Do not loosen the comparer to improve a percentage. Any framework transparency rule needs version-specific source and runtime evidence.
- Do not hardcode application names, expected trees, or preferred state outcomes into generic analysis.
- Library models must reflect library source. Interpreting an installed package is preferable when feasible; an allowlist is a resolution policy, not evidence of correctness.
- Do not raise evaluator, matcher, branch, or replay budgets to hide missing semantics or regressions.
- Keep corpus clones, databases, generated probes, and captures outside the monorepo unless a small sanitized fixture is intentionally checked in.
- Never put API keys, auth headers, session credentials, or raw private transcripts in this repository or its PR.
- Preserve unrelated local edits. Integrate branches serially; no destructive reset, blind overwrite, or force-push.

### Current limits to keep visible

These are the current source defaults, not an endorsement that every historical limit choice was ideal:

| Limit                            | Current value / source               |
| -------------------------------- | ------------------------------------ |
| Interpreter call depth           | 128, `evaluate/interpreter.ts`       |
| Interpreter fork depth           | 5, `evaluate/interpreter.ts`         |
| Interpreter steps                | 2,000,000, `evaluate/interpreter.ts` |
| Matcher steps                    | 200,000, `harness/compare.ts`        |
| Materializer component depth     | 512, `materialize/materializer.ts`   |
| Materializer element count       | 50,000 by default                    |
| Recursion per component          | 16 by default                        |
| Render passes                    | 50, current materializer constant    |
| Non-preferred alternative depth  | 2, current materializer constant     |
| Derived state sample             | 256 by default                       |
| Repeat exploration above minimum | 2 by default                         |
| Independent replay assignments   | 16 by default                        |

Audit every limit's observable omission behavior. The recovered history includes an earlier render-pass increase; do not repeat budget escalation as a substitute for semantic fixes. Distinguish Node process heap settings from semantic budgets, and investigate memory retention before increasing either.

---

## 3. Architecture and work already completed

### One pipeline

```text
source files
  -> oxc parse + module records
  -> oxc resolution + module graph + build-tool transforms
  -> abstract interpreter over StaticValue
  -> materializer: real React elements and interpreter-backed component proxies
  -> project's React reconciler + renderer host
  -> bippy commit/fiber capture
  -> guarded symbolic tree
       -> lazy state view / membership queries
       -> guard coverage / witness plan
       -> independent replay
       -> comparison with separately captured real applications
```

The symbolic artifact must not be reduced to whichever tree happened to be captured or whichever concrete states fit in the enumeration budget.

### Implemented subsystem ledger

| Subsystem               | Implemented progress                                                                                         | Remaining responsibility                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Parsing                 | oxc-parser, source locations, generated visitor-key traversal                                                | Audit unsupported AST variants and unsupported-node behavior                     |
| Graph                   | Relative/package/workspace/alias resolution, imports/exports, barrels, cycles, CommonJS interop, JSON/assets | Cross-environment resolution, cache invalidation, unusual build pipelines        |
| Bundler integration     | Vite config evaluation, user transforms, HTML transforms, asset URLs, SVGR, StyleX, CRA paths                | Confirm host isolation, transform fidelity, remaining Metro/Expo work            |
| Value evaluation        | Primitive/object/list/function/class values, branches, uncertainty, properties, calls, operators             | Semantic coverage and sound handling of every unsupported operation              |
| Control flow            | Narrowing, switch, loops, partial lists, path-journaled root renders, deferred returning-path joins          | Nested mutation/control-flow interactions and termination behavior               |
| Heap and recursion      | Allocation-aware mutation log, receiver-sensitive convergence, iterator protocol                             | Stress mutable aliases, escaped contexts, loop-heavy applications                |
| React semantics         | JSX variants, components, memo/forwardRef/lazy/context, classes, hooks, effects, portals, boundaries         | Cause-sensitive commits, actions/transitions, version and renderer matrix        |
| Native/host semantics   | Declaration-derived realms, renderer-owned document, native concrete operations, explicit layout uncertainty | Realm gaps, cross-realm identity, unsupported DOM capabilities                   |
| Libraries               | Query/store/router/i18n/style/UI models plus source interpretation                                           | Reduce opaque boundaries without inventing library behavior                      |
| Frameworks              | SPA, Next App/Pages, React Router framework/data routes                                                      | Version profiles, async/server boundaries, real native renderer coverage         |
| Symbolic representation | Input-provenance guards, correlations, symbolic cardinality, serialized tree                                 | Complete cause guards, projection consistency, honest solver outcomes            |
| State view              | Independent clusters, lazy whole-state enumeration, membership without expanding every whole state           | Completeness accounting and queries beyond enumerated prefixes                   |
| Coverage                | Witnessed / possible / unreachable guard sides                                                               | Targeted runtime execution and explicit proof assumptions                        |
| Replay                  | Fresh interpreter renders with pinned decisions, mismatch reporting, sampled assignments, correction         | Overclaimed commits, incomplete claims, tree/view consistency, sample accounting |
| Empirical harness       | bippy snapshots, happy-dom fixtures, Playwright dev-server captures, observations                            | More state witnesses, consistent capture identity, resource cleanup              |
| Corpus                  | 207 pinned repositories and historical results                                                               | Refresh 195 live entries, unblock 12 static-only entries, expand to 500          |
| Quality                 | Typed errors, Zod boundaries, layered modules, AST-type cleanup, dead-code passes                            | Re-audit after integration; documentation currently contains stale descriptions  |

### Major milestones from the recovered history

- [x] Created `packages/parser` and a real-application verification harness.
- [x] Replaced the handwritten fiber builder with interpreter-backed React components rendered by the reconciler.
- [x] Established pinned real-repository installs, dev-server captures, and static-only replay.
- [x] Brought Cal DIY, Documenso, PostHog, and Sentry into the live corpus, including reproducible service setup.
- [x] Reached historical strict parity on the core large applications through generic evaluator improvements.
- [x] Introduced predicate-correlated reachable-state enumeration instead of a single preferred tree.
- [x] Made the guarded symbolic tree first-class; made whole-state enumeration a derived view.
- [x] Added guard coverage and witness planning.
- [x] Added independent pinned replay to reveal branch interference.
- [x] Generated host realms from declarations; separated renderer-owned DOM behavior from evaluation.
- [x] Fixed major recursion, iterator, partially known list, root-render journaling, and matcher performance defects.
- [x] Integrated corpus waves through the 207-entry baseline, including the Next blog/starter wave.
- [x] Recovered parent and worker context before choosing the next implementation direction.
- [ ] Resolve the soundness issues revealed by the machinery above.
- [ ] Establish uniform, current evidence for the historical corpus.
- [ ] Complete the planned renderer, witness-execution, transition, and 500-repository work.

### Research decisions already made

| Investigation                                                  | Evidence / decision                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React Compiler, react-doctor, calldiff, knip/fallow, pattycake | Studied for compiler architecture, module analysis, effect modeling, corpus discovery, and quality patterns; continue consulting source rather than copying unrelated machinery                                          |
| tsc-backed graph                                               | Separate investigation in #117 and `docs/tsc-graph-investigation.md`; reported 8–13 seconds / 6–9 GB on Sentry/PostHog while resolving only 1–3% of uncertain sites; retain oxc unless new evidence changes the tradeoff |
| Forking V8/QuickJS                                             | Not adopted; a concrete engine does not automatically preserve symbolic values or implement abstract semantics                                                                                                           |
| Concolic prototype                                             | Keep as unmerged research, not a sound replacement; reported 653 concretizations on react-admin and 116 on GraphiQL, making the explored space an underapproximation                                                     |
| Component summary cache                                        | Investigated by budget worker; profiles reportedly showed single large loops rather than repeated equivalent component evaluations; do not add a speculative cache without a new profile                                 |
| Package rename                                                 | Discussed but not selected; keep `@bippy/parser` for now                                                                                                                                                                 |

---

## 4. Local implementation checkpoints

### Review fixes checkpointed at `80b8f278`

- [x] Fix `parseInt` / `Number.parseInt` radix inference: omitted, undefined, or null radix no longer forces decimal parsing of hexadecimal-prefixed strings.
- [x] Preserve bound arguments during escaped-call analysis, before call-site arguments.
- [x] Preserve the existing direct-callback versus held-method mutation distinction when bound arguments require a non-null escape frame.
- [x] Add direct, held, rebound, call-site, unused-callback, recursive, and stale-dependency regression coverage.
- [x] Add interpreter mutation regression coverage and real-fiber component coverage for integer parsing.
- [x] Demonstrate the new radix/bound-callback tests fail before the fixes and pass afterward.
- [x] Run parser typecheck, targeted lint, formatting, diff check, and full 720-test parser suite.
- [x] Revalidate and checkpoint these review fixes before worker-branch integration.
- [ ] Reconcile overlapping escape-analysis changes when integrating the correlation branch.

Files:

- `packages/parser/src/evaluate/builtin-calls.ts`
- `packages/parser/src/evaluate/escapes.ts`
- `packages/parser/src/evaluate/interpreter.ts`
- `packages/parser/tests/evaluate.test.ts`
- `packages/parser/tests/escapes-bound-arguments.test.ts`
- `packages/parser/tests/components/throws-and-natives.tsx`

### Review finding deliberately not changed

The suggested change to legacy Vite HTML-hook ordering was a false positive. Vite 6's own `resolveHtmlTransforms` maps legacy `enforce: "post"` to the normal phase, not modern `order: "post"`. The existing implementation and regression test follow that behavior. Keep version-specific semantics, not the review suggestion merely because it exists.

### Local environment issues

- Default macOS temporary paths expose `/var` versus `/private/var` symlink differences in `install-root.test.ts` and `react-runtime.test.ts`.
- The full suite passes with `TMPDIR=/private/tmp`; this is an environment workaround, not a parser semantic fix.
- [ ] Decide whether these tests and package-root identity logic should canonicalize paths generically; reproduce on the unmodified base before changing them.
- [ ] Recheck PR CI separately. Earlier inspection found an iOS/native E2E failure; do not conflate that with parser-suite success or assume it is still the current CI state.

---

## 5. Pending branch integration ledger

All branch improvements below are **worker-reported** unless explicitly marked locally verified. Remote SHA existence was checked; existence is not a successful merge or correctness verification.

| Priority | Branch                                         | Remote tip checked | Contents / risk                                                                                                                          |
| -------- | ---------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| High     | `devin/1789014494-corpus-parity-guards`        | `5438a8e9`         | Correlation, branch-aware iteration, pointer-arrival alternatives, Intl fix, three additional exact entries; exposes Typebot unsoundness |
| High     | `devin/1789039478-corpus-refresh-stale`        | `19d3ec8a`         | Results-only fresh SaaS captures; several historical successes become mismatch/unresolved/unsound                                        |
| Medium   | `devin/1789033444-ecommerce-media-corpus`      | `f96ae422`         | Eight more entries plus Metro/Reanimated source transform; reports 215 entries after integration                                         |
| Medium   | `devin/1788958687-step-budget-parity`          | `e72fc1ce`         | Budget/loop/asset gaps and pending happy-dom resource cleanup; last report was mid-remerge                                               |
| Medium   | `devin/1788958451-rn-expo-corpus`              | `af685cc8`         | React Native Web/Expo coverage; pending Supabase Expo regression investigation                                                           |
| Medium   | `devin/1788958693-corpus-parity-batch-rebased` | `d10c05b2`         | Mismatch/unresolved fixes; pending remix-blocks/i18next initialization regression                                                        |
| Medium   | `devin/1788958700-parity-batch`                | `00660f98`         | Async data/store semantics; latest report did not complete current-head validation                                                       |

The already-merged replay branch `devin/1788958782-state-replay` at `13f9b327` is **not** the unfinished effect-cause-guard implementation. Its worker received a new task after replay landed, but reported no completed cause-guard delivery.

### Correlation branch: reported changes requiring verification

- `teable`: partial 98.1% → exact, 3 states.
- `magic-portfolio`: partial 89.3% → exact, 2 states, including clock-dependent Intl handling.
- `shadcn-crm-dashboard`: opaque partial → exact, 4 states.
- `langfuse`: partial 63.0% → partial 83.8%.
- `mini-dashboard`: partial 84.6% → partial 92.7%, but 16 sampled replay mismatches.
- `flagsmith`: partial 13.2% → partial 16.6%, but 16 sampled replay mismatches.
- `hooks-admin`: partial 4.6% → partial 13.4%; wildcard absorption removed, opaque Ant Design internals remain; 6 → 10 states.
- `typebot`: partial → **unsound**, 5 of 16 sampled replays reach an unmaterialized `SignInForm` alternative.
- Reported counts: 114 exact, 58 partial, 1 unsound; 207 entries unchanged.
- Reported suite: 729 tests on that worker branch, not the local branch.
- Pointer-position events must remain fired/not-fired alternatives, never an assumption that Chromium dispatched them.

### Fresh SaaS results: conflicts that cannot be merged by choosing better numbers

| Entry        | Fresh worker-reported outcome             | Investigation                                                                                                 |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `plane`      | mismatch, previously partial 91%          | MobX/SWR loading state collapses to a spinner; runtime instance setup differs                                 |
| `twenty`     | unresolved                                | `process is not defined` in materialized render; Vite `process.env` replacement and host globals              |
| `teable`     | mismatch on a fresh 498-node capture      | Radix ScrollArea/Presence layout-driven mount; conflicts with correlation branch's older-capture exact result |
| `typebot`    | unsound                                   | Tolgee readiness leads replay to an unmaterialized login alternative                                          |
| `formbricks` | exact                                     | Verify with the same capture and current code                                                                 |
| `karakeep`   | truncated at 100% strict                  | Unrendered or omitted alternatives still matter                                                               |
| `linkwarden` | partial 85%                               | Remaining branch/budget uncertainty                                                                           |
| `copilotkit` | partial 99%, 16 sampled replay mismatches | Large state space and replay completeness                                                                     |
| `chatbot`    | capture available; static render hung     | Focus event/root-container cycle; old result retained                                                         |

The fresh-results worker attached runtime captures for these entries. Recover them before comparison; do not overwrite an old record merely because the new percentage is higher or lower.

### E-commerce/media branch: reported new entries

| Entry                       | Reported outcome                              |
| --------------------------- | --------------------------------------------- |
| `next-ecommerce-shopco`     | exact                                         |
| `react-shopping-cart`       | exact                                         |
| `netflix-ui`                | exact, Expo/RN Web + Reanimated transform     |
| `react-ecommerce-store`     | exact                                         |
| `fashion-cube`              | exact                                         |
| `react-movies`              | truncated, fetch/timer uncertainty            |
| `multimart-react-ecommerce` | truncated, react-slick state space            |
| `react-ecommerce-lydia`     | static-only; React 15 has no Fiber reconciler |

### Integration procedure for every branch

- [ ] Record parent tip, branch tip, common ancestor, and unmerged commits.
- [ ] Confirm what is already present under renamed helpers; do not reintroduce old implementations.
- [ ] Separate generic semantic changes, fixtures, package changes, and corpus-record changes for review.
- [ ] Check every changed existing test expectation against actual source/runtime evidence.
- [ ] Merge on an isolated integration branch/worktree first, preserving local work.
- [ ] Keep the current architecture where work overlaps; resolve behavior with regression tests.
- [ ] Regenerate lockfiles through pnpm, not manual lockfile surgery.
- [ ] Merge manifests by unique ID; do not rewrite all existing result records incidentally.
- [ ] Run complete parser validation and same-capture core replays.
- [ ] Refresh only justified corpus records using the runner.
- [ ] Recompute status counts; record newly exposed unsoundness without downgrading it to partial.
- [ ] Integrate serially, push validated checkpoints when appropriate, and update this ledger and PR description.

---

## 6. Workstream P0: evidence and reproducibility

**Why first:** old results, fresh captures, different installations, and unmerged code are currently being compared as if they were the same experiment.

### Tasks

- [ ] Inventory all locally available captures, checkouts, attachments, and completed worker branches.
- [ ] Recover Sentry and PostHog captures from the replay worker's final task; recover the SaaS refresh captures.
- [ ] Establish a corpus directory outside this monorepo.
- [ ] For each experiment record source revision, dependency installation/lockfile identity, analyzer SHA, React/renderer version, capture hash, route, input observations, setup steps, and relevant environment assumptions.
- [ ] Separate a saved-capture replay from a fresh live capture in result metadata and summaries.
- [ ] Identify historical records with no state-space or replay metadata; schedule them for rerun rather than filling in invented defaults.
- [ ] Keep baseline and candidate results in separate temporary output files during comparisons.
- [ ] Sanitize persisted observations and attachments; exclude credentials, personal data, and service secrets.
- [ ] Ensure corpus exit success does not substitute for inspecting `report.status`, omissions, failures, and replay mismatches.

### Acceptance

- The core regression set can be replayed on the same captures before and after a change.
- Every changed result can be reproduced from recorded inputs and setup, or is explicitly marked externally blocked.
- No report conflates old live validation with a fresh run on the new head.
- The 135 missing replay summaries are tracked as missing evidence, not counted as successful replays.

---

## 7. Workstream P1: effect-cause guards and reachable commits

**Highest-priority known soundness defect.**

### Original defect

`SymbolicCommit.guard` originally identified a commit without describing its scheduling cause. An effect under alternative A could schedule an update that the combined model also claimed under alternative B. Sentry's historical 9 corrected sampled mismatches motivated the work. The current identical-capture run has no Sentry contradiction; the broader lifecycle and task-isolation audit remains incomplete.

The fix must make the symbolic claim correct. Replacing an impossible state after replay is useful diagnostic recovery, not a substitute for modeling the cause.

### Source map

- `src/materialize/materializer.ts`: owner positions, component proxies, hook updates, effects, scheduling.
- `src/evaluate/hooks.ts`, `react-calls.ts`, `class-component.ts`: hook/class update semantics.
- `src/evaluate/root-render.ts`: path-journaled root renders.
- `src/harness/commit-recorder.ts`: commit capture.
- `src/render/static-renderer.ts` and `src/types.ts`: render result and lifecycle contracts.
- `src/harness/symbolic-tree.ts`: commit guards and symbolic inputs.
- `src/harness/enumerate-states.ts`, `state-space.ts`: derived states and membership.
- `src/harness/state-replay.ts`: assignment grouping and pinned replay.
- `src/harness/guard-coverage.ts`, `witness-plan.ts`: reachability/coverage over commit causes.

### Implementation plan

- [ ] Read React's effect traversal, hook dispatch, class lifecycle updates, root scheduling, and commit batching source for the tested React versions.
- [x] Add a failing fixture where A schedules `setState` in an effect and B does not. `effect-cause-commits.tsx` initially claimed 2 commits under B versus 1 replayed; now it passes without correction.
- [x] Identify an existing typed place to carry decision ancestry; avoid a second parallel condition representation. `GuardContext` combines the existing `Guard` algebra and `InputVariable` provenance in `MaterializeContext`.
- [ ] Capture the scheduling cause at the time of the update, not whichever branch happens to be active when React later flushes it.
- [x] Preserve transitive causes across the tested effect → update → effect chain. `effect-cause-chain.tsx` verifies layout-triggered state followed by a passive update: A has 3 commits, B has 1.
- [x] Define conjunction versus disjunction for nested causes and independently sufficient batched updates. Ancestry and transitive causes conjoin; independently sufficient scheduling causes disjoin. `effect-cause-batched.tsx` verifies equivalent pending updates retain both sufficient causes without another React render request. This does not yet isolate different state mutations across alternatives.
- [ ] Model no-op updates and eager bailouts without introducing spurious transitions.
- [ ] Carry cause guards through captured commits, symbolic serialization, cluster ownership, enumeration, matching, coverage, and replay.
- [ ] Preserve empty-tree/unmount commits where semantically relevant; audit filters that discard every empty pattern.
- [ ] Keep a fresh interpreter/module heap for each replay and stable decision identity across that replay.
- [ ] Add tests for passive/layout effects, class lifecycle updates, chained updates, batching, cleanup-triggered updates where supported, and multiple roots.
- [ ] Recheck StrictMode's repeated effect behavior without turning development-only repetition into invented production transitions.

### Acceptance

- Minimal fixture: A has two distinct committed trees, B has one; replay reports zero mismatches.
- Nested and transitive fixture causes are jointly satisfiable exactly where expected.
- An update scheduled by either of two independent causes remains reachable under either cause.
- Sentry's known overclaimed-commit mismatches reach zero, or each residual is isolated as a distinct genuine issue with a fixture and reason.
- PostHog, react-admin, Documenso, Cal DIY, Sonner, GraphiQL, and Lexical retain same-capture parity.
- Serialized symbolic tree and derived/replayed state views agree; there is no hidden replay-only correction to the public claim.

---

## 8. Workstream P2: replay soundness and completeness accounting

### Known defects and risks

- `form-builder` was reported to claim two commits while an independent render produced seven because the claim was built from a truncated enumeration prefix.
- `mantine-react-table` currently records 16 uncorrected mismatches while the entry remains `exact`.
- Corrected state arrays can diverge from the original tree/clusters: current `withCorrectedStates` preserves the original symbolic tree while replacing concrete states.
- A sampled assignment list must not be mistaken for the entire symbolic assignment space.
- Correct tree shape can still hide different causes; deduplicating identical trees must preserve the union of their conditions.
- A match outside the sampled state array still needs an honest replay-verification status.

### Tasks

- [ ] Reproduce each of the four exact-with-mismatch rows against its original capture before classification changes.
- [x] Define complete versus partial projected claims and report unresolved commit positions.
- [x] Derive replay claims from all symbolic commits under the pinned assignment, not only the first `states` entries.
- [x] Report incompletely derived claims as incomplete/unverified, not automatically success or contradiction.
- [x] Preserve proven contradictions in known regions of partial claims: prefixes, suffixes, and required nodes between unresolved regions.
- [ ] Distinguish replay not requested, replay unavailable, sample passed, sample incomplete, corrected contradiction, and unresolved contradiction in a small typed result contract.
- [x] Separate membership from bounded replay verification; optional fields retain legacy compatibility and report old verification as unrecorded.
- [ ] Audit reindexing, corrections, rematching, and identical-tree deduplication for condition loss.
- [x] Report open decisions/wildcards in replay evidence as incomplete; exact reproduction of a partial pattern does not claim a concrete replay.
- [ ] Test preferred matches beyond the materialized sample, multiple commits sharing decision names, repeat scopes, and branch IDs renamed across commits.
- [ ] Add a regression where the first sample matches perfectly but a different reachable assignment contradicts the combined render.
- [ ] Audit consumers of `stateCount`, `states.length`, `assignments`, `omitted`, and `isCorrected`; each must mean one thing.

### Acceptance

- No contradicted symbolic claim is advertised as globally verified because one runtime assignment matched.
- No omitted commit is misclassified as an impossible commit solely because it lies outside a sample.
- All corrections remain traceable; raw evidence is retained and the first-class tree is coherent with its derived views.
- Sampling and omitted work remain explicit in machine-readable and human-readable reports.

---

## 9. Workstream P3: guard solver, correlations, and compact symbolic output

Passing ordinary examples does not establish that the solver preserves all feasible states. Treat solver soundness and completeness as independently testable properties within its supported domain.

### Tasks

- [ ] Inventory the exact guard language and supported value domains.
- [ ] Test satisfiability and returned witnesses against direct JavaScript evaluation on finite generated domains.
- [ ] Test contradictions, negations, disjunctions, equality/in-set, truthiness, comparisons, and shared input paths.
- [ ] Audit numeric witness selection: narrow intervals, excluded midpoints, very large doubles, representable neighbors, signed zero, and relevant non-finite/NaN behavior. Do not use an incrementing loop that can stop making numeric progress.
- [ ] Audit whether comparison guards encode JavaScript coercion or only proven numeric comparisons; keep producer and solver semantics consistent.
- [ ] Audit relationships between `value`, `typeof`, `length`, and `choice` projections of one input.
- [ ] Keep list lengths nonnegative integers and correlate length tests with repeat cardinality.
- [ ] Ensure a solver limitation is not reported as `unreachable`. Introduce an explicit indeterminate outcome if the existing supported-domain contract cannot justify a decision.
- [ ] Preserve predicate identity through object/list construction, builtins, callback returns, state cells, contexts, and branch-local writes.
- [ ] Check branch guards form the intended alternatives without accidental overlap or lost cases; do not assume every join is a boolean two-way branch.
- [ ] Review the pending correlation branch's call derivations and path-sensitive changes against these invariants.
- [ ] Verify independent components are factored only when no heap/effect/input dependency connects them.
- [ ] Add deep, wide, repeated, and cyclic-value stress tests without forcing eager state expansion.

### Acceptance

- Every returned witness satisfies its guards under the documented semantics.
- No representable feasible assignment in generated finite-domain tests is rejected as unreachable.
- Correlated tests cannot choose inconsistent alternatives across siblings, depth, or commits.
- Independent guards scale with the sum of component work; full-state products remain lazy.
- Symbolic serialization round-trips without changing meaning or losing input provenance.

---

## 10. Workstream P4: generic interpreter completeness

Use real corpus divergences to discover missing semantics, then implement the **general operation** and validate it across programs. Avoid an endless list of app-specific patches.

### Coverage matrix to establish

| Family               | Audit / missing-coverage targets                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AST dispatch         | Every supported expression/statement form, unsupported syntax, decorators, TS erasure, module formats                                      |
| Primitive operations | Coercion, equality, relational comparisons, numeric edge cases, symbol/bigint boundaries, thrown conversions                               |
| Objects              | Descriptors, accessors, computed properties, own/inherited keys, spread, prototype identity, mutation through aliases                      |
| Lists                | Holes versus undefined, optional/repeat items, length/index writes, bounds, filter/map/reduce/slice/splice, unknown indices                |
| Iteration            | Iterator identity, iterator closing on abrupt completion, custom iterators, destructuring, spread, generators/yield                        |
| Functions            | bind/call/apply, constructors/new.target, receivers, closures, arguments, default/rest/destructured parameters                             |
| Escape analysis      | Bound callbacks, callbacks in containers, changing callback refs, recursion, native setters, per-argument mutations, path-specific effects |
| Control flow         | Loops, switch, return/break/continue, finally, thrown paths, deferred joins, mutually exclusive heap updates                               |
| Async                | Promise settlement/rejection, await, lazy imports, suspense, timers, cancellation, microtasks, unresolved async alternatives               |
| Modules              | Cycles, live bindings, CJS replacement exports, re-export ambiguity, environment-specific export conditions                                |
| React state          | Stable hook identity, reducers, external stores, context, use, eager bailout, effect dependencies, class lifecycles                        |

These are audit targets, not claims that every listed behavior is currently broken or absent.

### Tasks

- [ ] Build a concise coverage inventory tied to actual dispatch sites and tests, rather than a second implementation of the grammar.
- [ ] For each unsupported operation, check whether it propagates uncertainty, a modeled app throw, or an infrastructure error correctly.
- [ ] Extend bound-callback tests to destructured/default/rest parameters, spread call arguments, receivers, and bound containers where the current simple-name walker is insufficient.
- [ ] Prove escape memoization invalidates when dependencies change and terminates when they do not.
- [ ] Follow unknown values through pure native operations without silently concretizing them.
- [ ] Profile repeated work before introducing memoization; cache keys must include all semantic dependencies and invalidate on mutation/escape.
- [ ] Use differential tests for pure JavaScript semantics against native execution with concrete inputs.
- [ ] Use generated small programs/inputs for branch joins and aliasing to find interactions that handpicked fixtures miss.
- [ ] Convert every discovered real-corpus defect into a small permanent regression.

### Root-cause batches already identified

- Budget-heavy geometry or large tree construction: Excalidraw, react-arborist, OpenChakra and related entries.
- Unknown signal/store reads and lost correlation: tldraw, Flagsmith, Langfuse, Mini Dashboard.
- Repeat cardinality: Ant Design Pro, mdsilo-web, Sokuji, react-video-editor, reactive-trader, open-resume, react-virtuoso, pixel-art-react, compiler playground, Uxie, Noteworthy.
- Escaped setters: glide-data-grid, open-resume, pixel-art-react, react-video-editor, react-virtuoso, reactive-trader, Sokuji, Uxie.
- Opaque i18n/provider boundaries: Tolgee, i18next families, Plate, react-shadow, remaining Ant Design/MUI/Chakra internals.
- Boot/async state: Actual lazy fallback, Standard Notes initialization, TanStack route loading, Remix/i18next initialization.

### Acceptance

- Every closed gap has a before-failing/after-passing fixture and same-capture corpus evidence where available.
- New precision does not turn valid alternative behavior into false certainty.
- No generic helper is added solely to mimic one application's expected output.

---

## 11. Workstream P5: host realms, renderer ownership, and lifecycle cleanup

Renderer independence is partly an architectural property and partly empirical compatibility. A React Native realm table is not proof that React Native rendering works end to end.

### Tasks

- [ ] Regenerate/check ECMAScript, browser, Node, and React Native declaration realms; inventory every remaining declaration gap.
- [ ] Keep existence, member kinds, inheritance, event interfaces, and return interfaces declaration-derived where possible.
- [ ] Keep layout/rasterization and real external inputs explicitly uncertain when happy-dom cannot establish them.
- [ ] Audit document/global alias identity, expando writes, ownerDocument/getRootNode, cross-realm instanceof, and native-object ownership.
- [ ] Reproduce the chatbot `textarea.focus()` hang with a small document/body HostSingleton fixture.
- [ ] Read React DOM's container event walk and singleton ownership logic; fix root/container hosting generically, not by disabling all focus behavior.
- [ ] Test portals, multiple roots, document roots, iframe documents, event bubbling, and unmount under the chosen host setup.
- [ ] Reproduce react-email's iframe srcDoc/load/rAF settlement problem in isolation.
- [ ] Explicitly close windows, child frames, roots, subscriptions, observers, pending timers, and worker/message-channel resources after each replay.
- [ ] Measure retained heap across many sequential replays, not just peak RSS for one run.
- [ ] Review pending Expo/Metro/Reanimated transforms against the application's actual configured tooling.
- [ ] Define and test renderer/version support boundaries, including legacy React fallbacks. Do not claim reconciler-identical parity when using a different React version without qualification.
- [ ] Establish real native-renderer tests independently of RN Web tests; retain browser tests as a separate target.
- [ ] Keep React 15's lack of fibers explicit instead of pretending a Fiber comparison exists.

### Acceptance

- Root ownership and event dispatch terminate correctly in the minimal focus/singleton regression.
- Repeated renders/replays release resources and do not accumulate unbounded retained documents or listeners.
- Host platform selection never accidentally exposes the browser host in Node/native evaluation.
- Each claimed renderer/version combination has direct tests and an explicit fallback/unsupported policy.

---

## 12. Workstream P6: actionable witness execution

The existing `planWitnesses` produces assignments; the harness does not yet execute those plans end to end. This is necessary to turn symbolic possibilities into targeted empirical evidence rather than repeatedly capturing the default page.

### Tasks

- [ ] Define which input-source kinds can be installed controllably: routes, viewport/media, storage/cookies, environment/flags, network responses, query/store fixtures, clock/random where interception is faithful.
- [ ] Separate controllable inputs from unsupported or externally constrained inputs such as arbitrary database invariants.
- [ ] Validate assignment consistency across value/type/length/property projections before launching a browser.
- [ ] Install observations/input overrides before application initialization in isolated browser contexts.
- [ ] Preserve request identity and related-field constraints; do not synthesize internally inconsistent API responses just to hit a branch.
- [ ] Produce a recorded witness containing assignments, applied overrides, observed guards, capture identity, and comparison outcome.
- [ ] Verify the requested side was actually reached; browser startup success is not witness coverage.
- [ ] Add failures for unrealizable plans, uninstalled inputs, and timed-out actions without relabeling their sides unreachable.
- [ ] Run both sides of key core-app guards where controllable, including auth/loading/feature/layout branches.
- [ ] Keep greedy witness selection documented as a heuristic over candidate models, not a proof of globally minimal test count.

### Acceptance

- A small app's plan automatically drives both reachable sides in separate real runtime captures.
- Each capture is a member of the same symbolic model under its installed assignment.
- Unwitnessed sides remain visible; infeasible and unsupported installation attempts are distinguishable.
- Coverage claims state their assumptions and do not imply all products of guard sides were verified.

---

## 13. Workstream P7: transitions and stateful behavior

This follows sound commit modeling and replay. The current system is not yet a verified graph of states connected by actions and asynchronous events.

### Tasks

- [ ] Define a minimal transition contract over symbolic preconditions, action/settlement causes, and postconditions.
- [ ] Include explicit action arguments and input provenance; avoid opaque event IDs with no actionable meaning.
- [ ] Model supported user events, async settlements, timer progression/cancellation, and navigation as transitions with declared assumptions.
- [ ] Preserve order dependence and shared state; do not multiply transitions as if independent when they are not.
- [ ] Explore lazily with explicit frontier/omission reporting and stable replayable action sequences.
- [ ] Reuse interpreter, renderer, guard solver, and replay contracts; do not create a second execution engine.
- [ ] Verify minimal sequences in real applications: closed→open→closed, loading→success/error, input→validation, route changes, and cleanup/unmount.
- [ ] Add queries for why a node can appear, what input/action reaches it, and whether an invariant has a counterexample within the explored model.

### Acceptance

- Every explored transition can be independently replayed from its stated precondition.
- A failed or unexplored transition remains explicit, not silently removed.
- State/transition deduplication preserves guards and causes, including identical trees with different future behavior.
- Agent-facing queries return evidence and limitations with their answers.

---

## 14. Workstream P8: corpus refresh and expansion to 500

### Refresh before expanding blindly

- [ ] Re-run the core same-capture regression set on every semantic integration.
- [ ] Refresh the 135 runtime-metadata records lacking replay summaries.
- [ ] Re-run all historically exact entries; publish corrected counts even when they decrease.
- [ ] Triage all 7 mismatches and 7 unresolved entries as correctness/boot failures, not just low coverage.
- [ ] Classify all 8 truncated entries by real omission source: cardinality, alternative materialization, cluster budget, solver limitation, or renderer settlement.
- [ ] Group partial entries by the first generic missing semantic, not by repository name alone.
- [ ] Revisit 12 static-only entries; record whether they are environment-blocked, renderer-unsupported, or genuinely lack a Fiber runtime target.

### Expansion milestones

| Milestone     | Requirements                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Baseline 207  | Current records inventoried; known stale/missing evidence exposed                                                               |
| Candidate 215 | Review/integrate e-commerce/media wave; fresh same-capture regression validation                                                |
| 250           | Close high-priority soundness defects; maintain full provenance and replay accounting                                           |
| 350           | Broader React versions, framework families, UI libraries, editors, stores, async workflows                                      |
| 500           | 500 distinct pinned repositories in the inventory; separately report how many run live and how many meet each verification gate |

The goal is 500 real repositories, not 500 routes from the same repository. Static-only entries do not satisfy a 500-live-verification claim. Multiple routes/states within one app are valuable additional evidence and should be reported separately.

### Per-entry requirements

- [ ] Pinned repository/revision, application working directory, framework and React version.
- [ ] Reproducible install/setup/dev commands and route.
- [ ] Runtime capture from the real application, not from the materializer.
- [ ] Static symbolic output, observations/assumptions, strict comparison, omissions, coverage, replay outcome.
- [ ] Explanation for every remaining non-exact or unverified region.
- [ ] At least one additional targeted state witness when the app has controllable meaningful branches.
- [ ] Time/memory/resource-lifecycle measurements for expensive entries.
- [ ] Setup patches isolated to throwaway checkouts and documented; analyzer semantics remain app-independent.

### Orchestration rules

- Assign parallel work by root-cause family, with disjoint integration ownership where possible.
- Give workers exact base SHA, same captures, acceptance fixtures, and unchanged budgets.
- Require pushed branches and a before/after report; a message saying “done” is insufficient.
- Review source and revalidate before integration; never merge every worker's status changes wholesale.
- Stop conflicting duplicate work early; prefer adapting one shared helper to maintaining two.
- Do not restart the previously stopped remote sessions as a side effect of this plan. Any new remote execution must be explicitly authorized and tracked.

---

## 15. Workstream P9: quality, documentation, and release readiness

### Tasks

- [ ] Re-audit dependency direction after every large integration: parse/graph/value evaluation → materialization/render → framework/corpus, with shared harness contracts deliberately placed.
- [ ] Remove duplicate predicates, unreferenced exports, temporary probes, abandoned models, and obsolete compatibility paths only after checking tests/public exports.
- [ ] Audit handwritten host/library tables; replace derivable facts with generated declarations or real tooling, but keep irreducible behavior explicit.
- [ ] Review all broad catches and fallback-to-null paths for swallowed infrastructure failures.
- [ ] Review schema boundaries for malformed snapshots, realm tables, manifests, plugin outputs, and observations.
- [ ] Update README sections that still describe effects as no-ops or class setState as only unknown despite the current implementation.
- [ ] Align README, exhaustive-state documentation, result schemas, formatter language, and PR description with the actual exact/partial/truncated/unsound semantics.
- [ ] Add upgrade guidance for generated realms, React version models, build-tool transforms, and corpus captures.
- [ ] Document renderer support as tested combinations rather than a broad platform claim.
- [ ] Keep benchmark numbers diagnostic; enforce operation-count/resource-release regressions where stable.
- [ ] Recheck root build/typecheck/tests/CI before declaring the PR merge-ready.

### Acceptance

- One authoritative definition for each result/status/guard contract.
- No unexplained worker-only semantic duplicates or obsolete prose.
- Reproducible contributor workflow for adding a generic semantic plus its fixture and corpus evidence.
- Project checks and CI are green, or a truly external blocker is explicitly documented without misrepresenting readiness.

---

## 16. Validation runbook

Run from the repository root unless noted. Verify command behavior against package scripts rather than copying outdated worker commands.

### Fast semantic loop

```bash
pnpm --filter @bippy/parser test tests/evaluate.test.ts tests/escapes-bound-arguments.test.ts
pnpm --filter @bippy/parser typecheck
pnpm exec vp lint <changed-files>
pnpm exec vp fmt --check <changed-files>
git diff --check
```

### Complete parser validation

```bash
pnpm --filter @bippy/parser typecheck
pnpm --filter @bippy/parser check:realms
pnpm --filter @bippy/parser test
pnpm check
pnpm lint
git diff --check
```

On this macOS checkout, use the known canonical-temporary-path workaround when needed:

```bash
TMPDIR=/private/tmp pnpm --filter @bippy/parser test
```

When declaration generation changes, also run `pnpm --filter @bippy/parser generate:realms`, inspect the generated diff and gap reports, then rerun `check:realms`. Do not regenerate unrelated tables merely to create churn.

Run root `pnpm typecheck`, `pnpm test`, and the relevant build/E2E workflows for integration/release checkpoints. Parser-only success is not full-monorepo validation.

### Corpus commands

Choose an absolute corpus directory outside the checkout and an absolute temporary results path.

```bash
pnpm --filter @bippy/parser corpus --help
pnpm --filter @bippy/parser corpus --list
pnpm --filter @bippy/parser corpus \
  --install-only --corpus-dir "$CORPUS_DIR" sentry posthog react-admin documenso
pnpm --filter @bippy/parser corpus \
  --static-only --skip-install --corpus-dir "$CORPUS_DIR" \
  --results "$REPLAY_RESULTS" sentry posthog react-admin documenso
```

`--static-only` does not start servers or install dependencies; ensure the pinned checkouts and saved captures are present. Captures normally live at `$CORPUS_DIR/.out/<entry-id>.capture.json`. Use the live flow without `--static-only` when a fresh runtime witness is needed. Inspect generated reports even if the CLI exits zero.

### Core same-capture regression set

- `sonner`
- `react-router-templates`
- `documenso`
- `posthog`
- `sentry`
- `graphiql`
- `react-admin`
- `cal-diy`
- `lexical`
- `bulletproof-react`
- `tanstack-table`
- `epic-stack`

Expand with the directly affected root-cause family. A single core set cannot validate all libraries or renderers.

### Evidence required in each checkpoint

1. Analyzer/base/candidate SHAs and changed generic semantics.
2. Minimal regression fixture and before/after behavior.
3. Test/typecheck/lint/realm/build outcomes and any environment caveat.
4. Exact capture identity and source revision for corpus comparisons.
5. Status, strict matched fibers/text, branches/repeats/unknowns/opaque regions, symbolic states/clusters, omitted regions, and replay counts before/after.
6. Guard-side coverage changes and any newly exposed unsoundness.
7. Time/peak memory/retained-resource evidence for performance fixes.
8. Remaining issue, reason, next action, and whether it blocks a completion gate.

---

## 17. Completion gates

### Gate A: trustworthy symbolic claims

- [ ] Cause-sensitive commits are correct without post-hoc repair for known interference fixtures.
- [ ] Replay distinguishes contradiction from incomplete evidence.
- [ ] Symbolic tree, state view, matching, and replay corrections remain mutually consistent.
- [ ] Solver guarantees are tested within explicit supported domains; unknown is never mislabeled unreachable.
- [ ] No unsupported or omitted behavior is silently treated as complete.

### Gate B: broad semantic and renderer conformance

- [ ] Coverage inventory exists for AST, value, control-flow, module, hook/class, host, and async semantics.
- [ ] Differential/generated tests exercise interactions, not only isolated handpicked cases.
- [ ] Root ownership, portals, focus, iframes, multiple roots, and cleanup have regression coverage.
- [ ] Claimed React versions and renderers have direct evidence; fallback differences are explicit.

### Gate C: empirical verification

- [ ] Historical corpus records are refreshed or marked stale/blocked with reasons.
- [ ] No exact label is presented as whole-space verification when replay contradicts or leaves it unverified.
- [ ] Guard-driven witness plans are executed for supported controllable inputs.
- [ ] 500 distinct pinned repositories are inventoried; live verification and coverage totals are reported separately and honestly.
- [ ] Core exact baselines retain same-capture parity through integrations.

### Gate D: useful stateful analysis

- [ ] Supported actions/async transitions have cause guards and independent sequence replay.
- [ ] Agent-facing queries explain reachable UI and counterexamples with evidence and limitations.
- [ ] Exploration is lazy, bounded transparently, and does not expand every whole-state product eagerly.

### Gate E: maintainability and delivery

- [ ] Pending worker branches have been reviewed, integrated, rejected with reason, or superseded—not silently forgotten.
- [ ] No duplicate semantic implementations or temporary instrumentation remain.
- [ ] Documentation/status schemas match actual behavior.
- [ ] Complete project validation and relevant CI pass.
- [ ] Final progress report lists every remaining external limitation without claiming it is implemented.

A blocked item is not a checked item. If an external service, missing renderer, or fundamentally unbounded behavior prevents a gate, document the exact boundary and continue other independent work. Do not silently redefine “finished” around whatever happened to pass.

---

## 18. Recovery references and safe context handling

The prior implementation context was recovered from one parent conversation and 53 worker conversations using read-only requests. Redacted local material is available at:

- `/tmp/bippy-parser-recovered-context/continuation.md`
- `/tmp/bippy-parser-recovered-context/worker-handoffs.md`
- `/tmp/bippy-parser-recovered-context/index.json`
- Individual redacted transcript files in that directory.

These temporary files are supplemental and may disappear. This scratchpad intentionally preserves the essential requirements, progress, unresolved defects, branch tips, and acceptance criteria without storing credentials or copying private raw conversations into the project.

Useful source documentation:

- `AGENTS.md`
- `packages/bippy-analyzer/README.md`—partly stale; audit against code.
- `packages/bippy-analyzer/docs/exhaustive-states.md`
- `packages/bippy-analyzer/docs/tsc-graph-investigation.md`
- `packages/bippy-analyzer/corpus/manifest.json`
- `packages/bippy-analyzer/corpus/results.json`

Old worker claims that all guard sides must be witnessed for `exact` conflict with the current documented membership semantics. Do not inherit either wording accidentally: keep capture membership, model completeness, and empirical coverage separate, with an explicit contract and tests.

---

## 19. Execution log

### 2026-09-10: resumed locally

- Read PR #115 and inspected the checked-out implementation.
- Cloned React source and inspected bound callback usage in React internals.
- Fixed integer-radix inference and escaped bound-argument propagation; added regressions.
- Verified 720 parser tests, parser typecheck, targeted lint, formatting, and diff checks.
- Investigated Vite legacy hook ordering; retained the source-correct behavior.
- Paused further implementation to recover the user's previous design and worker context.
- Recovered 54 remote conversation records without modifying or restarting those sessions.
- Read the parent conversation, key soundness/correlation worker threads, and the full latest-worker handoff digest.
- Verified remote tips for pending correlation, refresh, e-commerce/media, budget, native-web, and parity branches.
- Recomputed baseline corpus counts and distinct repository count from checked-in JSON.
- Found 135 runtime-metadata records without replay summaries and four exact rows with recorded replay mismatches.
- Created this scratchpad. **No pending worker branch has been merged or freshly corpus-validated locally yet.**

### 2026-09-10: first effect-cause implementation and recovered captures

**Locally verified, not yet corpus-verified:**

- Checkpointed the review fixes/tests at `80b8f278` (`fix(parser): preserve bound escape arguments and inferred integer radix`). No push performed.
- Re-read React's effect invocation, hook dispatch/eager bailout, and commit-hook timing in `/tmp/bippy-parser-pr115-react`, including `ReactFiberCommitEffects.js`, `ReactFiberHooks.js`, and `ReactFiberWorkLoop.js`. DevTools observes a commit after layout effects and before later passive work; updates queued during layout must belong to the following render, not the commit being recorded.
- Added `src/materialize/commit-causes.ts`. Materialized branch ancestry and known repeat non-emptiness condition effect-triggered scheduling; effect chains preserve transitive conditions. Queued tasks/microtasks capture the scheduling context rather than inheriting an unrelated later commit's cause.
- Added optional `StaticRenderResult.commitCauses`, read them alongside snapshots with shared input identity, merged causes when equal patterns are deduplicated, and conjoined causes with commit selectors in the symbolic artifact.
- Seeded cluster enumeration and runtime matching with commit guards; coupled previously independent clusters when a disjunctive cause relates their inputs. Replay assignment membership checks causes even after the triggering branch disappears from the later tree.
- Found an independent solver defect during the initial regression: `truthy(value)` and `not(truthy(value))` were satisfiable via an unconstrained bigint placeholder. Added a contradiction check and regression. The pending correlation branch does not contain this fix.
- New fixtures: `effect-cause-{commits,chain,batched,unmount,timer}.tsx`. The original regression failed with claimed/replayed counts 2/1 under B. The batching regression initially failed 1/2 under the second sufficient cause. Both now pass without correction. `unmount` means the triggering component disappears, not a fully empty root commit.
- `effect-state-interference.tsx` no longer requires `isReplayCorrected`: its impossible cross-alternative update is excluded by the commit guard, and both assignments replay without mismatch. Other interference tests remain unchanged.
- Latest full local suite: **745 tests passed, 41 files**, `TMPDIR=/private/tmp pnpm --filter @bippy/parser test`. Parser typecheck, `check:realms`, changed-file lint, formatting, and `git diff --check` passed. Logs: `/tmp/bippy-cause-{full,typecheck,realms,lint}.log`.

**P1 remains incomplete.** Still audit interpreter-only conditionals inside callbacks, `sharesScope` alternatives materialized before their branch wrapper, per-iteration causes, refs/cleanup/class lifecycles/StrictMode/multiple roots, lane-specific batching and interrupted renders, empty-root commits, and isolation when alternatives apply different updates. Global commit existence guards alone cannot repair cross-alternative state contamination. P2's truncated-prefix claims and corrected-tree coherence remain unfixed.

**Read-only capture recovery:**

- Downloaded the two parent-supplied attachments using the documented authenticated GET attachment endpoint. No Devin session was modified or restarted; no credentials/transcripts were committed.
- Captures: `/tmp/bippy-parser-corpus/.out/{sentry,posthog}.capture.json`.
- Sentry capture revision: `a7b4a8a2a78a666418e527d812e81528147789da`; SHA-256 `14fa128fa1156bce8c66207c0b8a81215f1ecdd7a70d703dcedb4757fe71e71c`.
- PostHog capture revision: `09c5fbd37b2714276d4206debd3aeb253ce0e43a`; SHA-256 `84a7caf1ca570c40c61e0a57c1015ff7830054c9f63e85e0d108a26189077b69`.
- Both embedded revisions match the manifest pins. These are final runtime snapshots, not full captured commit histories.
- Pinned Sentry and PostHog installs and PostHog setup build completed successfully outside the monorepo. Install log: `/tmp/bippy-parser-corpus-install.log`.
- Created detached baseline worktree `/tmp/bippy-parser-pr115-baseline` at `80b8f278`, using symlinks to existing harness dependencies. Compare it to the effect-cause implementation on the **same recovered captures**, with separate results files. Checked-in corpus results are unchanged.

### 2026-09-10: ref/stub coverage and identical-capture results

- Extended causal scheduling to host refs and modeled library hook setters/effects/cleanup. Added `ref-cause-{commits,shared}.tsx`, a non-auto-run static fixture at `components/internal/ref-cause-identity.tsx`, and `stub-commit-causes.test.ts`.
- A first ref cache keyed by guard formulas changed callback identity when a predicate was regenerated. Its standalone regression produced 50 attachments and an unsettled-state diagnostic; caching by stable decision path instead preserves ref identity and now produces only the two expected commits. Aborted the one runaway local Sentry probe from that intermediate implementation; no Devin session was touched.
- Initial mount remains unconditional. For updates without tracked setters (including native retries), rendered component ancestry is unioned conservatively; read React's `retryTimedOutBoundary`/`resolveRetryWakeable` source. This is not lane-complete scheduling instrumentation.
- Guard-side coverage now unions repeated sides' reachability paths rather than retaining only the first occurrence, and reports a single commit's nontrivial cause. Added regressions for both.
- Identical-capture baseline `80b8f278`: Sentry **exact, 100% strict coverage, 9/16 sampled mismatches over 40 reported assignments**, 52 corrected states; PostHog **exact, 100%, 0/2 mismatches**, 6 states.
- Current implementation after stable refs, modeled hooks, and native-retry ancestry: Sentry **exact, 100%, still 9/16 mismatches over 40 assignments**. Several impossible claims shrink from 4 commits to 2, versus 1 replayed, but the residual remains real. PostHog **exact, 100%, 0/2 mismatches**, 4 states. Do not present this as Sentry soundness completion.
- Results are separate external files: `/tmp/bippy-parser-corpus/{baseline,current}-results.json`. Logs include `/tmp/bippy-parser-corpus-baseline.log`, `/tmp/bippy-parser-posthog-baseline.log`, and `/tmp/bippy-parser-corpus-current-{stable-refs,stub-hooks,retry}.log`. Checked-in corpus results remain unchanged.
- A read-only/ad-hoc local inspection saved `/tmp/bippy-sentry-render.json`, `/tmp/bippy-sentry-{claimed,replayed}-*.txt`, and `/tmp/bippy-inspect-sentry-trace.log`. The all-false assignment claims a late tree with populated portals while its replay has none. Its early initial trees are identical. A later unconditional state update exposes mutations from the combined run's other alternatives: **commit existence guards alone do not condition persisted cell values or the heap**.
- The inspection helper `/tmp/bippy-inspect-sentry.mts` temporarily wraps methods in its own process to print scheduling guards; it does not modify checked-in source. Its first run had produced artifacts but retained native handles and reached the command timeout; the subsequent run explicitly exits after saving results.

### 2026-09-11: guarded mutations and partial N-way integration

- Initial commit-cause work is checkpointed locally at `608d38ab`; nothing pushed.
- Reused `Interpreter.runMaybe()` and `HeapJournal` for mutations in effects/refs under their active cause. A frame's own pending updates are excluded from that outer journal when its existence implies the callback cause; nested conditional journals still apply. Pinned replay no longer reintroduces the unresolved cause of its chosen alternative.
- Added `effect-cause-persisted{,-store,-reducer}.tsx`. They cover a conditional mutation observed after an unrelated unconditional timer render, including sequential reducer updates. Added direct journal tests for local exclusions and nested forks, and an assignment-join regression retaining an earlier branch with no compatible later state.
- Replay joining now checks combined decision guards and the candidate commit's cause before treating it as an extension. It does not pin decisions inside an unreachable later commit. Guards are collected once per commit-state rather than repeatedly traversing all trees for every merge.
- Validation before N-way integration: **746 tests / 41 files** passed (`/tmp/bippy-persisted-full.log`); subsequent store fixture and targeted replay checks passed. During N-way integration: typecheck and **325 tests / 5 files** passed, then **20 targeted tests** including the new journal/reducer/join cases. Full final validation is pending.
- Corrected the apparent PostHog hang diagnosis: initial rendering completes in 28.8 seconds; measured individual pinned renders take 27–30 seconds. The expanded assignment space increases the sampled workload from two to sixteen renders. The first silent run was stopped before completion; a fresh run completed. Local sample/profile artifacts are under `/tmp/bippy-posthog-*`; no remote session was touched.
- Guarded-heap-only same-capture results: Sentry still **9/16 mismatches over 40 assignments**; PostHog is now **truncated, 15/16 mismatches over 256 reported assignments**, 62 corrected states, 12 omissions. PostHog's result is `/tmp/bippy-parser-corpus/guarded-heap-results.json`; it is a regression, not a validated improvement. Model diff before N-way changes: `/tmp/bippy-guarded-heap-before-nway.patch`, SHA-256 `dce81db8d490d3d3c00fa56659b49b443410ed7172e9b85653b04bf898c22ea8`.
- Sentry cell/guard tracing shows causal predicates lost when state branches flatten beyond two alternatives. Started integrating only N-way predicate/schema/composition and mapped-origin preservation from `origin/devin/1789014494-corpus-parity-guards` (`5438a8e9`), adapting to current commit causes and accepting legacy serialized predicates without the new field. This is a partial source integration, not a merge or acceptance of the whole worker branch.
- Do not blindly take that branch's opaque-call derivation: identical literal arguments do not prove an opaque function is deterministic. Its other semantic/corpus changes still need independent review.
- First N-way flattening run: Sentry remained **exact membership but 11/16 mismatches over 38 reported assignments**, 42 corrected states. PostHog completed in 1,221 seconds, still **truncated with 15/16 mismatches over 256 assignments**, 62 corrected states. Artifacts: `/tmp/bippy-parser-corpus-nway-flattening.log` and separate `nway-flattening-results.json`. Flattening alone did not solve the contradiction.

### 2026-09-11: native identity, collection guards, and guarded reads

- Located Sentry's spurious conditions at `slot.tsx:239` and `:304`: React's modeled dispatch was treated as possibly equal to an application-defined no-op. Modeled native functions cannot be the program's own allocations; native round-trip stand-ins preserve actual aliases separately. Extended the existing intrinsic-versus-program identity rule. `setter-identity.tsx` fails before and passes after, with dispatch alias stability and an observable state update.
- Extended `JournaledState.join` to receive predicates, preserving them in root renders and collection joins. Collection entries now carry guarded presence as well as guarded values. Projection remains a list of independently optional entries, not a Cartesian product. Optional values carry predicates through mapping, spreading, materialization, and loop callbacks; bounded scalar length evaluation preserves their guards where possible. Existing caller shapes remain accepted through optional/defaulted fields.
- `effect-cause-persisted-map.tsx` failed before and passes after for conditional Map `get`, `has`, `size`, and iteration observed after an unconditional timer render.
- Guarding mutations is not enough: reads inside a component/callback must also respect the cause under which it runs. `CommitCauses` now delegates its full active cause to a scoped interpreter guard. Expression results discard incompatible branch alternatives when a feasible subset remains. The prior guard is restored afterward; captured tasks replace, rather than inherit, unrelated ambient causes. Materialization skips alternatives whose ancestry is proven contradictory.
- `effect-cause-guarded-store-read.tsx` exposed an impossible missing-registry read under the very condition that registered it. Its combined render claimed `1` missing read under B versus replay's `0`; the scoped read fix passes without corrections.
- Test construction caveat: a single scalar host child may not produce a HostText fiber. These regressions use mixed text children for observable values. Audit optimized host text/props comparison separately; passing fiber-only checks does not prove all displayed text or props.
- Added direct N-way predicate and legacy serialization tests while retaining the existing negation/refinement/cycle tests.
- Full parser validation passed **756 tests / 42 files** (`/tmp/bippy-guarded-checkpoint-full.log`), plus typecheck, changed-file lint, realm generation check, formatting, and diff checks. A final added regression covers unreachable-commit decision pins; its before-fix run produced a duplicate B assignment. Final checkpoint validation passed **757 tests / 42 files**, typecheck, and lint (`/tmp/bippy-guarded-checkpoint-final.log`). No root-monorepo acceptance run yet.
- **Latest same-capture results:** Sentry **exact membership, 100% strict, 0/1 replay mismatches**, 5 states; PostHog **exact membership, 100% strict, 0/2 replay mismatches**, 4 states. Artifacts: `/tmp/bippy-parser-corpus/guarded-reads-results.json`, `/tmp/bippy-parser-corpus-guarded-reads.log`. Compared with baseline's Sentry 9/16 of 40 and PostHog 0/2, the spurious Sentry decisions are gone and PostHog's guarded-heap regression is repaired. Checked-in historical corpus results remain unchanged.
- Timing remains an open issue: the latest PostHog run took 213.8 seconds versus baseline 104.0 and cause-only 87.9. Individual runs finish; profiles identify repeated predicate parsing/serialization and composition as major costs. No budgets were raised. Sentry improved from baseline 64.9 seconds to 13.9 seconds.
- These captures contain final runtime snapshots, not independent complete commit histories. The successful replay assignments are not evidence that unmodeled event sequences, lanes, cleanup, or every guard side were witnessed. The full correlation worker branch is still unmerged; only the reviewed N-way subset is integrated.

### Next execution entry

Checkpoint after final validation, optimize measured predicate-processing overhead without semantic changes, and continue P1's queued mutation/lazy-state and lifecycle audits. Then address P2's truncated-prefix claims, corrected-tree coherence, and optimized host text coverage; review remaining worker changes and proceed through the acceptance gates.

---

### Predicate-resolution cache checkpoint (2026-09-11)

- Guarded heap/read/N-way work is committed locally at `c3b76b75`; its final suite passed 757 tests.
- Added a weakly owned, per-branch cache for resolved alternative guards. Predicate changes and alternative-count changes invalidate it; resolved arrays are exposed read-only. No global string cache or analysis-budget change.
- Cache validation passed **758 tests / 42 files**, typecheck, and lint (`/tmp/bippy-predicate-cache-full.log`).
- The same pinned captures still pass: Sentry **0/1** replay mismatches, 5 states, 100% strict coverage, **13.299 seconds**; PostHog **0/2**, 4 states, 100%, **165.015 seconds**. Results: `/tmp/bippy-parser-corpus/predicate-cache-results.json`; log: `/tmp/bippy-parser-corpus-predicate-cache.log`. This also rechecks the final guarded-context replacement and unreachable-commit pin fix against those captures.
- A separate PostHog probe measured **52.6 seconds** each for rendering and the selected replay, versus about 69 seconds before caching. Overall corpus time improved about 23%, but remains above the 104-second baseline.
- The recovered transcripts expose no original capture attachments for mantine-admin, form-builder, or mantine-react-table. Their historical replay rows have not yet been independently reproduced here; new captures must not be labeled identical to those originals.

### Symbolic replay claims and incomplete evidence (2026-09-11)

- Reproduced the truncated-prefix defect with the real `effect-cause-chain.tsx` fixture: a one-state materialization falsely contradicted its later commits. Claims now project all committed patterns through the actual scoped pins, respecting commit causes; enumeration budgets are unchanged.
- Added regressions for repeat-scoped projection, unselected later decisions, undecided commit causes, partial claims with known contradictions, unknown replay regions, known suffixes and interior required nodes, identical partial-pattern reproduction, and zero replay budgets. Zero previously forced a preferred replay despite the budget.
- The partial comparison preserves proven differences rather than accepting unknown regions as matches. It uses deterministic prefixes/suffixes and necessary known-node subsequences; ambiguous regions stay unverified. It does not introduce a new exhaustive matcher or raise budgets.
- Added optional `incomplete` and `verification` replay fields, schema round-trip/legacy tests, and human-readable reporting. Verification is `not-replayed`, `sample-passed`, `sample-incomplete`, or `contradicted`; a corrected counterexample still contradicts the original model. Legacy verification is unrecorded. Separate unavailable/not-requested call-site accounting remains open.
- Corrected state arrays still retain the original tree/clusters. This remaining incoherence is now documented, not treated as a repaired primary model. Preferred matches beyond the enumerated sample, assignment-space completeness, condition-preserving correction/deduplication, and retained raw replay artifacts remain open.
- Partial comparison exposed why `hasPatternDecisions()` includes wildcards. A naive concrete-only reproduction check regressed three existing fixtures; exact reproduction of the same partial pattern is retained while its verification remains incomplete. The deliberately uncertain new fixture lives in `components/internal/`; no general fixture coverage threshold was lowered.
- Original captures for mantine-admin, form-builder and mantine-react-table remain unavailable in the recovered attachments. Generic reproductions do not establish those historical rows are repaired; no checked-in corpus results were changed.
- Root `pnpm typecheck` and `pnpm build` pass. Parser has no build script. Realm checks, changed-file lint/formatting, and diff checks pass.
- Root tests pass **2,816 / 2,818**, with the two existing pre/post DevTools tests explicitly skipped for React >=19. Parser contributes **770 passing tests / 42 files**. Structured evidence: `/tmp/bippy-replay-claim-root-results.json`; log: `/tmp/bippy-replay-claim-root-json.log`. Localhost:3000 connection warnings did not fail tests (exit 0).
- `/tmp/bippy-parser-corpus/replay-claim-final-results.json`: Sentry **13.479 seconds**, `sample-passed`, **0/1** mismatches; PostHog **166.809 seconds**, `sample-incomplete`, **0/2** mismatches and **one incomplete replay**. Both remain exact capture members with 100% strict coverage. PostHog's inconclusive assignment selects `index.tsx:44`'s absent `#root` container; its replay is not concrete. Do not silently turn that fallback into a proven empty React tree.
- Completed checkpoint corpus recheck: `/tmp/bippy-parser-corpus/replay-claim-checkpoint-results.json`, log `/tmp/bippy-parser-corpus-replay-claim-checkpoint.log`. Sentry **13.586 seconds**, `sample-passed`, 0 mismatches; PostHog **166.084 seconds**, `sample-incomplete`, 0 mismatches and one incomplete replay. Final legacy-report formatting/schema checks passed 30 focused tests (`/tmp/bippy-replay-final-focused.log`).
- Follow-up P1 audit confirmed the unguarded timer-cancellation defect; see the next entry. Conditional task creation, callback-local guards, and captured lexical-scope journaling remain separate audit targets.

### Guarded timer cancellation (2026-09-11, continued)

- Confirmed a real contradiction: a conditional child's layout effect cancelled a parent timer in every symbolic world. `/tmp/bippy-timer-cancellation-before.log` records the failure against independently pinned React replays.
- Timer cancellation now uses lazily initialized journaled boolean state. Multiple sufficient cancellations retain their predicates. Timeout and interval callbacks run under the remaining activation guard, with callback writes journaled; interval ticks recheck cancellation in their active world.
- Task conditions conjoin the captured task cause, not an unrelated intervening commit. Tasks with proven-impossible causes do not execute.
- Added timeout (two independent cancellers), self-clearing interval, journal restoration, unconditional cancellation, and task-cause regressions. **776 tests / 43 parser files pass** (`/tmp/bippy-timer-final-full.log`); root typecheck and realm checks passed before the final impossible-task pruning, with parser typecheck and lint afterward.
- Identical-capture timer run: `/tmp/bippy-parser-corpus/timer-cancellation-results.json`; both captures still match with 100% strict coverage and no contradictions. Sentry remains `sample-passed`; PostHog retains its one incomplete missing-container path. This run preceded the final impossible-task pruning; final checkpoint recheck remains due.
- Still open: task creation/promise queues are not fully journaled; callback-internal branch causes and lexical variables captured from other scopes need independent regressions. Timer argument forwarding and callback-specific host arguments also need audit.

### Guarded timer registration and task-only replay constraints (2026-09-11)

- Reproduced a second defect in `effect-cause-timer-registration.tsx`: an effect registered a timer only when a canvas context existed, but the model also produced the timer's update without a context. `/tmp/bippy-task-registration-before.log` records the impossible `<aside>` plus `<strong>` state.
- Handle creation now journals activation. A handle starts inactive outside its creation path, then becomes active on that path. This preserves registration and cancellation conditions through the same journaled state. Added direct state-space checks and queue tests for conditional creation and discarded paths.
- The corrected model exposed a replay defect: the missing-context pin still allowed the conditional timer to run. Materialization now records applicable pinned input guards as task assumptions. Task checks use those assumptions when callbacks run. Synthetic choices and repeat-local inputs do not become global assumptions.
- An intermediate attempt also narrowed ordinary render values. Bippy's commit records showed a branch marker disappearing and remounting `Trigger` in `effect-cause-guarded-store-read.tsx`. Restricted the assumptions to task checks; the marker structure and existing regression now pass unchanged. Diagnostic records: `/tmp/bippy-inspect-task-replay.log`, `/tmp/bippy-task-replay-*.json`, `/tmp/bippy-task-original.json`. The standalone probe must import Bippy's hook installer before React to capture renderer registration.
- Full root validation: **2,827 passed, 2 existing skips**; **781 parser tests / 44 files**. Root typecheck/build, realm checks, changed-file lint/formatting and diff checks pass. Logs: `/tmp/bippy-task-registration-root-{tests,typecheck}.log`, `/tmp/bippy-task-registration-{build,realms}.log`. The earlier standalone parser run had 779 tests before the last two queue/task unit tests.
- Identical-capture verification: Sentry remains exact with 100% strict coverage, 0/1 contradictions, `sample-passed`. PostHog remains exact with 100% strict coverage, 0/2 contradictions, one incomplete replay, `sample-incomplete`. Results: `/tmp/bippy-parser-corpus/task-registration-serial-results.json`; checked-in corpus results unchanged.
- Performance is not resolved. The initial overlapping run took 37.862 seconds for Sentry and 664.402 seconds for PostHog. A serial recheck took **36.416 seconds and 253.074 seconds**, respectively, versus 13.586 and 166.084 at the earlier replay-claim checkpoint. A profiled PostHog probe took 83.3 seconds to render and 79.2 seconds for its selected replay. Its CPU sample still concentrates on predicate/guard processing. Timer initialization currently records an allocation-zero mutation; its effect on progress detection needs a separate test, not an assumed optimization.
- Profiling artifacts: `/tmp/bippy-posthog-registration-profile.{log,json}`. Serial corpus log: `/tmp/bippy-parser-corpus-task-registration-serial.log`. The probe and validation jobs completed.
- Next audit targets: conditional microtask/promise registration, cancellation through a branched handle, timer callback arguments, lexical-scope ownership, and repeat-scoped task constraints. None of those broader guarantees follows from these timer tests.

### Conditional microtasks and queue activation checkpoint

- Reproduced the same impossible `<aside>` plus `<strong>` state through a conditional `queueMicrotask` call. `/tmp/bippy-microtask-registration-before.log` records the failure.
- Direct `queueMicrotask` calls now use journaled activation and the existing conditional task runner. A shared scheduled-callback wrapper preserves deferred invocation semantics for both timers and direct microtasks. The new component fixture passes Bippy capture comparison and pinned replay without correction.
- Moved activation to actual queue registration. Merely allocating a handle no longer records a queue mutation. This removes a spurious progress signal for unscheduled handles without disabling mutation tracking for queued work. `/tmp/bippy-unscheduled-handle-before.log` records the before-fix unit failure. Added discarded-path microtask coverage.
- Full root tests pass **2,831 tests**, with two existing skips, including **785 parser tests / 44 files**. Root typecheck/build, realm checks, changed-file lint/formatting, and diff checks pass. Logs: `/tmp/bippy-microtask-activation-root-{tests,typecheck}.log`, `/tmp/bippy-microtask-activation-{build,realms}.log`.
- The identical-capture corpus check ran after the root tests, not concurrently. `/tmp/bippy-parser-corpus/microtask-activation-results.json` and `/tmp/bippy-parser-corpus-microtask-activation.log` record the completed run. Sentry is exact, 100% strict, 0/1 contradictions, `sample-passed`, at **38.282 seconds**. PostHog is exact, 100% strict, 0/2 contradictions, one incomplete replay, `sample-incomplete`, at **256.770 seconds**. Queue activation cleanup did not remove the measured performance regression.
- Promise reaction registration remains unguarded, including pending subscriptions and conditional settlement. `PromiseTools.queueMicrotask` does not use the new direct-call wrapper. Captured lexical-scope ownership and cancellation through branched handles remain open.

### Timer callback arguments checkpoint

- Bippy's independent application capture exposed dropped callback arguments in `setTimeout` and `setInterval`. `/tmp/bippy-timer-callback-arguments-before.log` records a runtime text mismatch even though the internal replay sample passed. This is a direct example of a shared interpreter error that replay cannot detect.
- Scheduled callbacks and interval ticks now receive the arguments after the delay. The fixture also checks that bound callback arguments precede timer-supplied arguments. Focused capture comparison and replay pass; parser typecheck, lint, formatting, and diff checks pass.
- The full root suite passes **2,832 tests**, with two existing skips, including **786 parser tests / 44 files**. Root typecheck/build, realm checks, lint, formatting and diff checks pass. Logs: `/tmp/bippy-timer-callback-arguments-root-{tests,typecheck}.log`, `/tmp/bippy-timer-callback-arguments-{build,realms}.log`.
- The completed serial capture check retains exact membership, 100% strict coverage, and zero replay contradictions for both apps. Sentry is `sample-passed`; PostHog retains one incomplete replay and is `sample-incomplete`. Results: `/tmp/bippy-parser-corpus/timer-callback-arguments-results.json`; log: `/tmp/bippy-parser-corpus-timer-callback-arguments.log`.
- Timings remain a concern: Sentry took 35.091 seconds; PostHog took 988.848 seconds in this run. Diagnostic counts and reported state counts remain unchanged. The cause of this larger time has not been established, so do not attribute it to callback arguments or system load without a controlled comparison.
- `setImmediate` argument offsets and animation/idle callback host arguments remain outside this repair.

### Timer handle identity and guarded selection checkpoint

- `timer-handle-alternatives.tsx` schedules two timers, then cancels one with a conditional expression. Before the repair, branch merging collapsed the handles because both had the same numeric range. This cancelled the first timer on both paths and omitted the second valid outcome. Evidence: `/tmp/bippy-timer-handle-alternatives-before.log`.
- Timer handles now carry resource identity separately from their numeric range. Branch merging and update equivalence preserve distinct identities. Cancellation resolves copied abstract values through the same identity. Two unit regressions failed before the change: `/tmp/bippy-timer-handle-identity-before.log`.
- Identity alone was insufficient: cancellation also needed to distribute over the alternatives under their guards. `/tmp/bippy-timer-handle-identity-only.log` preserves that intermediate failure. The builtin now uses the interpreter's existing journaled alternative runner. The primary model has exactly four states, including both valid completion outcomes and no state in which both timers fire.
- Reviewed React's existing checkout at `82c44beb`: `Scheduler.js` assigns task IDs, cancels task callbacks by reference, and retains the host timeout handle for `cancelHostTimeout`. Bippy remains the recorder for the fixture's real React commits and the independent application capture.
- Validation: **790 parser tests / 44 files**, **2,836 root tests**, two existing skips. Root typecheck/build, realms, changed-file lint/formatting, diff checks, and architecture checks pass. The documentation checker validates 32 links, two TSX examples, four server renders and two client effect updates. Logs: `/tmp/bippy-timer-handle-alternatives-{full,typecheck}.log`, `/tmp/bippy-timer-handles-{root-tests,root-typecheck,root-build,realms,docs}.log`.
- Identical saved captures retain exact membership, 100% strict coverage and zero replay contradictions. Sentry takes 25.997 seconds and is `sample-passed`. PostHog takes 182.069 seconds and remains `sample-incomplete` with one nonconcrete replay. Results: `/tmp/bippy-parser-corpus/timer-handle-alternatives-results.json`. This does not establish whole-space soundness or resolve performance variability.
- Numeric transformations of handles and promise reaction registration remain unaudited. A follow-up probe also shows that clearing `0` and `undefined` records two internal queue mutations despite scheduling no work: `/tmp/bippy-invalid-timer-cancellation-probe.log`. That no-op/progress issue is not fixed by this checkpoint.

### Promise registration, settlement and task-write checkpoint

- Cancelling an unregistered handle no longer creates a queue mutation. `/tmp/bippy-absent-timer-before.log` records the failing progress-accounting regression. This does not resolve numeric coercion/aliasing of timer IDs or completed-handle lifetime accounting.
- Reproduced conditional `.then()` registration on both settled and pending promises. The original model admitted `aside + strong` even when that path did not subscribe. Evidence: `/tmp/bippy-promise-registration-before.log` and `/tmp/bippy-pending-promise-registration-before.log`.
- Interpreter-backed promise microtasks now use journaled activation. Pending subscriptions bind a continuation when registered, not only when queued. Continuations conjoin registration and execution causes and retain input provenance. A unit test checks both conjunction directions with the solver and rejects an impossible invocation.
- Reproduced a later `.then()` observing settlement from an incompatible path: `/tmp/bippy-promise-settlement-before.log`. `ModeledPromise` now journals its state, retaining pending, settled and escaped alternatives with their guards. Subscriptions visit these alternatives under their causes. Pending reactions remain available for other paths instead of being removed by one path's settlement.
- `Promise.all` also had a native counter shared across mutually exclusive executions. `/tmp/bippy-promise-all-before.log` records missing completion on the second path, including Bippy's independent capture mismatch. Each input reaction now has journaled completion state instead of a shared integer counter. The duplicate-input regression checks both outcomes and their correlation.
- An independent capture exposed another shared-interpreter defect: `Promise.all([Promise.resolve(...)])` ran its handler before a subsequently queued microtask. Internal replay still passed. `/tmp/bippy-promise-all-order-before.log` records the wrong `all,microtask` order versus the application's `microtask,all`. Input reaction completion now preserves the required microtask turn.
- Feasible tasks also need guarded writes. A conditional component's timer previously changed a shared map on the path where that component did not mount. Temporarily disabling the new full-cause write journal reproduced it in `/tmp/bippy-task-store-before.log`; restoring it passes `/tmp/bippy-task-store-after.log`. The temporary change was restored. `/tmp/bippy-promise-before-task-write-check.patch` preserves the prior tracked diff.
- Validation: **803 parser tests / 44 files**, **2,849 root tests**, two existing skips. Root typecheck/build, realms, changed-file lint/formatting and diff checks pass. Architecture checks validate **33 links**, two TSX examples, four server renders and two client effect updates. Logs: `/tmp/bippy-promise-checkpoint-{typecheck,tests,build,realms,docs}.log`. Earlier intermediate runs passed 793 and 798 parser tests; an order-sensitive conjunction assertion was corrected to compare logical equivalence, not serialized term order.
- Identical captures remain exact with 100% strict coverage and zero replay contradictions. Sentry: **28.480 s**, `sample-passed`. PostHog: **188.288 s**, `sample-incomplete`, one nonconcrete replay. Results: `/tmp/bippy-parser-corpus/promise-checkpoint-results.json`; log: `/tmp/bippy-parser-corpus-promise-checkpoint.log`. Checked-in corpus results remain unchanged.
- Remaining promise work includes first-resolution locking during adoption, self-resolution, thenable assimilation, `finally` ordering, condition-aware suspension/wakeable ownership, escaped/widened state evidence, and reaction lifetime. Captured lexical scopes outside the registration scope remain a separate P1 audit. This checkpoint does not complete P1/P2 or the overall gate.

### Promise adoption and finally checkpoint

- Bippy's independent capture exposed three more defects: later resolution calls overrode adoption of a pending promise, `finally` did not wait for cleanup, and self-resolution stayed pending instead of rejecting with `TypeError`. The original replay samples passed despite those mismatches. Evidence: `/tmp/bippy-promise-adoption-finally-before.log` and `/tmp/bippy-promise-self-before.log`.
- A journaled following state now locks the first resolution on its path. Only the adopted promise's forwarding reaction can complete that state. Conditional adoption retains its own guard and does not suppress rejection on the other path.
- Adoption also needed a separate microtask. `/tmp/bippy-promise-adoption-order-before.log` records the model's `first,adopted,second` versus the application's `first,second,adopted`. Adoption now queues the subscription job. `finally` forwards the original outcome only after the cleanup result resolves, while propagating cleanup failure.
- Validation passes **809 parser tests / 44 files**, **2,855 root tests**, two existing skips. Root typecheck/build, realms, changed-file lint/formatting and diff checks pass. Logs: `/tmp/bippy-promise-adoption-root-{typecheck,tests}.log`, `/tmp/bippy-promise-adoption-{build,realms}.log`. The final architecture check also passes: 33 links, two TSX examples, four server renders and two effect updates, in `/tmp/bippy-promise-adoption-docs.log`.
- Identical Sentry/PostHog captures remain exact with 100% strict coverage and zero replay contradictions. Sentry takes **29.123 s**, `sample-passed`; PostHog takes **182.968 s**, `sample-incomplete`, with the same nonconcrete replay. Results: `/tmp/bippy-parser-corpus/promise-adoption-results.json`.
- The two fresh expansion captures were also replayed unchanged: `react-ecommerce-store` stays exact/100% strict/`sample-passed`; `react-shopping-cart` stays partial/**7.75% strict**/`sample-incomplete`. The latter has 89 states, 16/44 sampled assignments, zero contradictions and 15 incomplete samples. Separate results: `/tmp/bippy-parser-expansion/promise-adoption-results.json`.
- Thenable assimilation, resolver arguments that branch between promises and values, custom constructors, escaped/widened state evidence, suspension ownership and reaction lifetime remain open. This is not complete promise support.

### CRA macro and bundled compiler checkpoint

- Replaced opaque CRA macro imports with the application's installed `babel-plugin-macros` transform. The loader follows `react-scripts` to `babel-preset-react-app` for the plugin and uses `react-scripts`' own Babel core. A top-level dependency with the same name must not override the tool's dependency. Preset metadata gates activation. This is not the complete CRA Babel preset.
- The source transform runs only under the CRA `src` directory. Macro configuration and infrastructure execute normally; application bodies remain interpreted. It restores the process directory, environment and DOM-only globals on success and failure. The fixture uses real Babel/macros packages with mocked CRA package metadata and tests that an application-body global write does not run natively.
- The initial implementation missed symlinked dev directories, including `/tmp` versus `/private/tmp`. The regression in `/tmp/bippy-cra-macros-symlink-before.log` fails before canonicalizing that directory. This was a parser path defect, not an application repair.
- The unchanged shopping-cart capture improves from partial/**7.75% strict**, 89 states and 15 incomplete replay samples to **exact/100% strict**, 3 states and one passing replay. Its 530 runtime fibers now match a 530-fiber model with no opaque or wildcard nodes. Evidence: `/tmp/bippy-expansion-macros-canonical.log` and `/tmp/bippy-parser-expansion/macros-final-results.json`.
- Adding the direct test dependency with pnpm refreshed peer links to Vite Plus. Full tests then exposed a preexisting version assumption: its package version `0.3.1` was treated as the Vite engine version, despite `bundledVersions.vite` and the runtime export both reporting `8.2.2`. This broke independent asset-URL comparison in `vite-asset-queries` while internal replay still passed. Failure: `/tmp/bippy-macros-root-tests.log`.
- Package identity now retains its own version and optional bundled-version metadata. Version-dependent asset URLs and compiler selection use the declared bundled engine version. Regressions cover exposed and hidden package manifests, dependency-chain ownership and the unchanged asset fixture. Before logs: `/tmp/bippy-bundled-vite-{before,hidden-before}.log`; focused after log: `/tmp/bippy-macros-and-vite-focused.log`. React's `ReactJSXElement.js` confirms that these asset values become string fiber keys.
- Root validation now passes **2,863 tests**, with two existing skips; this includes **817 parser tests / 46 files**. Root typecheck/build and realms pass. Logs: `/tmp/bippy-macros-final-root-{typecheck,tests,build}.log` and `/tmp/bippy-macros-final-realms.log`. The architecture check passes 36 links, two TSX examples, four server renders and two effect updates in `/tmp/bippy-macros-docs.log`.
- Final identical-capture checks remain exact/100% strict with zero contradictions: Sentry **28.441 s**, one passing replay; PostHog **179.821 s**, two replays with one incomplete. Results: `/tmp/bippy-parser-corpus/macros-final-results.json`. The four fresh captures were also rechecked unchanged: shopping cart **0.574 s**, game store **0.797 s**, Shopco **41.526 s**, Multimart **413.205 s**. Separate results: `/tmp/bippy-parser-expansion/{macros-final,second-macros-final}-results.json`. These analysis/replay timings are not comparable to first-run durations that include installation and live capture. Changed-file lint/formatting and diff checks pass.
- Macro configuration cache lifetime across changed environments, source provenance through rewrites, custom build pipelines and non-CRA macro integrations remain unaudited. No claim of general Babel support is made.

### Incomplete replay membership checkpoint

- Found a classification defect in `replayEnumeratedStates`: a matched capture became `unsound` merely because no replay re-witnessed it, even when every sampled comparison was incomplete and no contradiction existed. An earlier test explicitly enforced that policy. It conflated absent proof with contrary evidence.
- A contradiction against the matched assignment is now required before invalidating its original capture membership. Incomplete replay remains `sample-incomplete`, not a replay pass. The regression requires the complete original comparison report and matched conditions to remain unchanged, rather than lowering a coverage threshold. A separate known-contradiction test still requires `unsound` and `contradicted`.
- The before log is `/tmp/bippy-replay-incomplete-membership-before.log`; all 25 replay tests pass afterward in `/tmp/bippy-replay-incomplete-membership-after.log`. Root validation passes **2,864 tests**, two existing skips, including **818 parser tests / 46 files**. Root typecheck/build, realms, changed-file lint/formatting and diff checks pass. Logs: `/tmp/bippy-replay-membership-root-{typecheck,tests}.log`, `/tmp/bippy-replay-membership-{build,realms}.log`.
- Identical captures remain exact/100% strict with zero contradictions: Sentry **27.557 s**, one passing replay; PostHog **178.381 s**, two replays with one incomplete. Separate results: `/tmp/bippy-parser-corpus/replay-membership-results.json`. Documentation checks still pass 36 links and both executable examples in `/tmp/bippy-replay-membership-docs.log`.
- Corrected-model coherence, preferred matches beyond the enumerated sample, cause/order evidence and whole-space completeness remain open. This classification repair does not complete P2.
- A fifth fresh repository, `nlw-expert-react` at `a610fdc6d2c4d1cdbf50557505ce706954ef11cf`, matches exactly with 100% strict coverage and one passing replay. Its 25 runtime fibers come from React 18.2.0 and three commits. The first install/capture/analysis run takes **10.791 s**. No tracked source or lockfile changes. Capture SHA-256: `019adda00c7b2f2b5f11e2cc4df153fe1fcf710ba96f54e12858b6d901262a3f`; lock SHA-256: `931406ca92d067af4a04ff71a957991a5c677fc0510bd68f12af29db37f24c7e`. Results: `/tmp/bippy-parser-expansion/notes-results.json`; configuration comes from reviewed `af685cc8` with explicit `CI=1`. A later no-CI capture and configuration were imported, as recorded below.
- Configuration review also found that the corpus schema silently drops `static.servedDirectory`, including Saleor's existing setting. The TypeScript interface and renderer support it, but the Zod schema omits it. Pending Expo worker configs also contain unsupported `static.platform` values which must not be silently ignored. Fix schema fidelity and reject unsupported keys before importing those configs. The Node-14 Fashion Cube recipe currently lacks its required nvm installation; do not claim a Fiber capture from it.

### Native Vite resolved client environment checkpoint

- Reproduced three failures where application expressions ignored native Vite environment facts. The native loader also discarded resolved configuration when no user plugins remained. It now retains the resolved client environment independently of the plugin list. Dotenv exposure, custom prefix arrays, absent public keys, and `DEV`/`PROD` come from native resolution rather than development defaults or guessed prefixes.
- Each interpreter creates a mutable `import.meta.env` object per client module. Derived renderers share configuration facts, not evaluated objects. Native environment define values override resolved fields; JSON values preserve nested objects and null. Unevaluated define expressions remain unknown rather than falling back to a known flag. This does not interpret arbitrary compiler expressions or initialize general compiler-defined globals.
- Native `NODE_ENV` string replacement also reaches the module graph's CommonJS branch extraction. React's cloned package entries confirm why extraction and expression evaluation must select the same branch. The fixture includes an authored TypeScript CommonJS package and verifies production versus non-production exports. Direct and whole-`process.env` caller overrides retain precedence. Another regression preserves dotted caller defines over whole client-environment objects and retains the existing null-as-unset convention without changing native JSON null values. Evidence: `/tmp/bippy-vite-whole-environment-{before,after}.log`. Non-string or unevaluated native `NODE_ENV` replacements are rejected rather than selecting an assumed CommonJS branch.
- Mutation testing exposed two distinct issues. Property-read initializers had remained lazy, so `const initial = environment.VALUE` could capture a later assignment. They now run in module statement order. An intermediate attempt also treated native environment defines as source constants. Actual Vite CLI/Bippy capture disproved that assumption: both direct and aliased field reads observe mutation in client dev-server code. Vite's client import-analysis injection, not its server define transform, determines this behavior. The same intermediate model passed its own replay while mismatching the independent mutation capture.
- A further structural regression found a lifetime error: creating the environment object on its first read inside an effect made the heap journal treat it as callback-local. A guarded write then removed the untouched outcome. Module initialization now allocates the object before effects. The regression requires both canvas/strong and aside/footer outcomes and rejects aside/strong. Evidence: `/tmp/bippy-vite-environment-allocation-{before,after}.log`. Conditional module initialization and other lazy initializer forms remain separate ownership work.
- Object-key enumeration exposed another shared interpreter/replay error. Vite serializes environment properties in sorted order; the model initially retained native configuration insertion order. All three fresh environment captures mismatched despite passing replay. The model now preserves Vite's initial property order. Before evidence: `/tmp/bippy-vite-environment-key-order-{before,independent-before}.log`; mutation evidence: `/tmp/bippy-vite-resolved-environment-independent-probe.log` and saved `first/mutation-probe-comparison.json`.
- Final independent development, production, test and mutation captures each have one committed render, exact/100% strict coverage, and one passing replay. The production capture uses a production React build; the other three use development builds. Detached `427adee5` mismatches all four identical captures. Its first three replay checks remain incomplete, while its mutation replay passes. Do not describe incomplete baseline checks as passes or contradictions.
- Evidence: `/tmp/bippy-check-vite-resolved-environment.mts`, `/tmp/bippy-vite-resolved-environment-final-{independent,baseline}.log`, and `/tmp/bippy-vite-resolved-environment-captures/`. `provenance.json` records source hashes, Node 24.21.0, React 19.3.0, Vite 8.2.2 and capture metadata. Earlier captures remain under `first/`. An initial verifier misspelled `externalPackageAllowList`; its incomplete artifacts remain under `invalid-options/` and are not acceptance evidence.
- Capture hashes: development `61b2a7621e8987393e94f68377604be43fc5a7c214783898a1efd84191a4f654`, production `83171bad2713e11ff678021824a36ac3d2c9166007a8c230f33980c7edef5b01`, test `2c1790c46c686c5c74861e53f129b5365673583abc779d14d492168be9459c8d`, mutation `f677623471bae180720882076c2346803ac090b6dfbe72164a495cd2e9f9a89e`.
- Nine focused tests pass. Their initial exact-key expectation also exposed Vite Plus's inherited `VITE_PLUS_TOOL_RECURSION` variable, which native Vite correctly exposes. These tests now explicitly isolate public-prefix variables instead of assuming the test harness has none. That was a test-environment defect, not a reason to remove an application environment key. Final validation passes **2,918 root tests**, two existing skips, **872 parser tests / 51 files**, root typecheck/build, realms, changed-file lint/formatting and diff checks. Logs: `/tmp/bippy-vite-resolved-environment-root-{typecheck,tests}.log` and `/tmp/bippy-vite-resolved-environment-{parser-tests,build,realms,docs,validation}.log`. Documentation checks pass 41 links and both executable examples. Generated Vite caches remain ignored; dry-run fixture staging includes only authored files.
- Final identical Sentry/PostHog captures remain exact/100% strict with zero contradictions: **28.143 s / 175.188 s**, in `/tmp/bippy-parser-corpus/vite-resolved-environment-results.json`. Sentry has one passing replay; PostHog has two replays with one incomplete. Original capture hashes remain unchanged. Pre-allocation and allocation results remain in separate files. No budget changes or performance attribution.
- Remaining environment work includes fileless Vite configuration discovery, server-side Vite environments, general compiler globals, opaque expression semantics, configuration mutations/deletion, runner initialization, declared SDK environments versus the native process, direct SDK concurrency, and interpreted configuration branches with incomplete private-variable facts. Other lazy initializer forms and conflicting caller aliases still need ownership/order checks. These captures verify client environment behavior and conditional exports, not complete production React lifecycle parity.
- No repository additions: **212 configurations**, with the **500-repository acceptance gate still unmet**. Corrected symbolic-model coherence, remaining async semantics, renderer coverage and human documentation review remain open.

### Three additional Vite application captures

- Fresh, unchanged clones are under `/tmp/bippy-parser-next-expansion/`. Three candidates have package lockfiles and Vite client applications: `ignite-timer` from `rocketseat-education/02-ignite-timer` at `9fc8978a44712045db9ac80ff7f672062a8f0d62`; `coffee-delivery` from `rocketseat-education/ignite-challenge-solution-reactjs-coffee-delivery` at `5d9c4d6cbdcaa52ee2da6e702785b98b452bd746`; and `ignite-feed` from `rocketseat-education/ignite-reactjs-01-fundamentos-react` at `84a9309459d59c385424d2d2ca6cdb83964252af`. All three now have independent captures and repeated comparisons against those identical saved captures. Their configurations and results are imported; the corpus increases from **212 to 215**. Deep comparisons preserve all 212 prior manifest and result records.
- Corpus execution uses `/tmp/bippy-next-expansion-manifest.json`, with separate results under `/tmp/bippy-parser-next-expansion/`. The first attempt found that pnpm 11 automatically reinstalled npm-owned dependencies before running scripts, changed the dependency versions, then rejected unapproved esbuild builds. Generated pnpm lock/workspace files and install markers were archived under `.out/first-install/`; `npm ci` restored the pinned npm trees. No application source or tracked lockfile changes. The supported script command is `pnpm --config.verify-deps-before-run=false run dev ...`; the direct `--no-verify-deps-before-run` option is not accepted. Failed first/second results and `.first-logs`/`.second-logs` remain separate.
- The third attempt captured Coffee Delivery and Ignite Feed exactly. Ignite Timer failed with no React commits: the chosen `--legacy-peer-deps` install omitted the locked peer `react-is@18.1.0`, which styled-components requires. After that capture failed and its server stopped, ordinary `npm ci` restored the required peer from the unchanged lockfile. The fourth attempt then captured Ignite Timer exactly. This was an installation-recipe correction, not an application patch or dependency-version substitution. Evidence: `/tmp/bippy-next-expansion-{third,fourth}.log`; failed server output is retained under `.out/ignite-timer-missing-peer.log`.
- Each accepted capture has one committed render, exact/100% strict coverage and one passing replay, with no opaque or wildcard nodes. Ignite Timer uses React **18.1.0** and Vite **2.9.9**: 87 static/89 runtime fibers, 82 compared fibers plus one text node. Coffee Delivery uses React **18.2.0** and Vite **4.5.0**: 683 static/690 runtime fibers, 681 compared fibers. Ignite Feed uses React **18.1.0** and Vite **2.9.8**: 137 static/137 runtime fibers, 133 compared fibers plus three text nodes. Each current model has one state and no symbolic inputs; these are initial-page membership checks, not user-event coverage or whole-space proofs.
- First successful live durations are **8.081 s / 5.716 s / 5.230 s** for Timer/Coffee/Feed. Identical-capture analysis/replay takes **0.679 s / 1.345 s / 0.683 s**. These are different operations, not a performance comparison. Final imported results: `/tmp/bippy-parser-next-expansion/repeated-results.json`; provenance: `/tmp/bippy-parser-next-expansion/provenance.json`. Raw captures remain under `.out/`. All application source and tracked lockfiles remain unchanged.
- Capture SHA-256 values: Timer `518c312951cbcab2dddbc8db323cdf9fe1bb2b260580d860813bea27a4c59f23`; Coffee `088918f015021662e97fab434e6b341ff7b834b71d0f9415964b48f2974182b3`; Feed `1c6da80c8c551732ed3e9ae2aa2aeb668c98e319d6daf84c5e2d38910599f042`. Lock hashes are `3a3bc953da8ff640e5f27321379e992a10a116d3fa938996932f7c86c23691d5`, `9a1e007331a0052cdf51305fec4763c66033ae062976011c94a851ba4bd0cbdf`, and `6d37e6561ef8b4c1c166853ad4de03057b3b027078e6ca5260a25c0f595b785d`, respectively.
- No budgets or comparisons changed. Root typecheck, all 11 manifest tests, schema validation, formatting/diff checks and the 41-link executable architecture check pass. Logs: `/tmp/bippy-next-expansion-{typecheck,manifest-tests,format,docs}.log`. Prior records are backed up in `/tmp/bippy-before-next-expansion-{manifest,results}.json` and verified unchanged. This data-only checkpoint follows the full **2,918-test** validation of `e3980073`; no parser implementation changes were required for these three applications. The **500-repository gate remains unmet**, with **285 more distinct repositories** needed.
- The original `react-movies` clone is at `d4790df5a4017c56ba368c4d4dd3307cdc29feea`. The worker's application-source URL rewrites and substitute API server remain rejected. Source inspection shows that unavailable Appwrite data can return undefined and later reach a `.length` read. That requires an actual configuration/runtime check, not an invented successful capture.
- Additional unmodified clones: `ignite-reactjs-app-web-completa` at `4daad5b07fd84c8503b1faa82fedfd42b9f06a8c` uses CRA 4 and its own Mirage backend; `nlw-04-reactjs` at `44135ad88e3e287bf7a6879effb007007bbbf2b9` uses Next 10; `ignite-reactjs-fundamentos-react` at `e53bee8f6aea011d75b40170d630628c12e805e3` depends on node-sass 5. No source modifications or runtime claims. Organization metadata is saved in `/tmp/bippy-rocketseat-repositories{,-second,-third}.json`.

### Four-application checkpoint after metadata

- Imported four more unmodified repositories after metadata implementation `45023578` and Tailwind data checkpoint `7cf38fe1`. The corpus now contains 231 distinct repository URLs. Twenty-four fresh captures beyond the historical 207 comprise twenty-one exact membership results, two truncated results and one partial result. The 500-repository gate still needs 269 additional repositories; interaction and whole-space gates remain open.
- `fullstack-adivinhe`, `rocketseat-education/fullstack-adivinhe` at `081fccd3085d4b77f73df467b81f1ded1b2c89d2`: React 18.3.1, original five-word guessing game, no backend. Its single independent capture follows two commits. The model retains six initial states including loading and replays five assignments without omissions or contradictions. This does not independently validate all word selections or any gameplay transition.
- `go-react-ama`, `rocketseat-education/semana-tech-01-go-react-web` at `eae465a4a2641b34b905811e9769caad3e7c1b64`: original React `19.0.0-rc-3208e73e-20240730`, one initial create-room commit/state/replay. The initial page does not call the original Go API. Submission and room navigation remain untested. Ordinary npm ci failed because React Query 5.51.17 requires React 18; legacy-peer installation preserves the original lock and installed RC. The failure is archived under `.out/post-metadata-before/go-react-ama-npm-ci.log`.
- `masterclass-react-twitter`, `rocketseat-education/masterclass-react` at `f15565e063e1c7b979939181888642e42c5bdee8`: React 18.2.0, original three local timeline posts, one initial commit/state/replay. No backend or replacement data. Posting, hotkeys and navigation remain untested.
- `ignite-next-auth-jwt`, `rocketseat-education/ignite-reactjs-next-auth-jwt` at `19452de7555e919267a4e40831007f04919e5e94`: Next 10.2.0/React 17.0.2, frozen Yarn dependencies and verified Node 16.20.2/pnpm 8.15.9. The native sign-in page uses the fresh browser's empty cookies and follows two commits, with one model state/replay. Authentication, cross-tab sign-out and the original backend remain untested. Runtime receipt: `/tmp/bippy-post-metadata-node16.log`.
- The first AMA and Twitter analysis recipes wrongly forced react-router-dom source through an adapter expecting model-created routers. Their partial results, static patterns and manifests remain archived. Removing that allowlist entry selects the existing adapter consistently; the same captures then match exactly with no opaque regions. This is an analysis-configuration correction, not a parser repair, changed live environment or relaxed comparison. No application source or lock changed. Consistent all-source router analysis remains a separate integration question.
- All four repeated comparisons reach exact/100% strict membership with no page errors, omissions, contradictions or incomplete samples. Results: `/tmp/bippy-parser-next-expansion/post-metadata-candidates-{first,repeated}-results.json` and `post-metadata-router-policy-results.json`. Provenance: `post-metadata-candidates-provenance.json`, checked by `/tmp/bippy-record-post-metadata-candidates.ts`. Install and first-analysis failures remain in `/tmp/bippy-post-metadata-*` and `.out/post-metadata-before/`; no budget increase or substituted API was used.
- `/tmp/bippy-import-post-metadata-candidates.ts` preserves all 227 prior manifest/result rows and rejects duplicate repositories. Backups use `/tmp/bippy-before-post-metadata-candidates-{manifest,results}.json`; the import recipe is `/tmp/bippy-post-metadata-import-manifest.json`. Ports 54348 through 54351 close after capture. Data-only validation passes root typecheck, eleven manifest tests, both schemas, all 227 prior-row equality checks after formatting, format/diff checks and 49 documentation links with executable examples. Logs use `/tmp/bippy-post-metadata-data-*`; parser implementation remains unchanged from the 2,983-root/937-parser-test checkpoint.
- The additional `ignite-template-reactjs-conceitos-do-react` clone at `04bf57a41e6f1bfb4117f88e910ecba6307517ca` has no lockfile and requires node-sass 6. It was not installed, captured or counted. Human publication review and PR disclosure remain outstanding; nothing pushed.

### Tailwind corpus checkpoint

- Imported `ignite-tailwind-next`, repository `rocketseat-education/ignite-masterclass-tailwind-next` at `8cefd200f5fccf720631dbd850c2cc29a5a7ee58`, after metadata implementation `45023578`. The corpus now contains 227 configurations from 227 distinct repository URLs. Twenty fresh captures beyond the historical 207 comprise seventeen exact membership results, two truncated results and one partial result. The 500-repository gate still needs 273 additional repositories.
- Pinned pnpm 7.33.7 dependencies and application source remain unchanged. The original Next 13.2.4 development script serves framework React `18.3.0-next-3706edb81-20230308`; the saved final snapshot follows two commits. Original fill-rule and clip-rule warnings remain. No application repair, new input or metadata-fiber filter was added.
- The final and repeated comparisons deeply agree on report, runtime summary, state space and replay: exact/100% strict membership, 89 static/125 runtime fibers, 78 matched fibers, one counted/enumerated state and one passing replay, no omissions or incomplete samples. This remains initial-page evidence, not navigation, visual, title-content, hydration, streaming or whole-space parity.
- `/tmp/bippy-record-next-metadata.ts` records `/tmp/bippy-parser-next-expansion/next-metadata-provenance.json` with parser `45023578`, detached baseline `bd4238b8`, capture/source/lock hashes, installed helper hashes, sixteen independent final-code fixture captures and seven unchanged controls. `/tmp/bippy-import-tailwind-metadata.ts` verifies every prior manifest/result row and rejects duplicate repositories. Backups use `/tmp/bippy-before-tailwind-metadata-{manifest,results}.json`; the one-entry recipe is `/tmp/bippy-tailwind-metadata-manifest.json`.
- Data-only validation passes root typecheck, eleven manifest tests, both schemas, all 226 prior-row equality checks after formatting, format/diff checks, and 49 documentation links with executable examples. Logs use `/tmp/bippy-tailwind-metadata-data-*`. The fixture server releases port 54347. Human documentation review and PR disclosure remain outstanding. Nothing pushed.

### Three-tool corpus and Podcastr replay evidence checkpoint

- Parser implementation `f69766a1` adds preferred outside-match replay. Data import adds Heroicons, Portfolio Template, and Lapian Notes, bringing the corpus from 231 to 234 repositories. The twenty-seven additions beyond the original 207 now contain twenty-two exact results, two truncated results, two partial results, and one mismatch. The 500-repository gate still needs 266 additional repositories.
- A read-only GitHub identity audit resolves all 231 existing entries and eight candidate URLs. All 231 existing repository IDs are distinct. The candidate Excalidraw Clone is the existing `mirayatech/excalidraw-clone` repository under its renamed `mirayavandiepen` owner, with GitHub ID 737608315 and the same pinned commit. Its fresh capture is retained, but it is not counted or imported as a new repository. `/tmp/bippy-corpus-identities.json` and its raw query responses preserve the audit. The three imports have distinct, non-fork identities.
- Heroicons remains a mismatch with 516 counted states, 256 enumerated states, 1,992 omissions, and all sixteen replays incomplete. Its original `stroke-width` React warning remains. This is a genuine configured application mismatch, not a passing coverage claim.
- Portfolio Template remains partial at about 78.18% strict coverage with nineteen opaque components. Its single replay passes without validating hidden animation subtrees. The native snapshot follows 158 commits; it is not an independent history of those commits.
- Lapian Notes has exact initial-page membership and four incomplete samples among eight replayed assignments. Unknown `__ONLINE_DEMO__` reads remain. No media files, AI credentials, backend replacements, or event inputs are introduced.
- Repeated report, runtime, state-space, and replay fields for these three candidates and the uncounted Excalidraw capture are deeply identical to their first results. Application source and the three imported lockfiles remain unchanged. Capture and lock hashes, repository IDs, failures, and scope limits are recorded in `/tmp/bippy-parser-tool-expansion/import-provenance.json`.
- The existing Podcastr row now records its matched outside candidate as passed within the same sixteen-replay budget. Membership, native capture, 1,024 counted states, 256 enumerated states, and 768 omissions remain unchanged. The old result, detached baseline, and all sixteen raw replay witnesses remain separate.
- `/tmp/bippy-import-tool-evidence.ts` and `/tmp/bippy-preserve-tool-evidence-order.ts` preserve all 230 other prior configurations and result rows, including their order and original property order. Exclusive pre-import backups are `/tmp/bippy-before-tool-evidence-{manifest,results}.json`. The large Heroicons guard and omission payload remains intact rather than pruning failed evidence.
- Data-only validation passes root typecheck, fifteen corpus manifest/schema tests, both checked-in schemas, distinct-identity and prior-row equality checks, formatting, diff checks, and 49 documentation links. No parser code changes accompany this data update. Nothing pushed.

### Preferred outside-match replay checkpoint

- The committed Podcastr result matched outside enumeration without replaying that assignment. Selection now considers the matched conditions, reuses compatible commit aliases where possible, and otherwise adds one unindexed replay candidate within the same replay budget. The candidate summary records `matchedOutsideEnumeration` separately.
- Ten focused regressions cover an outside branch, commit aliases, matched commit causes, an observed repeat beyond its enumeration bound, zero replay budget, unindexed corrections, contradictions, incomplete regions, unavailable trees, and an independently captured real update after the enumerated commit budget. Four serialization cases preserve the outside verification field. Earlier failing logs remain under `/tmp/bippy-replay-preferred-*`.
- An unavailable replay tree incorrectly became a known empty tree in `diffKnownClaims()`. The regression produced `contradicted` before the repair and `incomplete` after it. Known tree differences still contradict claims; missing trees do not establish empty output.
- Replay does not append unindexed witnesses to the state view or mark them as corrected enumerated claims. It does not repair the primary symbolic tree. An additional causal regression exposed a false outside-match pass after the first full validation: alias equality selected an assignment that excluded the matched commit. Candidate reuse now checks the matched cause with the existing guard solver. An unpinned cause remains incomplete rather than inventing a satisfying input. The failing and repaired logs are `/tmp/bippy-replay-preferred-cause-{before,after}.log`.
- The same Podcastr capture remains exact with 1,024 counted states, 256 enumerated states, and 768 omissions. Its matching candidate passes in a 16-of-257 sample. The previous 16-of-256 result remains separate. This is bounded model-backed replay, not new native image-visibility evidence or whole-space coverage.
- React source at `82c44beb444eda5230c063eaa163d01f38817211` confirms `onCommitFiberRoot` receives committed roots and an error flag. Both native fixture capture and interpreted replay still use Bippy. An unavailable snapshot is not a fabricated empty committed tree.
- Serial validation through `/tmp/bippy-validate-preferred-replay.ts` runs under process-scoped `caffeinate -i` and two workers. After the causal regression repair, 2,997 root tests and 951 parser tests across 57 files pass, with two intentional root skips. Typecheck, build, realm checks, lint, formatting, diff checks, and 49 documentation links pass. `/tmp/bippy-preferred-replay-verified-validation.exit` records zero. The earlier 2,996-test validation remains separate.
- Seven controls retain deeply identical report, runtime, state-space, and replay fields: Sentry, PostHog, Tailwind Next, Moveit, Performance React, Dashboard Chakra, and Fullstack Forms. PostHog still has one incomplete replay. `/tmp/bippy-record-preferred-replay.ts` verifies these controls and Podcastr’s unchanged membership and omissions against detached `8e701f60` on the same captures.
- `/tmp/bippy-record-podcastr-preferred-witnesses.mts` saves the symbolic Bippy snapshot and all sixteen replay snapshots, guarded commits, and pins in `/tmp/bippy-parser-next-expansion/preferred-replay-witnesses`. A separate comparison of every replay against the saved native capture confirms that the sixteenth replay is its exact match. Other replay assignments describe different trees, not contradictions against that single capture. No extra renderer calls or native inputs are added. Nothing pushed.

### Eight-tool candidate setup and retained failures

- Clones, original lockfile backups, recipes, captures, and failed attempts reside under `/tmp/bippy-parser-tool-expansion`. The pinned manifest is `/tmp/bippy-tool-candidates-manifest.json`; preparation uses `/tmp/bippy-prepare-tool-candidates.ts`. The later three-tool checkpoint records the imports; blocked candidates and the renamed existing repository remain separate.
- Candidates are prazzon/Flexbox-Labs, xsalazar/emoji-kitchen, zaydek/heroicons.dev, crisanlucid/primusread, mirayavandiepen/excalidraw-clone, shaqdeff/Portfolio-Template, bkingfilm/lapian-notes, and liuzi6612/tomato-work. Recipes use the original native dev commands, ports 54360 through 54367, and initial-page comparisons only. Primusread uses Node 22 and its original `/primusread/` base path.
- Seven installations completed. Flexbox Labs failed frozen `npm ci` because its upstream lockfile lacks dependencies and disagrees with declared versions. The original error log remains in `.out/before/`. No lockfile repair or success claim follows from that failure.
- Six completed comparisons are saved in `first-results.json`: Excalidraw Clone exact with passing replay; Lapian Notes exact with four incomplete replays; Primusread partial at about 4.88% strict coverage; Portfolio partial at about 78.18%; Emoji Kitchen mismatch with thirteen replay contradictions; Heroicons mismatch with one native page error and incomplete replay. These verdicts are not acceptance claims.
- Tomato Work produced a native capture, then the analyzer aborted with `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`. `/tmp/bippy-tool-first.log` and exit 134 remain intact. No heap or state budget increase hides this failure. All eight candidate ports were free after the process exited.
- Further review found that Emoji Kitchen requires the README’s original metadata download into `public/metadata.json`. The first capture shows its missing-metadata error UI, not a configured application success. Preserve that capture as failure-path evidence and use fresh provenance after correcting setup. No replacement metadata is permitted.
- The source check also found that ordinary npm installation changed Primusread’s secondary `yarn.lock`; its canonical npm lock remains unchanged. The first failed assertion and the full lock patch are archived. `/tmp/bippy-parser-tool-expansion/initial-provenance.json` records the actual lock hashes and changes rather than claiming all locks stayed identical.
- Further review must retain original network and backend behavior, native errors, unknown regions, and failed analyses. Lapian Notes also exposes an unresolved generic Vite compiler-define path through `__ONLINE_DEMO__`; it is not an application repair target.

### Next 13.2 metadata checkpoint

- Investigated installed Next 13.2.4 metadata collection, accumulation, file discovery, App Router composition and client layout-router placement. Upstream 13.2.0 through 13.2.4 retain the selected MetadataTree contract. React Flight unwraps keyless server fragments; metadata remains observable as host fibers. React source remains `/tmp/bippy-parser-pr115-react` at `82c44beb444eda5230c063eaa163d01f38817211`.
- The adapter interprets installed MetadataTree, collectMetadata and the framework structured-clone helper. Application exports remain interpreter values; native loader callbacks return module namespaces, not natively evaluated application modules. Explicit module analysis follows relative source dependencies without allowing all Next package imports. Bare package imports retain their previous policy unless explicitly selected.
- Metadata collection receives layout params and page params/searchParams. Repeated query names retain arrays. The nearest legacy head receives its segment params. File-based metadata, catch-all metadata params, parallel-route collection, missing helpers and incomplete collection retain unknown regions. Collection throws retain error diagnostics. Other Next metadata APIs, general streaming/error recovery and wider import-cache ownership remain open.
- Source placement is the first router boundary, inside its template and loading boundary. An intermediate implementation placed metadata outside the root template: all four independently captured template fixtures mismatched while internal replay passed. The repair moves metadata inside that boundary. A grouped root layout can leave metadata outside the body comparison anchor; exact anchored membership cannot validate those excluded fibers. A structural regression separately checks that placement.
- Focused coverage currently passes 21 tests for explicit dependency analysis, metadata inputs, placement, client exclusions, native-execution guards, incomplete collection and unsupported cases. Before logs include `/tmp/bippy-analyzed-modules-before.log`, `/tmp/bippy-next-metadata-before.log` and `/tmp/bippy-next-metadata-template-before.log`. The first throw assertion expected an error message before the adapter reported it; `/tmp/bippy-next-metadata-throw.log` preserves the unknown throwing child and missing diagnostic.
- Independent fixtures use checked-in TypeScript application source and the actual pinned Next 13.2.4 dependencies, with no native application-body execution in the analyzer. Four routes cover nested metadata, parent-promise generation with repeated query values, legacy head and loading. Base, root-template, grouped-root and template/root-loading variants all reach exact membership with one counted state and one passing replay. The first template mismatch log remains `/tmp/bippy-next-metadata-template-independent.log`; its four first comparison JSON files were accidentally overwritten by the repair probe. The probe now refuses to overwrite reports. Other first captures and baseline reports remain separate. A separate placement-baseline worktree reproduces all four template mismatches against those unchanged captures; its reports use the explicit `placement-before-reproduced` label and are not the overwritten originals.
- Detached `bd4238b8` at `/tmp/bippy-parser-pr115-metadata-baseline` mismatches all four base fixture captures while internal replay passes. The same Tailwind capture now reaches exact/100% strict membership with 89 static fibers, 125 runtime fibers, one state and one passing replay; original native warnings remain. First result: `/tmp/bippy-parser-next-expansion/tailwind-metadata-first-results.json`. No comparison rules or budgets changed.
- Final validation passes 2,983 root tests with two intentional skips and 937 parser tests across 56 files, typecheck/build/realms, lint/format/diff, and 49 documentation links with executable examples. The serial `/tmp/bippy-validate-next-metadata.sh` sequence exits zero under process-scoped caffeinate and two workers. Final logs use `/tmp/bippy-next-metadata-*`; sixteen fresh final-code fixture captures and reports use `/tmp/bippy-next-metadata-captures{,-template,-group,-template-root-loading}-verified/`.
- The provenance checker verifies exact membership and one counted/replayed state for all sixteen final-code fixtures, byte equality with checked-in fixture source, baseline mismatches on the same four base captures, and unchanged Tailwind source/lock/dependencies/native warnings. It deeply preserves all seven control reports, state spaces and replay summaries: Sentry, PostHog, Podcastr, Moveit, Performance, Chakra and Forms. PostHog's incomplete sample and Podcastr's 768 omissions with its matching assignment outside enumeration remain. Results: `/tmp/bippy-parser-corpus/next-metadata-results.json`, `/tmp/bippy-parser-next-expansion/next-metadata-control-results.json`, and `tailwind-metadata-final-results.json`. Checker: `/tmp/bippy-record-next-metadata.ts`; precommit check passes in `/tmp/bippy-next-metadata-provenance-check.log`.
- Tailwind remains unimported at this implementation checkpoint, and the corpus remains 226 distinct repositories. Initial membership does not complete the whole-space, interaction, renderer, publication-review or 500-repository gates. Nothing pushed.

### Podcastr corpus checkpoint

- Imported `nlw-podcastr`, repository `rocketseat-education/nlw-05-reactjs` at `00c7678b55c5d3afd942a42fdfac7181501f1b19`, after implementation checkpoint `97ea2617`. The corpus now contains 226 configurations from 226 distinct repository URLs. The nineteen fresh captures beyond the historical 207 comprise sixteen exact membership results, two truncated results and one partial result, not whole-space validation.
- The capture uses the original Node 16/pnpm 8 Next 10.1.3 development recipe and the repository's original json-server/episode data. Source and pinned Yarn lock remain unchanged. React is 17.0.2; the saved final snapshot follows twelve commits and has no page errors. It does not establish playback, navigation, image-load transitions or a full independent commit history.
- The imported result retains all 768 state omissions, 1,024 counted/256 enumerated states and sixteen replay samples. Its matching assignment lies outside the enumeration and was not replayed. Repeated final-code comparison deeply preserves the verified report, state space and replay summary: `/tmp/bippy-parser-next-expansion/podcastr-legacy-image-repeated-results.json`, `/tmp/bippy-podcastr-repeat.log`.
- `/tmp/bippy-import-podcastr.ts` preserves all 225 prior manifest and result records, rejects duplicate repository URLs and validates both output schemas. Backups: `/tmp/bippy-before-podcastr-{manifest,results}.json`. The one-entry recipe is `/tmp/bippy-podcastr-manifest.json`; provenance remains `/tmp/bippy-parser-next-expansion/podcastr-legacy-image-provenance.json` and records parser `97ea2617` against detached baseline `ca1d3f39`.
- Data-only validation passes root typecheck, eleven manifest tests, both schemas, prior-row equality after formatting, formatting/diff checks and 48 documentation links with executable examples. Logs: `/tmp/bippy-podcastr-data-{typecheck,manifest-tests,equality,format,docs}.log`. The initial JSON formatting failure is preserved as `data-format-before.log`; formatting changes no prior data. Tailwind remains unimported with its independently observed metadata mismatch. The 500-repository, whole-space, renderer, interaction and human publication-review gates remain incomplete; nothing pushed.

### Legacy Next image and repeated-element checkpoint

- Checked installed Next 10.1.3 plus upstream image sources from 10.0.0 through 12.1.1, saved under `/tmp/bippy-next-image-version-probes/`. React's host config treats noscript as text content, and ReactChildFiber creates distinct fibers for repeated element occurrences. No viewport or image-load observations were invented.
- The image model now follows the actual boundaries: 10.0.0 nests an img inside two divs; 10.0.1 adds the intrinsic sizing image; 10.0.5 adds client Head preloads; 10.1.0 adds a visibility-dependent noscript before the main image; 11.1.1 makes noscript unconditional after the image and disables lazy loading for blob URLs; 12.0.0 changes div wrappers to spans; 12.0.8 makes noscript lazy-only; 12.1.1 adds ImageElement and the blur fallback. Unknown installed versions retain the existing modern legacy-image shape. Source-derived host structure does not prove loader, style, image-cache, raw-layout or error-validation parity.
- Initial version regressions exposed seven failures, and the early 10.0.x cases exposed five more. An intermediate wrapper/fallback repair falsely coupled repeated uses of the same Image element: four states instead of eight. Materialized-element cache entries now include a per-decision-scope occurrence, counted with weak keys. Four old-version cases retain all eight independent visibility combinations and replay all eight without contradictions or incomplete samples. Sixteen version cases plus a normally rendered shared-element fixture check mixed-text render counts across a parent update and appended child, preserving bailout evidence.
- Test-construction mistakes remain archived separately: an invalid omissions assertion and a replay fixture that retained HostRoot while the replay API strips it. They are not parser defects. Logs include `/tmp/bippy-legacy-image-{before,after,occurrences,early-before,replay,replay-invalid-root,invalid-assertion,final-focused}.log` and `/tmp/bippy-shared-element-decisions-{first,after-occurrences,counters}.log`; the first shared-element probe lacked its required default export and was corrected.
- The unchanged Podcastr capture now has exact/100% strict membership: 250 static fibers, ten branches, 227 runtime fibers, 214 matched nodes. Its state model counts 1,024 states, enumerates 256 and retains 768 omissions; the match lies outside the enumerated set. Sixteen sampled assignments pass with no contradictions or incomplete samples, not a whole-space proof. Evidence: `/tmp/bippy-parser-next-expansion/podcastr-legacy-image-results.json`, `/tmp/bippy-podcastr-legacy-image.log`. It remains unimported at this implementation checkpoint; corpus count stays 225.
- A detached `ca1d3f39` baseline reproduces the span/div mismatch and passing internal replay against a byte-identical copy of the Podcastr capture: `/tmp/bippy-parser-pr115-legacy-image-baseline`, `/tmp/bippy-parser-legacy-image-baseline/results.json`, `/tmp/bippy-legacy-image-detached-baseline.log`. Final results are `/tmp/bippy-parser-next-expansion/podcastr-legacy-image-verified-results.json`.
- Final validation passes 2,962 root tests with two intentional skips and 916 parser tests across 54 files, typecheck/build/realms, lint/format/diff, and 48 documentation links plus executable examples. The final guard label says the image has become visible, not that it is currently inside the margin: the installed intersection hook retains visibility. A complete earlier pass before this label correction remains in `/tmp/bippy-legacy-image-*`; final-code logs are `/tmp/bippy-legacy-image-verified-*`, exit zero under process-scoped caffeinate and two workers.
- Sentry/PostHog retain exact/100% strict membership and deeply unchanged reports, state spaces and replay summaries. PostHog's incomplete sample remains. Results: `/tmp/bippy-parser-corpus/legacy-image-verified-results.json`, 26.694/161.985 seconds without performance attribution. Moveit, Performance, Chakra and Forms likewise remain deeply unchanged in `/tmp/bippy-parser-next-expansion/legacy-image-control-results.json`; Moveit's native hydration warning remains.
- `/tmp/bippy-record-podcastr.ts` verifies source/lock/dependency versions, the native mixture of five images with no fallback and five with fallback, byte-identical baseline/current captures, and all six unchanged controls. It records `/tmp/bippy-parser-next-expansion/podcastr-legacy-image-provenance.json`; capture SHA256 `5fe3a2d7bf1f36887e30f87465a09b26796c4a74bacad3782ad02d028f3e35a7`, lock SHA256 `800a9ed4bd2e4e9b7a749c79a449b6fd1f19adf0dcee18fcd9b806a5607d4e59`. Podcastr takes 0.505 seconds in this saved-capture run, with no controlled performance claim. Its matched assignment remains outside the sampled enumeration.
- Wider cache-position, keyed movement, lifecycle and replay-correction questions remain open. Human documentation review and PR disclosure remain outstanding.

### Framework React pairing checkpoint

- Investigated Tailwind's Next 13.2.4 failure against installed source and the React clone's shared dispatcher. Vendored React DOM calls require('react'), and its client entry calls require('react-dom'); plain Node resolution selects the application's stable packages instead of the framework aliases. The native page uses React `18.3.0-next-3706edb81-20230308`, whose cache dispatcher is absent from the incorrectly paired stable React.
- Added a scoped CommonJS loader for framework React DOM modules. It retains their original source and filenames, resolves local DOM modules through a private cache, and supplies the framework React/DOM aliases. It does not patch Node's resolver, shared require cache or application source. React and other infrastructure still execute normally; application component bodies remain interpreted. This is not a general bundler or security sandbox.
- The runtime uses its own unstable_act when act is absent, rather than binding unrelated application test utilities. The compatibility probe now renders a hook component through Bippy, rejects callback-reported render errors and safely cleans up after failed creation, rendering or unmounting. Console output is restored before recorder disposal.
- Two alias/act regressions fail before the repair. Three cleanup regressions fail the old probe. Sixteen focused runtime tests pass, including actual client/server hook renders, preservation of the application's React module identity, an already cached incompatible client shim, and a committed error case. Logs: `/tmp/bippy-react-aliases-{before,after,focused,final-focused,typecheck,lint}.log` and `/tmp/bippy-runtime-probe-cleanup-before.log`.
- Tailwind now renders with the exact captured framework React version rather than substituting stable React. It remains unimported: the comparison now exposes a separate metadata mismatch, expected main versus actual meta, while internal replay passes. The original fill-rule/clip-rule warnings remain in its capture. Evidence: `/tmp/bippy-tailwind-{diagnostic,aliases,aliases-final}.log`, `/tmp/bippy-tailwind-model-snapshot.json`, `/tmp/bippy-parser-next-expansion/tailwind-react-aliases-results.json`.
- Final validation passes 2,945 root tests with two intentional skips and 899 parser tests across 54 files, root typecheck/build, realms, lint/format/diff, and 47 documentation links with both executable examples. Logs: `/tmp/bippy-react-pairing-{root-typecheck,root-tests,build,realms,parser-tests,corpus,shopco,lint,docs,format-check}.log`; the process-scoped caffeinate/two-worker sequence exits zero.
- Sentry/PostHog remain exact/100% strict on the same captures, with deeply unchanged reports, state spaces and replay summaries relative to the Emotion checkpoint. PostHog's incomplete sample remains. Results: `/tmp/bippy-parser-corpus/react-pairing-results.json`; durations 26.883/162.361 seconds are not a performance attribution.
- The unchanged Shopco capture remains exact/100% strict with 25 states, thirteen replay assignments and four incomplete samples, no contradictions: `/tmp/bippy-parser-expansion/react-pairing-shopco-results.json`, 39.977 seconds. Tailwind's final comparison remains a metadata mismatch: `/tmp/bippy-parser-next-expansion/tailwind-react-pairing-results.json`. The verifier `/tmp/bippy-record-react-pairing.ts` records matching runtime versions, unchanged source/lock, capture hashes, native warnings and retained failures in `/tmp/bippy-parser-next-expansion/react-pairing-provenance.json`.
- The corpus remains 225. Coherent runtime loading does not establish complete framework metadata or lifecycle coverage. The private CommonJS compilation API, unsupported module formats, runtime cache lifetime and fallback equivalence still require explicit support boundaries. Human documentation review and PR disclosure remain outstanding.

### Three-application corpus checkpoint

- Imported Ignite Performance React, Ignite Dashboard Chakra and Fullstack Forms after repeated identical-capture comparisons and provenance checks. The manifest grows from 222 to 225 distinct repository configurations; all prior 222 manifest and result records remain deeply equal. Eighteen fresh captures beyond the historical 207 now report fifteen exact, two truncated and one partial result. The 500-repository gate still needs 275 more configurations, and whole-space validation remains incomplete.
- All three initial pages match exactly at 100% strict coverage with no page errors or replay contradictions. Performance retains two states and two passing replays, including uncertainty about its bundle-analyzer-wrapped Next configuration. Chakra and Forms each retain one state and one passing replay. No event or whole-space coverage is claimed.
- Performance: React 17.0.2, Next 10.2.0, two runtime commits; capture/lock SHA-256 `79676a45fa52cc9db2286b17cf41e38f1cd472aaae257c9cc9be1bfefabc034d` / `b41d59fe8797a8ebcb2d007c38d87dcf3a1ee4f27cb19dc24e79fdd8ac6d5be1`. Its original json-server generator runs, but the captured page precedes search submission.
- Chakra: React 17.0.2, Next 10.1.1, five commits; capture/lock `da29aa000401e633808176a35ee218359489ce15eddeead4ea26925e2cfe861c` / `4878b478c9200545e3d57e144ea4e63dde0f0aa35a66fdce5441bac9d8b5cea4`. The Emotion repair is in parser commit `9ffd1245`; the application and its Mirage setup are unchanged.
- Forms: React 18.3.1, Vite 6.0.2, one commit; capture/lock `46f67475cf7a37f34c94fb1f9df996bb426eb0374913fa776e2f561a271b2fb3` / `0237a7db47b1efbc961bdd022b29edcf52408eade7a78bb4f3596cd917ab734e`. This is the repository's native-control event-form template, not a claim about submission behavior.
- Evidence: `/tmp/bippy-next-three-manifest.json`, `/tmp/bippy-parser-next-expansion/next-three-repeated-results.json`, `/tmp/bippy-next-three-repeat.log` and `/tmp/bippy-parser-next-expansion/next-three-provenance.json`, checked by `/tmp/bippy-record-next-three.ts`. Source and pinned locks remain unchanged; ports were free before launch and the backend closes after each entry. Podcastr and Tailwind remain unimported with their failed model comparisons preserved. Data-checkpoint validation passes: root typecheck, eleven manifest tests, schema and prior-record equality checks, formatting/diff and the 46-link documentation/examples checker.

### Emotion version checkpoint

- Chakra's independent React 17 capture exposes a library-version mismatch despite a passing internal replay: the model inserts `Insertion` fibers before styled hosts, but installed Emotion React/Styled 11.1.5 render those hosts directly. Comparison initially reports zero strict coverage. The normally running application has five commits and no page errors.
- Consulted the React clone's hook dispatcher and upstream Emotion package sources. Published React 11.7.1 and Styled 11.6.0 still insert styles inline. Both 11.8.0 packages introduce the `Insertion` component; their changelog cites upstream commit `2f27156a73f94c3aac82e4ed492cbfdc97225573`. Version archives and metadata remain under `/tmp/bippy-emotion-version-probes/`. The component exists even when its hook falls back on React 17; React version alone does not select this shape.
- The Emotion model now selects a third runtime shape for early Emotion 11. Styled, CSS-prop and ClassNames content render directly, without a placeholder or synthetic Fragment. Emotion 10 consumer/Noop behavior and Emotion 11.8+ Insertion behavior remain separate. No comparison rules, application source, lockfiles or budgets changed.
- Five structural tests cover old, boundary and mixed package versions. Four fail before the change and all five pass afterward: `/tmp/bippy-emotion-version-{before,after}.log`. The same immutable Chakra capture now matches exact/100% strict, with one passing replay and no unknown model regions: `/tmp/bippy-parser-next-expansion/chakra-emotion-results.json`, `/tmp/bippy-chakra-emotion.log`. First static/diagnostic artifacts are archived under `.out/next-five-before-emotion/`. Full validation passes with two test workers: 2,939 root tests/two intentional skips, 893 parser tests across 54 files, root typecheck/build, realm checks, changed-file lint/format/diff and 46 documentation links. The immutable Sentry/PostHog captures remain exact/100% strict with no contradictions and the existing PostHog incomplete replay; `/tmp/bippy-parser-corpus/emotion-version-results.json`, recorded 26.019s/163.406s without performance attribution.

### Next five-application batch in progress

- Five new unmodified clones are prepared under `/tmp/bippy-parser-next-expansion/`, not imported or counted: Ignite Performance React (`8247db0649a823b66e298c1e077ccff468a0f795`), Ignite Dashboard Chakra (`ff4c2fff0df8628e850248be66bf89ca329529ef`), Ignite Tailwind Next (`8cefd200f5fccf720631dbd850c2cc29a5a7ee58`), NLW Podcastr (`00c7678b55c5d3afd942a42fdfac7181501f1b19`) and Fullstack Forms (`db3b301f6a991b94d4e7cd4bd2f309a4da82ea17`). Source packages and entrypoints were reviewed before configuration.
- `/tmp/bippy-prepare-next-five.ts` writes `/tmp/bippy-next-five-manifest.json` and preserves preinstall locks under `.out/next-five-before/`. Three Next 10 / React 17 applications use frozen Yarn and the verified Node 16.20.2 / pnpm 8.15.9 runner. Next 13 Tailwind uses frozen pnpm 7.33.7; Vite 6 Forms uses npm ci. No source repairs or invented inputs are configured.
- Performance and Podcastr run their own checked-in json-server commands/data, sequentially on port 3333. All six required ports were free before launch. The outer batch checks that port 3333 closes after each entry and stops if it does not. Frontend ports are 54342 through 54346. Captures run under `dda8f5b6`, with the new startup guard and a process-scoped idle-sleep assertion.
- The first batch completed with five captures: Forms and Performance match exactly; Chakra and Podcastr mismatch despite passing internal replay; Tailwind captures but static analysis fails with `Cannot read properties of undefined (reading 'current')`. Logs are `/tmp/bippy-next-five-first.{log,pid,exit}` and per-entry `/tmp/bippy-next-five-<id>-first.log`; results `/tmp/bippy-parser-next-expansion/next-five-first-results.json`. Backend port 3333 closes after every entry. Every clone has unchanged tracked files and only its expected installation marker untracked.
- Chakra's Emotion mismatch is being repaired above. Podcastr exposes a separate Next 10 image model mismatch: installed Next 10.1.3 emits div wrappers, while the legacy-image model assumes spans and later noscript behavior. Published Next 10.2, 11.0 and 11.1 image source also uses div wrappers and a visibility-dependent noscript before the image; Next 12 switches to spans and later fallback behavior. Sources are in `/tmp/bippy-next-image-version-probes/`. The captured Podcastr tree has five Image instances without noscript and five with it, so changing wrapper tags alone is insufficient. Do not normalize away host tags or invent visibility/layout facts. Tailwind's stack is saved in `/tmp/bippy-tailwind-diagnostic.log`: vendored React DOM fails at `ReactCurrentCache.current` inside the runtime loader's `isClientOfDom()` probe. That probe currently does not safely reject a thrown compatibility check, and an unmount exception can bypass recorder/console cleanup. Investigate coherent framework package loading and fallback limits before changing it. Inspect runtime errors, actual installed versions, lock fidelity and capture provenance before import; repeat against identical captures. The committed corpus remains 222.

### Corpus startup ownership checkpoint

- The blocked CRA recipe exposed a capture provenance risk: HTTP readiness could accept an unrelated service already using the configured address. React's `ReactFiberDevToolsHook.onCommitRoot()` reports a renderer and root, not dev-server process ownership. A Bippy commit alone cannot establish that the intended application supplied the page.
- `DevServer.start(url)` now probes the address before starting the child. An existing listener rejects startup without a page request or any signal to the existing service. Only connection refusal establishes availability; other probe errors fail startup. The corpus always supplies its configured URL. Startup now runs inside the cleanup scope.
- Readiness requests abort at the remaining overall deadline. A missing response no longer bypasses the timeout, and a response after a recorded child exit cannot establish readiness. An intermediate 500 ms per-request cap rejected healthy slow responses; the separate slow-response regression fails that intermediate implementation and passes the remaining-deadline implementation. No analysis budgets changed.
- Four initial startup/deadline regressions fail the prior implementation. Eleven focused tests now cover occupied HTTP/error/silent listeners, no page request or child launch on conflict, available-address startup, exit during a response, slow healthy responses, bounded missing headers and the four existing child-environment cases. Logs: `/tmp/bippy-server-ownership-{before,after,focused,final-focused}.log` and `/tmp/bippy-server-readiness-slow-before.log`.
- A first independent Moveit capture remains exact/100% strict with its native hydration warning; it is separate from the imported capture at `/tmp/bippy-parser-server-ownership-capture/`, SHA-256 `a57a5694cadbe9ad3f9ef155051e7326769b07a900d7050f355f082d2b251c0f`. The final-code capture under `/tmp/bippy-parser-server-startup-final/` is also exact/100% strict, SHA-256 `0e5e83480a098417a1130bd74a138b83030467ce7e13bb7b201dc6db00e140be`. Intermediate validation reports 2,933 root tests/two skips and 887 parser tests. The first final full run records eight failures during two macOS sleep intervals, not a pass: power logs show a 771-second dark-wake thermal sleep and a 651-second maintenance sleep, matching the stalled test durations. Failure/power logs remain `/tmp/bippy-server-startup-final-root-tests.log` and `/tmp/bippy-server-startup-sleep.log`. A separate `/tmp/bippy-server-startup-verified-*` rerun uses two workers and a process-scoped idle-sleep assertion, with unchanged test timeouts and thermal safeguards. The rerun passes: 2,934 root tests/two intentional skips, 888 parser tests, root typecheck/build, realm checks, changed-file lint/format/diff and the 45-link documentation checker. The immutable Sentry/PostHog captures remain exact/100% strict with no contradictions; PostHog retains its incomplete replay. Results are `/tmp/bippy-parser-corpus/server-startup-verified-results.json`, with recorded durations 26.756s/161.913s and no performance attribution. Final live provenance is `/tmp/bippy-parser-server-startup-final/provenance.json`, checked by `/tmp/bippy-verify-server-startup-capture.ts`.
- The preflight does not prove ownership if another process binds the address during startup. Background daemons, process reuse and externally managed frontends still need explicit ownership rules. The existing user-owned service remains untouched. The corpus count remains 222; startup guards do not solve the CRA origin requirement or the model's soundness/completeness gaps.

### Shadcn and React 17 corpus checkpoint

- Imported Shadcn Admin as a partial result and Moveit as an exact result after provenance checks and identical-capture comparisons. The manifest grows from 220 to 222 distinct repository configurations, preserving every prior manifest and result record. Fifteen fresh captures beyond the historical 207 now report twelve exact, two truncated and one partial result. This is not completion of the 500-repository or whole-space gates; 278 more configurations and unresolved validation work remain.
- Shadcn's imported configuration analyzes TanStack Router, react-redux and reselect without changing application source, compiler output or budgets. Its approximately 79% strict coverage retains 45,703 reported omissions and all sixteen incomplete replay records. No sampled contradiction remains. This is not acceptance as sound or complete. React 19.2.5, Vite 8.0.8, 49 captured commits. Capture/lock SHA-256: `053f6a9ffa3a4c0be127ff21d6d4120d4d269889747a738ae891a5f0481bfea9` / `a405acc028d65821776410585c52eb0e2c4b378915114bafb48adc8b01fd9d87`.
- Moveit (`rocketseat-education/nlw-04-reactjs`, revision `44135ad88e3e287bf7a6879effb007007bbbf2b9`) uses Next 10.0.6, React 17.0.1 and pinned TypeScript 4.1.3. Its normal dev script runs through pnpm dlx with Node 16.20.2 and pnpm 8.15.9; a separate probe confirms the child Node version without changing the global runtime. The accepted capture is exact/100% strict, one commit and one passing replay. Capture/lock SHA-256: `808fdb42b144a086b869089c587686f37211f3970681fd8f1f9926c45f951b77` / `a73295b3f6da22fb65b48f1f4daea64f86fa7d524cd71d718020a0c83592b39c`.
- Moveit retains its native empty-cookie hydration warning: server style width NaN% versus client width 0%. The source converts missing cookies with Number(), then JSON serialization changes NaN to null. No cookie values, source fixes or warning suppression were introduced. The result checks fibers, not DOM style or visual parity.
- Both React 17 candidates initially failed under Node 24 because old PostCSS folder exports no longer resolve. The first Node-version exec probe omitted verify-deps-before-run=false and triggered an unintended pnpm installation. Generated pnpm files and the replaced node_modules tree are archived under `.out/react17-pnpm-probe/`. An initial frozen Yarn rerun incorrectly reported up-to-date against stale integrity data. Moving that tree out and reinstalling frozen Yarn restores the actual pinned dependencies before Moveit's accepted third run. Source and lockfiles are unchanged.
- `--config.use-node-version=16.20.2` did not change the executable: its corrected probe still returned v24.21.0. The explicit Node/pnpm dlx probe returns v16.20.2. Logs: `/tmp/bippy-react17-{first,second,third}.log`, `/tmp/bippy-react17-node16{,-second}-probe.log`, `/tmp/bippy-node16-{dlx,pnpm8}-probe.log`, `/tmp/bippy-react17-restore-yarn.log` and `/tmp/bippy-moveit-repeat.log`.
- The CRA finance candidate remains excluded. Its custom-port capture had MirageError because unmodified source targets http://localhost:3000/api. Even though that failed-page fiber comparison was 100%, it is not an accepted application capture. The file was moved out of the active capture directory into `.out/react17-before/ignite-dt-money-cra-wrong-origin.capture.json`. Its generated tracked eslint cache was archived and restored. Port 3000 belongs to an unrelated user-owned Next server, which was left running. Do not run the blocked localhost:3000 recipe until that port is available; readiness checks must not mistake an unrelated service for the candidate.
- Configuration/results: `/tmp/bippy-shadcn-moveit-manifest.json`, `/tmp/bippy-shadcn-moveit-results.json`; provenance `/tmp/bippy-parser-next-expansion/shadcn-moveit-provenance.json`, verified by `/tmp/bippy-record-shadcn-moveit.ts`. Moveit-only and blocked CRA recipes are separate in `/tmp/bippy-react17-{valid,blocked}-manifest.json`. Native dev-server processes were cleaned up. Data-checkpoint validation passes: root typecheck, eleven manifest tests, schema and prior-record equality checks, formatting/diff and the 44-link documentation/examples checker. Parser implementation remains `6d3f8fdf`.

### Error-boundary payload checkpoint

- React's cloned `ReactFiberThrow.js` passes `errorInfo.value` to getDerivedStateFromError and schedules componentDidCatch with that same value. The parser instead replaced every caught value with a closed object containing unknown name/message/stack fields, losing both custom fields and identity.
- `/tmp/bippy-error-boundary-payload-before.log` records a real React/Bippy mismatch while internal replay passes. The new fixture checks object identity, Error identity, strings, undefined, null and nested rethrows. The repair retains StaticValue payloads in StaticThrowError and passes them into the class renderer. Unknown host errors remain unknown rather than fabricated closed objects. Application bodies still run only in the interpreter on the static side.
- A second structural regression exposed an intermediate correlation error: collecting two always-throwing branches created a fresh independent error choice. The model claimed an impossible aside while exact capture membership and both replay samples passed. `/tmp/bippy-error-boundary-correlation-before.log` retains this case. Caught-value extraction now maps always-throwing branches through their original predicate. The four focused error-boundary fixtures pass in `error-boundary-correlation-after.log`.
- Full validation passes under `/tmp/bippy-error-payload-*`: root typecheck/build, 2,927 root tests with two existing skips, 881 parser tests across 53 files, realms, changed-file lint/format/diff and the 44-link documentation/examples checker. Immutable Sentry/PostHog captures remain exact/100% strict in `error-payload-results.json`, with no contradictions and PostHog's existing incomplete replay. Times are 32.392s/184.864s; concurrent jobs prevent performance attribution. Native componentDidCatch execution, mixed throwing/nonthrowing causes, caught-value provenance for compound throws, static lifecycle receivers and full boundary scheduling remain open. The architecture states the principal limits.

### Shadcn dependency analysis after the context repair

- The Bippy boundary probe reports a rethrow at TanStack's `not-found.js:35`, not the original exception. Inspection also found the unmatched opaque slot: RechartsStoreProvider's Provider from react-redux, hiding 394 fibers. It was an analysis-configuration omission, not a reason to change the app or comparison rules.
- Adding react-redux to the source allowlist removes the four replay contradictions. `/tmp/bippy-parser-dashboard-final/redux-results.json` remains partial at approximately 77% strict coverage: 8,706 counted states, 256 enumerated, 8,456 omissions, and all sixteen sampled replays incomplete. It is not a replay pass or completeness result, and Shadcn remains unimported.
- Redux-only diagnostics then exposed un-analyzed reselect#createSelector results. The current local manifest also admits reselect. The render-only probe `/tmp/bippy-shadcn-reselect-{pattern.txt,issues.json}` now reaches 1,562 formatted lines but still exposes unsupported WeakRef cache reads. No WeakRef behavior, layout values or budgets have been overridden.
- Before-Redux and Redux-only manifest snapshots are `/tmp/bippy-dashboard-before-redux-manifest.json` and `/tmp/bippy-dashboard-redux-manifest.json`. The current `/tmp/bippy-dashboard-expansion-manifest.json` includes reselect. A same-capture comparison ran on both the payload repair and detached baseline `45814c81` at `/tmp/bippy-parser-pr115-error-payload-baseline`. Results/logs: `/tmp/bippy-parser-dashboard-error-baseline/results.json`, `/tmp/bippy-parser-dashboard-final/reselect-error-payload-results.json`, `/tmp/bippy-shadcn-error-payload-{baseline,current}.log`. Output directories are separate; cloned source and captures are shared unchanged. Both versions return the same partial result at approximately 79% strict coverage: 45,954 counted states, 256 enumerated, 45,703 omissions, 109 inputs/222 guards, and all sixteen sampled replays incomplete with no contradictions. The payload repair does not fix the remaining chart uncertainty. No budget or comparison rule was changed, and this result is not a whole-space or replay pass.

### Context-sensitive component recursion checkpoint

- After the native-path repair, the remaining Shadcn Admin wildcard reports `recursive OutletImpl` despite nested match providers changing route IDs. `evaluateComposite` compared source closure and props but ignored consumed context values. Equal props do not prove nontermination.
- Reviewed the cloned React `ReactFiberNewContext.js`: React records consumed context values and compares them independently of props/state. The pending repair keeps the existing per-render context-read trace in a weak owner-frame map and checks ancestor context values before an early recursion cutoff. Primitive comparisons use Object.is semantics; object comparisons preserve allocation identity. The existing maximum recursion depth is unchanged, and cutoffs remain unknown subtrees.
- `/tmp/bippy-context-recursion-fixture-before.log` records a real React/Bippy regression at 51.85% strict coverage: function consumers, class contextType consumers, and equal-looking but distinct context objects were all truncated. The repaired fixture is exact. A second exact fixture covers memoized recursion across an effect-driven provider update. Two static-only checks retain both the repeated-input cutoff and a configured three-level limit for changing context.
- Four initial focused regressions pass in `/tmp/bippy-context-recursion-focused.log`; the existing props-driven recursion fixture also passes. The intermediate root run passes 2,924 tests with two existing skips, before adding the dependency regression below. The intermediate Shadcn result in `dashboard-context-results.json` is partial at approximately 76% strict coverage: 515 counted states, 256 enumerated, 259 omitted, 16/254 sampled assignments, four contradictions and four incomplete replays. The capture matches outside the enumerated set. This is not acceptance or a soundness claim.
- A third independent React/Bippy fixture confirms that recursion probes must not enter the child's dependency trace. The intermediate implementation recorded an ancestor-only context in a memoized child, reran its application body on a provider update, and produced child render count 2 instead of runtime count 1. Internal replay still passed. `/tmp/bippy-context-recursion-dependencies-before.log` retains the mismatch. A private non-recording context read repairs it; all five focused tests pass in `context-recursion-dependencies-after.log`.
- Final validation uses separate `context-recursion-final` filenames: root typecheck/build, 2,925 root tests with two existing skips, 879 parser tests across 53 files, realms, changed-file lint/format/diff and the 42-link documentation/examples checker all pass. Identical Sentry/PostHog captures remain exact at 100% strict coverage with no replay contradictions, taking 36.491s and 205.644s. PostHog retains one incomplete replay. Concurrent jobs prevent performance attribution.
- The final dashboard run uses `/tmp/bippy-parser-dashboard-final/`, with symlinked unchanged clones and byte-identical saved captures in a separate output directory. `/tmp/bippy-dashboard-context-final.log` and its PID/exit files track it. This avoids overwriting intermediate diagnostics. The final result remains partial at approximately 76% strict coverage, with four replay contradictions and four incomplete samples. It is not imported or accepted as sound. A render-only probe saves `/tmp/bippy-shadcn-diagnostic-{pattern.txt,issues.json}`; the final snapshot is GeneralError and includes a tailwind-merge call-depth warning. This does not identify the caught exception or establish membership across earlier commits.
- Legacy context, mutable heap/state dependencies, repeated-input heuristics, and TanStack's process-global generator registry remain separate completeness questions. No additional corpus entries have been imported.

### Five-application corpus expansion checkpoint

- Configuration: `/tmp/bippy-money-todo-lab-manifest.json`. Fresh pinned clones: `ignite-reactjs-03-dt-money` at `9c7b7c76552636aae4442c29e0a55b2cb1b0768c`, `ignite-challenge-solution-reactjs-todo` at `cf83cf99e9a5563ebd90c60b9593130f4ff2d688`, and `ignite-lab-design-system` at `5dc13884ef58f74cebcf3e7e32d871dbbbebc68b`. Money/todo corpus IDs use directory symlinks to these clones. Lock backups are under `.out/money-todo-lab-before/`.
- First normal CLI/Bippy run: `/tmp/bippy-money-todo-lab-first.log`, `money-todo-lab-first-results.json`. Todo is exact/100% strict with one passing replay. DT Money uses its own json-server transaction data; the captured tree matches at 100% strict but the result is truncated, with nine counted states, one omitted state and six incomplete replays among eight assignments. Neither result is imported yet. Port 3333 was verified closed afterward.
- Lab's ordinary npm ci failed with EUSAGE, missing `require-from-string@2.0.2` from the lockfile during peer resolution. The failed log is archived as `.out/ignite-lab-design-system-npm-ci.log`; no capture was accepted. A retry with `npm ci --legacy-peer-deps` preserves the lockfile and is running into `money-todo-lab-second-results.json`. Source and lock fidelity still need final checks.
- Lab's legacy-peer npm-ci retry succeeds: Vite 3.1.7, React 18.2.0, four real commits, exact/100% strict coverage and one passing replay. Its source and lockfile remain unchanged. `reactjs-github-blog-challenge` at `2227c94fcfcf7b7fce5ca30283f06c9a7af00343` has no runnable package manifest and is not a corpus entry.
- Imported Journey, React na Pratica, DT Money, Todo and Lab after repeating all five identical saved captures. The manifest grows from 215 to 220 distinct repository configurations; every prior manifest and result record is deeply unchanged. Four new results are exact, one is truncated. DT Money retains its omission and all six incomplete replay records; no contradictions were found in these five entries. The historical 207 plus thirteen fresh captures now comprise eleven new exact results and two new truncated results. This does not finish the 500-repository or whole-space gates.
- `/tmp/bippy-five-application-manifest.json` and `/tmp/bippy-parser-five-application-results.json` record the combined run. `/tmp/bippy-record-five-applications.ts` verifies revisions, tracked files, untracked installation markers, pre-install lock hashes, capture commits, runtime versions and result claims. Provenance: `/tmp/bippy-parser-next-expansion/five-application-provenance.json`. React na Pratica emits React's function-component ref warning from SlotClone/Button; its full text remains in captures, provenance and checked-in results. No warning or application source was suppressed or repaired. The other four captures have empty pageErrors arrays.
- Journey capture/lock SHA-256: `b71a0d3e00d06f3ae6d8308fcba2a4655ceb0e4fcd18d67ec06c8ec1b83ab80c` / `cb9f3bc6160a9f2d0d5f77d0bccd15ff2a37b029fcdd551f50dc243d1ad4852a`; React na Pratica: `56cc8fc5d85b51b7e4ee3973441281ec85394b7bb9c420ac3ee10e2108e592dc` / `fccf93791686a05a5336052c236611314fb7326c464af8c0f3d459705a92b0b2`.
- DT Money capture/lock SHA-256: `16d659c61f2c11e6488a14a321668dcefdf424f424f396d6a823c41eaaea5e28` / `01f28ec87dd780258370fe97dc908a1f5911030e675804faf72e821488572750`; Todo: `ace576891d86531e79eee5f5ad3f853b519fd8a29634d4a1020b7c784b33ce49` / `f6d01ee0602c25b2078ccceff51fab47b0031629e740a5a87744a9f784283c58`; Lab: `820a79854ce325cac8b83291bd74d372c974d456b0cc3e461a5513650ae76308` / `ffa510ca695ee8d4876831344a759dcb9e45437227fb071afc18266cd2edb909`.
- Data-checkpoint validation: root typecheck, all eleven manifest tests, schema validation, formatting/diff and the 42-link documentation/examples checker. Parser implementation is unchanged from `aa46a2a5`. Shadcn remains local, contradicted and unresolved. A Bippy error-boundary probe runs from `/tmp/bippy-trace-shadcn-errors.mts`, tracked by `/tmp/bippy-shadcn-errors.{log,pid,exit}`. The manifest still needs 280 additional distinct configurations, plus unresolved validation and renderer work.

### Native Vite project path checkpoint and pending dashboard batch

- New unchanged clones under `/tmp/bippy-parser-next-expansion/`: `shadcn-admin` at `e16c87f213a5ba5e45964e9b67c792105ec74d26`, `nlw-journey-react` at `39e24d348e741c7a814a9a626b442237aad74154`, and `react-na-pratica` at `36636b84523d05c5c065fdafb65a2ba7961bab33`. Configuration: `/tmp/bippy-dashboard-expansion-manifest.json`. Source and lockfiles remain unchanged; no new rows imported yet.
- `/tmp/bippy-dashboard-expansion-first.log` and `dashboard-first-results.json` record actual CLI/Bippy captures. Journey's initial trip-planning page matches exactly at 100% strict coverage with one passing replay. React na Pratica matches exactly at 100% strict coverage with one passing replay and two modeled states. Its own json-server serves the checked-in `server.json`; no substitute responses or application changes. The backend exits with the dev server, and port 3333 was verified closed afterward. React na Pratica uses pnpm 8.15.9 for its version-6 lockfile.
- Shadcn Admin initially had an opaque, un-analyzed RouterProvider. Adding the standard TanStack Router dependency allowlist broadened source analysis and exposed a real mismatch, rather than hiding it behind that opaque node. `dashboard-analyzed-results.json` records expected AuthenticatedLayout versus the runtime's Lazy wrapper, zero strict coverage, and two incomplete replays. The app's installed router plugin performs automatic code splitting; its ordinary function named Lazy is observable as a real Fiber and must not be ignored by comparison.
- The installed splitter reads `globalThis.TSR_ROUTES_BY_ID_MAP` using canonical source paths. Native configuration discovery passed `/tmp` or another directory symlink to the generator while the source graph used real paths. The registry lookup then silently skipped the installed transform. Two fixture regressions fail before the repair in `/tmp/bippy-vite-paths-before.log`, for symlinked root and dev directories.
- The repair canonicalizes existing directories in `locateViteConfig` before locating and loading configuration. It does not alter application source or comparison rules. All 35 focused path/config/mode tests pass in `/tmp/bippy-vite-paths-after.log`. The same Shadcn capture improves from mismatch to partial, 100% inclusive and approximately 46% strict coverage, in `dashboard-canonical-results.json`. Its recursive Outlet wildcard still skips 868 runtime fibers; both replays remain incomplete. This is not an exact match or a replay pass.
- React's cloned suspension handling and TanStack's installed `lazyRouteComponent.tsx` confirm that the Lazy wrapper is not merely a display-name difference. Multi-project ownership of TanStack's process-global registry, native configuration reads of process.cwd(), explicit config-file symlinks and remaining chart coverage still need tests. A separate finite context-recursion probe in `/tmp/bippy-probe-context-recursion.mts` reproduces the premature recursive Outlet cutoff: equivalent props trigger truncation despite changing provider values. `/tmp/bippy-context-recursion-before.log` retains that unresolved counterexample.
- Path repair validation: root typecheck/build, 2,920 root tests with two existing skips, 874 parser tests across 52 files, realm checks, changed-file lint/format/diff and documentation examples all pass. The documentation checker validates 42 links, two TSX examples, four server renders and two effect updates. Logs use `/tmp/bippy-vite-paths-*`. Identical Sentry/PostHog captures remain exact at 100% strict coverage with no replay contradictions, taking 28.695s and 179.543s. PostHog retains one incomplete replay. No performance attribution or completeness claim.
- Dashboard capture SHA-256 values: Shadcn `053f6a9ffa3a4c0be127ff21d6d4120d4d269889747a738ae891a5f0481bfea9`; Journey `b71a0d3e00d06f3ae6d8308fcba2a4655ceb0e4fcd18d67ec06c8ec1b83ab80c`; React na Pratica `56cc8fc5d85b51b7e4ee3973441281ec85394b7bb9c420ac3ee10e2108e592dc`. The committed corpus remains 215 configurations until provenance checks and import finish.

### Native Vite Node environment initialization checkpoint

- Reproduced the configuration-order gap: with `NODE_ENV` absent, native configuration produced `unset:unset:development`; with an empty value, it produced `::development`. Vite's CLI produces `development:development:development` in both cases. The fields identify module evaluation, configuration-function execution, and `configResolved`. Two regressions failed in `/tmp/bippy-vite-node-environment-before.log`.
- The loader now supplies the development default before loading configuration when `NODE_ENV` is absent or empty. It restores an unchanged temporary default before delegating to native `resolveConfig`. This preserves Vite's original presence check for dotenv handling. Explicit nonempty values are not replaced. Failure tests cover restoration of absent, empty, and `test` values.
- A blanket early default would suppress Vite's warning for `NODE_ENV=production` in a dotenv file. The fixture exposes a custom logger's warning count through a source transform and mixed React text children. The dotenv case verifies the warning remains observable, in addition to checking configuration timing. The helper's restoration comment explains the two-stage compatibility requirement.
- Independent captures start the installed Vite CLI and use Bippy. Absent, empty, `test`, `production`, and dotenv cases each match exactly at **100% strict coverage**, with one committed render and one passing replay. The explicit production case records a production React build; the other four record development builds. On these identical captures, detached `2dbacfcc` mismatches the absent, empty, and dotenv cases while **internal replay still passes**. Its explicit `test` and `production` cases already match.
- Evidence: `/tmp/bippy-check-vite-node-environment.mts`, `/tmp/bippy-vite-node-environment-final-{independent,baseline}.log`, and `/tmp/bippy-vite-node-environment-captures/{unset,empty,test,production,dotenv}-{capture,current-comparison,baseline-comparison}.json`. `provenance.json` records source and dotenv hashes, React 19.3.0, Node 24.21.0, and Vite 8.2.2. Earlier captures remain under `first/`; the comparison baseline is `/tmp/bippy-parser-pr115-node-env-baseline`.
- Final capture hashes: absent `329c5163874f5482e17eb95be2d73182188ecf9d155d846a76c5186a773200d2`, empty `0d76589233241ce35837a3024959cdcc5fe4ce8596d0e607dd743eba93837b78`, test `5fcd5f977285cf45d86b41f25ab8b0254e502d0ab3cbe4fb06fe33f28d0d6a56`, production `05138dce42fb9ecc2d07eafcba2ba1c4e08afdb4cb064a49c09a7e0db0f0ad84`, dotenv `5c43211c8c798ccc629146f31462289d6cd933b62923f1deea964072fe5c5613`.
- Full validation passes **2,908 root tests**, two existing skips, and **862 parser tests / 50 files**. Root typecheck/build, realm checks, lint/formatting and diff checks pass. Logs: `/tmp/bippy-vite-node-environment-root-{typecheck,tests}.log` and `/tmp/bippy-vite-node-environment-{parser-tests,build,realms,docs}.log`. The focused environment/mode/corpus checks pass 21 tests. Documentation checks pass 40 links and both executable examples. React's cloned `react-dom/npm/client.js` confirms the production/development entry selection and DevTools hook check ordering.
- Identical Sentry/PostHog captures remain exact/100% strict with zero contradictions in `/tmp/bippy-parser-corpus/vite-node-environment-results.json`: **42.396 s / 170.638 s**. Sentry has one passing replay; PostHog has two replays with one incomplete. No performance attribution or budget change is claimed.
- This repairs initialization for configurations that leave the default unchanged. Explicit `NODE_ENV` mutations or deletion during configuration, runner-supplied environment values, and asynchronous configuration side effects still need parity checks. The production capture verifies native configuration value preservation, not complete production application semantics: the interpreter's inlined `NODE_ENV` and Vite `DEV`/`PROD` defaults still need native resolved-environment integration. Direct SDK concurrency, custom prefixes, and unlisted-variable facts remain open.
- No repository additions: the corpus remains **212 distinct configurations**, and the **500-repository acceptance gate remains unmet**.

### Native Vite command-line mode checkpoint

- The native loader always called the configuration function in development mode and omitted the CLI override from `resolveConfig`. Interpreted `import.meta.env.MODE` could therefore disagree with native plugin output. Five initial regression failures are recorded in `/tmp/bippy-native-mode-before.log`.
- Reviewed installed Vite 8.2.2 `resolveConfig` and the bundled CLI implementation. The CLI passes `options.mode`; Vite uses that value when calling configuration, then gives it precedence over `config.mode` during plugin filtering and `configResolved`. `ViteConfigLocation` now retains the parsed CLI mode, and the native loader passes it to both stages. With no CLI override, the configuration function receives development mode and its returned mode remains effective. Empty configuration modes fall back to development.
- A proposed empty-mode success case was disproved by the real CLI: `--mode=` exits with a missing-value error before starting a server. The parser now rejects `--mode=`, bare `--mode`, and bare `-m` instead of silently falling back. Before failures: `/tmp/bippy-native-mode-missing-before.log`; independent rejection: `/tmp/bippy-native-mode-captures/empty-server.log`. This is not an accepted capture or a real-repository addition.
- The dedicated fixture verifies long, short and equals-form flags, explicit production mode, configuration fallback, `apply` filtering, and `configResolved`. All **33 focused checks** pass in `/tmp/bippy-native-mode-final-focused.log`. Mode and `NODE_ENV` remain distinct; a production mode does not force a production React build.
- Independent Bippy captures start the installed Vite CLI directly, rather than a substitute server. Default, staging and production modes each have one committed render, exact/100% strict coverage and one passing replay. All three captures report a development React 19.3.0 build. Detached `c5da0c82` still matches the default capture but reports **mismatch with passing internal replay** for staging and production, using the identical saved captures.
- Evidence: `/tmp/bippy-check-vite-mode.mts`, `/tmp/bippy-native-mode-{final-independent,baseline}.log`, and `/tmp/bippy-native-mode-captures/{default,staging,production}-{capture,current-comparison,baseline-comparison}.json`. `provenance.json` records source hashes, Node 24.21.0 and Vite 8.2.2. Capture hashes: default `1cf0b522abdbaa9582ce09c23f36a0f52441a70c268420b6505513f2fcee8eee`, staging `b953cb7f5852365000b9c40f4c60c2180c162d9160712f5456a3ef324b509f63`, production `577e533de70112e6b25ced936f30e12f7898e7ca24c7655506246ca9b0096020`. Baseline checkout: `/tmp/bippy-parser-pr115-mode-baseline`.
- Full validation passes **2,899 root tests**, two existing skips, and **853 parser tests / 49 files**. Root typecheck/build, realms, lint/formatting and diff checks pass. Logs: `/tmp/bippy-native-mode-root-{typecheck,tests}.log` and `/tmp/bippy-native-mode-{parser-tests,build,realms,docs}.log`. Documentation checks pass 40 links and both executable examples.
- Identical Sentry/PostHog captures remain exact/100% strict with zero contradictions in `/tmp/bippy-parser-corpus/native-mode-results.json`: **27.451 s / 164.794 s**. Sentry has one passing replay; PostHog has two replays with one incomplete. Timing changes still lack controlled causal attribution.
- Remaining build-environment work includes native resolved `env`, custom prefix arrays, configuration side effects and unlisted-variable facts. Audit `NODE_ENV` initialization before configuration: installed `resolveConfig` initializes it before `loadConfigFromFile`, while the adapter loads configuration first. The command parser is not a complete shell tokenizer; quoting and values containing additional equals signs still need tests. This checkpoint does not establish whole-space soundness or satisfy the **500-repository gate**; the corpus remains **212 configurations**.

### Corpus compiler environment checkpoint

- Four initial regressions failed in `/tmp/bippy-native-environment-before.log`. `readProcessEnvironment` discarded explicit manifest variables without `envFiles`; native Vite configuration and later transforms read the harness environment instead. A real installed Vite plugin produced `parent:parent|changed:changed` instead of the declared value with CI unset. Configuration failure also disappeared because the loader read the wrong variable.
- The corpus environment now retains explicit variables without a dotenv list and marks that map partial. Unlisted variables remain uncertain. `ProcessEnvironment.clientPrefix` can be omitted when client exposure is unknown; `null` still exposes no client variables. Prefix inference recognizes declared CRA/Vite dependencies and Next frameworks rather than treating every SPA as Vite. Explicit `static.envPrefix` still overrides inference. This avoids turning unsupported client exposure into a false known `undefined`.
- Node-realm configuration reads declared private variables independently of the client prefix. Its focused regression failed before repair in `/tmp/bippy-native-config-realm-before.log`. Partial CRA macro environments preserve inherited compiler variables while applying declared overrides; complete declarations keep their prior behavior. The partial-macro regression failed in `/tmp/bippy-partial-macro-before.log`.
- Native corpus configuration and render stages use the same environment constructor as dev-server children. A per-renderer environment survives between configuration and transforms, while the harness environment is restored on success or failure. A serialized queue prevents concurrent entries from overwriting each other. Environment construction occurs inside the queue so a waiting entry cannot copy another entry’s temporary environment. Concurrent creation/rendering and recovery after a rejected configuration are covered. The pre-queue regression is `/tmp/bippy-environment-concurrency-before.log`; assertions compare environment identity as a boolean to avoid dumping host variables on failure.
- Independent browser captures use the normal installed Vite server API and Bippy, not synthetic fibers. Both omitted-CI and explicit-CI cases have one committed render, six compared nodes, exact/100% strict coverage, no opaque/wildcard coverage, and one passing replay. Browser observations confirm the application body ran normally; the static test confirms it did not run natively in the analysis process. Against those identical captures, detached `200d4629` reports **mismatch while internal replay passes** in both cases. This is another shared interpreter/replay defect that independent evidence detects.
- Final evidence: `/tmp/bippy-native-environment-captures/{no-ci,declared-ci}-{capture,comparison,baseline-comparison}.json`, `provenance.json`, and `/tmp/bippy-native-environment-final-{independent,baseline}.log`. Capture hashes are `beddd39d2a4640541c33d0c784f9641f332141c49d6383b11a19a39a989ce542` and `0d07a63f39a66e06197fb6121ddb9a0f3f047cac6e53966e66deeaeef0b9caec`. The fixture runs React 19.3.0 under Node 24.21.0 with bundled Vite 8.2.2. Earlier captures remain under `first/`. The verifier and normal-server launcher are `/tmp/bippy-{check-corpus-environment,environment-dev-server}.mts`; `/tmp/bippy-compare-environment-baseline.mts` reads the same saved captures through `/tmp/bippy-parser-pr115-environment-baseline`.
- Final validation passes **2,888 root tests**, two existing skips, and **842 parser tests / 48 files**. Root typecheck/build, realm checks, lint/formatting and diff checks pass. Logs: `/tmp/bippy-native-environment-final-root-{typecheck,tests}.log`, `/tmp/bippy-native-environment-final-{parser-tests,build,realms,docs}.log`. Documentation checks pass 39 links and both executable examples. Focused serialization/configuration checks are `/tmp/bippy-native-environment-serialized.log`.
- Unchanged saved captures remain exact/100% strict with zero contradictions: Sentry **27.031 s**, one passing replay; PostHog **173.610 s**, two replays with one incomplete; NLW **1.261 s**, one passing replay; shopping cart **0.610 s**, one passing replay. Results are `native-environment-final-results.json` under `/tmp/bippy-parser-corpus`, `/tmp/bippy-parser-ci-capture`, and `/tmp/bippy-parser-expansion`. The earlier pre-queue corpus check remains separate as `native-environment-results.json`. Different tooling environments prevent attributing timing changes to this patch.
- Remaining environment work: native Vite resolution does not yet supply its resolved `env`, custom prefix arrays, or configuration side effects to the interpreter. The native plugin loader still uses development mode rather than the parsed CLI mode. Interpreted configuration may retain uncertainty about an unlisted variable that the native dev-server environment knows is unset. Shell assignments, unlisted dotenv inputs, system-level environment reads, direct SDK concurrency, and cached configuration need separate checks. These repairs do not establish complete environment parity.
- No real-repository additions in this checkpoint: the corpus remains **212 distinct configurations**, below the 500-repository gate.

### Await microtask ordering checkpoint

- Independent Bippy capture exposed another shared interpreter/replay defect. Awaiting a primitive or an already settled promise continued synchronously. The model produced `entered,primitive,settled,sync,queued,between`; the application produced `entered,sync,queued,primitive,between,settled`. Internal replay still reported `sample-passed`. Before evidence: `/tmp/bippy-await-ordering-before.log`.
- `getAwaitPromise` replaces the pending-only lookup. Leading modeled awaits now subscribe a continuation even for primitives and settled promises. The interpreter no longer drains queued microtasks merely to avoid suspension. Evaluating an operand that throws still enters its catch synchronously; a rejected promise resumes catch/finally through a reaction job. Escaped and unknown operands retain their conservative handling.
- New fixtures cover primitive/settled ordering, successive awaits with intervening microtasks, synchronous throws versus asynchronous rejection, and guarded async registration. The structural registration check rejects readiness on a path that never called the async function. Narrow lint directives retain the deliberately awaited primitive rather than deleting the behavior under test.
- Full parser validation passes **831 tests / 47 files** in `/tmp/bippy-await-full.log`. Root validation passes **2,877 tests**, two existing skips; root typecheck/build, realms, changed-file lint/formatting and diff checks pass. Logs: `/tmp/bippy-await-root-{typecheck,tests}.log`, `/tmp/bippy-await-{build,realms}.log`. Final focused checks pass in `/tmp/bippy-await-final-focused.log`. Documentation checks pass 36 links and both executable examples in `/tmp/bippy-await-docs.log`.
- Identical captures remain exact/100% strict with zero contradictions: Sentry **28.972 s**, one passing replay; PostHog **221.024 s**, two replays with one incomplete; NLW **1.468 s**, one passing replay. Results: `/tmp/bippy-parser-corpus/await-results.json` and `/tmp/bippy-parser-ci-capture/await-results.json`. PostHog timing variability remains unresolved.
- This covers modeled leading awaits, not complete async semantics. Thenable assimilation, operands that branch between promises and values, non-leading/concise-body await expressions, continuation ownership and repeated calls using the same await AST still require audit. The existing statement-replay mechanism and global resolved-await map need explicit ownership tests before stronger claims.

### Corpus option fidelity and child environment checkpoint

- Added the missing `servedDirectory` schema member. Manifest, entry, static-target and comparison schemas now reject unsupported keys instead of discarding them. The checked-in manifest must survive parsing unchanged. All five new regressions fail before the repair in `/tmp/bippy-corpus-config-before.log`; all 11 manifest checks pass afterward.
- Reviewed and integrated the individual `c8009af7` change after a real-child regression reproduced the forced CI flag. Dev servers drop inherited `CI` and use only an explicitly declared value. Install/setup commands still default to `CI=1`, with entry overrides retained. Tests launch a TypeScript child through tsx and check the selected environment, an actual HTTP server, cleanup and package-manager variable filtering. Before: `/tmp/bippy-corpus-child-environment-before.log`; 15 focused checks pass in `/tmp/bippy-corpus-config-and-environment-after.log`.
- Root validation passes **2,873 tests**, two existing skips, including **827 parser tests / 47 files**. Root typecheck/build, realms, changed-file lint/formatting and diff checks pass. Logs: `/tmp/bippy-corpus-config-root-{typecheck,tests}.log`, `/tmp/bippy-corpus-config-{build,realms}.log`.
- Identical Sentry/PostHog captures remain exact/100% strict with zero contradictions. Sentry takes **28.351 s** with one passing replay; PostHog takes **181.306 s**, with two replays and one incomplete. Results: `/tmp/bippy-parser-corpus/corpus-config-results.json`. These checks do not establish a repair of Saleor's historical row, whose original capture was not rerun.
- Made a second NLW capture with no declared CI in a separate directory, `/tmp/bippy-parser-ci-capture`, while the harness had `CI=1`. The application still matches exactly with 100% strict coverage and one passing replay. The fresh install/capture/analysis run takes **7.851 s**. No tracked source or lockfile changes. New capture SHA-256: `a1191c5186a2bcdfc6b9e7a809189773692751fd49344207a5205b1c3673400a`; lock SHA-256 remains `931406ca92d067af4a04ff71a957991a5c677fc0510bd68f12af29db37f24c7e`. The earlier CI-declared capture remains untouched in `/tmp/bippy-parser-expansion`.
- Imported the no-CI NLW configuration and new results. The corpus now has **212 distinct repository configurations**. All 211 previous manifest/result records remain unchanged by deep comparison; the post-import manifest check passes in `/tmp/bippy-nlw-corpus-validation.log`. Five fresh repositories add four exact capture matches and one truncated result, not 500-repository acceptance.
- **Open environment gap:** `readProcessEnvironment` returns `undefined` when no `envFiles` list is supplied, even when the entry declares environment variables. Native Vite configuration/plugin loading also uses the harness environment rather than an explicit per-entry environment. The child-process repair does not establish complete compiler/environment parity; add a configuration-sensitive regression before claiming that. Saved captures with changed environments remain separate evidence.
- Further audit candidates, not repaired claims: promise/thenable assimilation and `await` microtask ordering; captured scope and repeated-task ownership; optimized scalar host text/props, which the current snapshot/comparison can omit; corrected symbolic-model coherence and preferred matches beyond enumeration.

### Four fresh corpus captures

- Reviewed four configurations from `f96ae422` and made fresh Bippy application captures rather than importing the worker's results. Both temporary manifests explicitly declare `CI=1`. The four configurations and their current results are now imported into the checked-in corpus. It has **211 distinct repository configurations**, up from 207. A deep comparison confirms that all 207 existing manifest and result records are unchanged. `corpus-manifest.test.ts` passes six checks; log: `/tmp/bippy-four-fresh-corpus-validation.log`.
- `react-ecommerce-store` is exact/100% strict with one passing replay. `react-shopping-cart` is now exact/100% strict with one passing replay after the macro repair.
- `next-ecommerce-shopco` is exact/100% strict, with 25 states and 13/13 replays. Four replays remain incomplete. `multimart-react-ecommerce` is **truncated**, despite 100% strict capture coverage: 514 counted states, 256 enumerated, 326 omissions, 16/254 sampled assignments, all 16 incomplete. Neither result proves whole-space soundness.
- All four repositories retain unchanged application source. Installation changed the package locks in both CRA stores and Multimart; Shopco has no tracked changes. The lock diffs remain in `/tmp/bippy-parser-expansion/.out/*-install.patch`. Fresh capture/lock hashes and revisions are also recorded in `/tmp/bippy-parser-expansion/fresh-provenance.json`.

| Entry                       | Revision                                   | Capture SHA-256                                                    | Installed package-lock SHA-256                                     |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `react-shopping-cart`       | `9fa56244d0f0c0d363cab744a3305c50eabc08cb` | `5a901b7ddf90c1817653bbec2d94bc98d58588692ced512f0f5d943830518fff` | `1450db6147463fdd747a051af3182e28ce97a7a260dd1a16cbe4449245ef6fdc` |
| `react-ecommerce-store`     | `ae46562743b2e350cfd52deab3f831008a9fcedf` | `e558baf5d1eb6269f28487d60ad91cb2de8273b83935e844fb5a9815ffd1816f` | `0758f7940f69ea9887cb0c9d3382c5e4d6e7ac2fe1e14acb2b5d834f6d06b0d3` |
| `next-ecommerce-shopco`     | `f360acb62dbccdeb421d0c261652deedc74829fd` | `1fe29d758dbb3d99cad52d0ffaf834882ed4d9a8cebf09fd0fd7337f23208ea6` | `b45d88da46417676045beccb6004d971cfcd6eca984bc9ed769b2c29ddddbb03` |
| `multimart-react-ecommerce` | `4bb42e5a59afa971cb97209f151324a2442430dd` | `b9ee2c92c2260472453aa51a531dba8c19def63c813e542b65c87195eb9e2d24` | `e6dbaf9093df277b835122b42ae63202d56d3d5f1dc21362c2f25d7e9ca7ebf6` |

### Live corpus expansion setup history

- Extracted unmerged manifest entries from `f96ae422` into `/tmp/bippy-ecommerce-new-entries.json`. These are worker-reported configurations, not fresh verification results.
- Started fresh captures for `react-shopping-cart` and `react-ecommerce-store`, pinned to the worker revisions, under `/tmp/bippy-parser-expansion`. The temporary manifest is `/tmp/bippy-expansion-manifest.json`; it declares `CI=1` explicitly for both dev servers. Static environment propagation still needs the audit recorded above. Neither repository needs application source changes.
- Job PID file: `/tmp/bippy-expansion-first.pid`; log: `/tmp/bippy-expansion-first.log`; results: `/tmp/bippy-parser-expansion/first-results.json`. The job began after the serial Sentry/PostHog check. Do not count either repository as verified until its result is reviewed. These are new captures, not identical-capture reproductions of worker evidence.
- The first run completed: `react-ecommerce-store` is exact with one passing replay; `react-shopping-cart` is partial because its styled-components macro output is not modeled. Both were subsequently added to the checked-in manifest/results with Shopco and Multimart, as recorded above.
- Saved capture SHA-256: shopping cart `5a901b7ddf90c1817653bbec2d94bc98d58588692ced512f0f5d943830518fff`; game store `e558baf5d1eb6269f28487d60ad91cb2de8273b83935e844fb5a9815ffd1816f`. Captures are in `/tmp/bippy-parser-expansion/.out/`.
- Installation changed both package locks, but no application source files. Lock SHA-256: shopping cart `1450db6147463fdd747a051af3182e28ce97a7a260dd1a16cbe4449245ef6fdc`; game store `0758f7940f69ea9887cb0c9d3382c5e4d6e7ac2fe1e14acb2b5d834f6d06b0d3`. The `.out/*-install.patch` files preserve the dependency changes. Do not describe these as byte-identical dependency installations of the worker evidence.
- Reviewed the installed styled-components 5 macro, babel-plugin-macros config lookup, and React's `ReactForwardRef.js` display-name behavior. Worker `81c588cb` models the macro as an alias and manually reads its options, but its static-only fixtures use styled-components 6, which does not ship the macro. Its handling of custom `importModuleName` also needs review. Prefer the actual installed build transform where the bundler enables macros; do not blindly apply the alias to an unavailable module.
- The worker's `react-movies` entry rewrites application URLs with `sed` and depends on a custom server script. Do not import that setup blindly or count it as an unmodified pinned application. The React-15 entry cannot satisfy a real-Fiber verification gate.

### Additional pending-worker review

- `c0d5d649` adds finite-number checks to comparison guard derivation. The current interpreter already has equivalent checks, so no source integration is necessary. Its fixture is not currently present; no new corpus repair follows from this review.
- `c8009af7` removes the implicit `CI=1` override from dev servers while keeping installs noninteractive. Its individual change is now integrated after deterministic real-child tests, full validation and a separate new NLW capture. Existing saved captures remain old-environment evidence; broader native compiler environment propagation is still open.
- These are individual changes from the pending tips, not reviews or merges of either complete worker branch.

## 20. Complete checked-in corpus ledger

Snapshot of `packages/parser/corpus/results.json` at `3c2db5d8`; the local review fixes have not regenerated it. This table is historical evidence, not a fresh rerun. The manifest also contains 207 distinct repository URLs.

`Strict` is the report's concrete-fiber coverage percentage. `States` is the stored state count where available. `Replay` is sampled assignments / reported assignments; `—` means no summary, not success. `Mismatch` is the number of recorded replay mismatches, including corrected ones. See sections 1, 7, and 8 before interpreting `exact` rows.

Some older successful records store zero states or lack state metadata entirely. Those values are reproduced below as historical accounting gaps, not assertions that an application has no reachable states.

| Entry                             | Framework    | Status      | Strict |         States | Replay | Mismatch |
| --------------------------------- | ------------ | ----------- | -----: | -------------: | -----: | -------: |
| 2048-in-react                     | next-pages   | exact       | 100.0% |              0 |      — |        — |
| actual                            | react-router | mismatch    |   0.0% |             32 |  10/10 |        0 |
| admin-one-react-tailwind          | next-app     | exact       | 100.0% |             21 |      — |        — |
| adrianhajdin-portfolio            | next-app     | exact       | 100.0% |              2 |      — |        — |
| answer                            | react-router | truncated   | 100.0% |             26 |      — |        — |
| ant-design-pro                    | spa          | partial     |  13.4% |          5,125 |      — |        — |
| antd-multipurpose-dashboard       | react-router | exact       | 100.0% |              0 |      — |        — |
| api-platform-admin                | spa          | static-only |      — |              — |      — |        — |
| app-router-playground             | next-app     | exact       | 100.0% |              — |      — |        — |
| argon-dashboard-react             | react-router | exact       | 100.0% |              0 |      — |        — |
| black-dashboard-react             | react-router | exact       | 100.0% |              0 |      — |        — |
| blazity-next-saas-starter         | next-pages   | exact       | 100.0% |              2 |      — |        — |
| bldrs-share                       | react-router | exact       | 100.0% |              1 |      — |        — |
| blinko                            | spa          | partial     |  10.9% |              1 |      — |        — |
| blocknote                         | react-router | mismatch    |   0.0% |              0 |      — |        — |
| bookshelf                         | react-router | exact       | 100.0% |              0 |      — |        — |
| boxyhq-saas-starter-kit           | next-pages   | exact       | 100.0% |              1 |      — |        — |
| bulletproof-react                 | react-router | exact       | 100.0% |              1 |    1/1 |        0 |
| cal-diy                           | next-app     | exact       | 100.0% |              6 |    2/2 |        0 |
| chadnext                          | next-app     | partial     |  90.4% |              0 |      — |        — |
| chakra-ui                         | spa          | partial     |  39.9% |          1,024 |      — |        — |
| chatbot                           | next-app     | partial     |  99.7% |              — |      — |        — |
| commerce                          | next-app     | static-only |      — |              — |      — |        — |
| contentful-blog                   | next-app     | static-only |      — |              — |      — |        — |
| copilotkit                        | next-app     | partial     |  90.5% |              — |      — |        — |
| craft-js                          | next-pages   | static-only |      — |              — |      — |        — |
| create-t3-app                     | next-app     | exact       | 100.0% |              1 |      — |        — |
| create-vite                       | spa          | exact       | 100.0% |              1 |      — |        — |
| cv                                | next-app     | exact       | 100.0% |              1 |      — |        — |
| data-table-filters                | next-app     | partial     |   5.7% |              0 |      — |        — |
| dazzle                            | spa          | exact       | 100.0% |              1 |      — |        — |
| decap-cms                         | spa          | exact       | 100.0% |              0 |      — |        — |
| developer-portfolio               | next-app     | truncated   | 100.0% |            782 |      — |        — |
| documenso                         | react-router | exact       | 100.0% |              2 |    1/1 |        0 |
| docusaurus-classic-ts             | spa          | exact       | 100.0% |              3 |      — |        — |
| draw                              | spa          | exact       | 100.0% |              0 |      — |        — |
| ecommerce-react                   | spa          | exact       | 100.0% |              1 |      — |        — |
| elysia-react-router               | react-router | exact       | 100.0% |              0 |      — |        — |
| ens-app-v3                        | next-pages   | mismatch    |   0.0% |         54,240 |      — |        — |
| ephe                              | react-router | exact       | 100.0% |              0 |      — |        — |
| epic-stack                        | react-router | exact       | 100.0% |              1 |    1/1 |        0 |
| excalidraw                        | spa          | partial     |   0.8% |              — |      — |        — |
| excalidraw-clone                  | spa          | exact       | 100.0% |              0 |      — |        — |
| excel-collab                      | spa          | truncated   | 100.0% | 96,932,462,625 |      — |        — |
| fastapi-template                  | spa          | exact       | 100.0% |              2 |      — |        — |
| fiora-app                         | spa          | static-only |      — |              — |      — |        — |
| flagsmith                         | spa          | partial     |  13.2% |              0 |      — |        — |
| flowise                           | spa          | truncated   | 100.0% |              0 |      — |        — |
| form-builder                      | next-app     | exact       | 100.0% |         68,097 | 16/255 |       16 |
| formbricks                        | next-app     | partial     | 100.0% |              — |      — |        — |
| foxel                             | react-router | truncated   | 100.0% |             15 |  16/26 |        5 |
| fragments                         | next-app     | exact       | 100.0% |              7 |    2/2 |        0 |
| gcn-nasa-gov                      | react-router | exact       | 100.0% |              0 |      — |        — |
| geeky-nextjs                      | next-pages   | exact       | 100.0% |              1 |    1/1 |        0 |
| giscus                            | next-pages   | static-only |      — |              — |      — |        — |
| github-profile-readme-generator   | next-app     | exact       | 100.0% |             10 |    8/8 |        0 |
| glide-data-grid                   | next-pages   | partial     |  43.2% |             20 |      — |        — |
| graphic-walker                    | spa          | partial     |   0.6% |              1 |    1/1 |        0 |
| graphiql                          | spa          | exact       | 100.0% |              4 |    2/2 |        0 |
| heyform                           | spa          | unresolved  |   0.0% |              0 |      — |        — |
| homarr                            | next-pages   | exact       | 100.0% |             28 |      — |        — |
| hooks-admin                       | react-router | partial     |   4.6% |              6 |    6/6 |        0 |
| hyper                             | spa          | static-only |      — |              — |      — |        — |
| insforge                          | spa          | partial     |  39.3% |              6 |      — |        — |
| invoify                           | next-app     | exact       | 100.0% |              6 |    1/1 |        0 |
| jsoncrack                         | next-pages   | exact       | 100.0% |              0 |      — |        — |
| karakeep                          | next-app     | partial     | 100.0% |              — |      — |        — |
| langchain-nextjs-template         | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| langfuse                          | next-pages   | partial     |  63.0% |              — |      — |        — |
| letterpad                         | next-app     | exact       | 100.0% |              1 |      — |        — |
| lexical                           | spa          | exact       | 100.0% |              3 |    1/1 |        0 |
| linkwarden                        | next-pages   | partial     |  81.8% |              — |      — |        — |
| lobe-chat                         | react-router | unresolved  |   0.0% |              — |      — |        — |
| magic-portfolio                   | next-app     | partial     |  89.3% |              0 |      — |        — |
| magic-resume                      | spa          | unresolved  |   0.0% |              0 |    1/1 |        0 |
| magicui-portfolio                 | next-app     | partial     |  98.9% |              0 |      — |        — |
| mantine-admin                     | next-app     | exact       | 100.0% |            175 |  16/72 |        9 |
| mantine-react-table               | next-pages   | exact       | 100.0% |    443,451,396 | 16/252 |       16 |
| markdown-to-image                 | spa          | partial     |  10.6% |              1 |    1/1 |        0 |
| material-dashboard-react          | react-router | exact       | 100.0% |              0 |      — |        — |
| material-kit-react                | react-router | exact       | 100.0% |             97 |  16/32 |        0 |
| material-react-table              | next-pages   | partial     |  88.3% |              5 |    2/2 |        0 |
| material-tailwind-dashboard-react | react-router | exact       | 100.0% |              0 |      — |        — |
| mathberet                         | spa          | static-only |      — |              — |      — |        — |
| mdsilo-web                        | next-pages   | partial     |  70.6% |          1,538 |      — |        — |
| mdx-editor                        | spa          | partial     |  38.5% |              0 |      — |        — |
| mern-ecommerce                    | spa          | exact       | 100.0% |              1 |      — |        — |
| mern-ecommerce-frontend           | react-router | exact       | 100.0% |              2 |      — |        — |
| mini-dashboard                    | spa          | partial     |  84.6% |              0 |      — |        — |
| morethan-log                      | next-pages   | exact       | 100.0% |              2 |    2/2 |        0 |
| morphic                           | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| mui-admin-dashboard               | react-router | partial     |  48.2% |              2 |    1/1 |        0 |
| museeks                           | spa          | mismatch    |   0.0% |          9,705 |      — |        — |
| navidrome                         | spa          | exact       | 100.0% |              3 |      — |        — |
| next-enterprise                   | next-app     | exact       | 100.0% |              0 |      — |        — |
| next-forge                        | next-app     | static-only |      — |              — |      — |        — |
| next-landing-starter              | next-pages   | partial     |  98.1% |              0 |      — |        — |
| next-mdx-blog                     | next-app     | partial     |  13.7% |              1 |    1/1 |        0 |
| next-shadcn-dashboard-starter     | next-app     | partial     |  95.7% |              0 |      — |        — |
| nextjs-blog-boilerplate           | next-pages   | exact       | 100.0% |              2 |    2/2 |        0 |
| nextjs-boilerplate                | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| nextjs-examples                   | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| nextjs-mdx-blog                   | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| nextjs-notion-starter-kit         | next-pages   | exact       | 100.0% |             36 |  16/72 |        0 |
| nextjs-postgres-auth-starter      | next-app     | exact       | 100.0% |              1 |      — |        — |
| nextjs-postgres-nextauth-template | next-app     | exact       | 100.0% |              1 |      — |        — |
| nextjs-saas-starter               | next-app     | exact       | 100.0% |              0 |      — |        — |
| nextjs-starter                    | next-app     | unresolved  |   0.0% |              — |      — |        — |
| nextjs-starter-kit                | next-app     | exact       | 100.0% |              0 |      — |        — |
| nextjs-velite-blog-template       | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| nextly-template                   | next-app     | exact       | 100.0% |              5 |    2/2 |        0 |
| nextsimplestarter                 | next-app     | exact       | 100.0% |              4 |    2/2 |        0 |
| noteworthy                        | spa          | partial     |  27.5% |            104 |      — |        — |
| notion-blog                       | next-pages   | exact       | 100.0% |              1 |    1/1 |        0 |
| novel                             | next-app     | mismatch    |   0.0% |              — |      — |        — |
| open-react-template               | next-app     | exact       | 100.0% |              2 |      — |        — |
| open-resume                       | next-app     | partial     |  85.0% |            261 |      — |        — |
| open-tacos                        | next-app     | truncated   | 100.0% |    312,998,400 |      — |        — |
| openai-translator                 | react-router | partial     |  99.8% |              0 |      — |        — |
| openchakra                        | next-pages   | partial     |   0.1% |              — |      — |        — |
| openstatus                        | next-app     | partial     |  40.2% |              3 |      — |        — |
| pagescms                          | next-app     | exact       | 100.0% |              2 |    2/2 |        0 |
| panwriter                         | spa          | exact       | 100.0% |             14 |      — |        — |
| pdfme                             | react-router | exact       | 100.0% |             18 |      — |        — |
| personal-site                     | next-app     | exact       | 100.0% |              2 |      — |        — |
| pixel-art-react                   | react-router | partial     |  97.5% |          1,584 |      — |        — |
| pizza-man                         | spa          | exact       | 100.0% |              2 |      — |        — |
| plane                             | react-router | partial     |  91.2% |              — |      — |        — |
| planka                            | react-router | exact       | 100.0% |              1 |      — |        — |
| plate-playground                  | next-app     | partial     |   0.4% |              0 |      — |        — |
| playground-macos                  | spa          | exact       | 100.0% |              1 |    1/1 |        0 |
| posthog                           | spa          | exact       | 100.0% |              6 |    2/2 |        0 |
| puck                              | next-app     | exact       | 100.0% |              2 |    1/1 |        0 |
| purity-ui-dashboard               | spa          | exact       | 100.0% |              0 |      — |        — |
| rapidraw                          | spa          | static-only |      — |              — | 16/256 |       16 |
| react-admin                       | react-router | exact       | 100.0% |             21 |    4/4 |        0 |
| react-admin-dashboard             | spa          | partial     |   4.2% |              3 |    1/1 |        0 |
| react-arborist                    | next-pages   | partial     |  12.5% |              0 |      — |        — |
| react-compiler-playground         | next-app     | partial     |  95.6% |             36 |      — |        — |
| react-data-table-component        | spa          | partial     |  13.5% |              0 |      — |        — |
| react-datasheet-grid              | spa          | partial     |  97.4% |              0 |      — |        — |
| react-ecommerce-client            | react-router | exact       | 100.0% |              3 |      — |        — |
| react-email                       | next-app     | partial     |  19.9% |              0 |      — |        — |
| react-hook-form                   | react-router | exact       | 100.0% |              1 |      — |        — |
| react-material-admin              | react-router | exact       | 100.0% |              8 |    4/4 |        0 |
| react-phone-e-commerce            | spa          | exact       | 100.0% |              2 |      — |        — |
| react-router-better-auth          | react-router | exact       | 100.0% |              0 |      — |        — |
| react-router-templates            | react-router | exact       | 100.0% |              2 |    1/1 |        0 |
| react-spreadsheet                 | spa          | exact       | 100.0% |              1 |    1/1 |        0 |
| react-starter-kit                 | spa          | unresolved  |   0.0% |              0 |    1/1 |        0 |
| react-three-next                  | next-app     | exact       | 100.0% |              — |      — |        — |
| react-video-editor                | next-app     | partial     |   0.4% |    114,819,096 | 16/256 |       16 |
| react-virtuoso                    | spa          | partial     |  80.8% |          4,353 |      — |        — |
| reactive-trader                   | spa          | partial     |  67.6% |        127,344 |      — |        — |
| redash                            | spa          | static-only |      — |              — |      — |        — |
| redux-toolkit                     | spa          | exact       | 100.0% |              1 |    1/1 |        0 |
| regex-vis                         | react-router | truncated   | 100.0% |              0 |      — |        — |
| remix-blocks                      | react-router | mismatch    |   0.0% |              0 |      — |        — |
| remix-fastify                     | react-router | partial     |  99.1% |              0 |      — |        — |
| remix-shadcn                      | react-router | exact       | 100.0% |              0 |      — |        — |
| rustpad                           | spa          | exact       | 100.0% |             12 |    4/4 |        0 |
| saas-boilerplate                  | next-app     | exact       | 100.0% |              0 |      — |        — |
| saasfly                           | next-app     | partial     |  98.1% |              0 |      — |        — |
| saleor-dashboard                  | spa          | partial     |  74.3% |              0 |      — |        — |
| sentry                            | react-router | exact       | 100.0% |             52 |  16/40 |        9 |
| shadcn-chat                       | next-app     | partial     |  49.4% |              0 |      — |        — |
| shadcn-crm-dashboard              | next-app     | partial     |   0.3% |              2 |    1/1 |        0 |
| shadcn-landing-page               | spa          | truncated   | 100.0% |              0 |      — |        — |
| shadcn-landing-page-nobruf        | next-app     | partial     |  95.5% |              0 |      — |        — |
| shadcn-ui                         | next-app     | exact       | 100.0% |              0 |      — |        — |
| shadcn-ui-sidebar                 | next-app     | exact       | 100.0% |              4 |    1/1 |        0 |
| skolaczk-next-starter             | next-app     | exact       | 100.0% |              4 |      — |        — |
| social-media-app                  | react-router | exact       | 100.0% |              4 |      — |        — |
| social-network-client             | spa          | exact       | 100.0% |              2 |      — |        — |
| socialecho                        | react-router | partial     |  94.7% |              7 |    6/6 |        0 |
| soft-ui-dashboard-react           | react-router | exact       | 100.0% |              0 |      — |        — |
| sokuji                            | spa          | partial     |  98.8% |          1,281 |      — |        — |
| sonner                            | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| sqlrooms-ai-agent                 | spa          | exact       | 100.0% |              5 |      — |        — |
| standardnotes                     | spa          | mismatch    |   0.0% |              2 |      — |        — |
| start-ui-web                      | spa          | unresolved  |   0.0% |              0 |      — |        — |
| startup-nextjs                    | next-app     | exact       | 100.0% |              1 |      — |        — |
| tailwind-dashboard-template       | react-router | exact       | 100.0% |              1 |      — |        — |
| tailwind-landing-page-template    | next-app     | exact       | 100.0% |              1 |      — |        — |
| tailwind-nextjs-starter-blog      | next-app     | exact       | 100.0% |              4 |      — |        — |
| tanstack-query                    | spa          | exact       | 100.0% |              1 |    1/1 |        0 |
| tanstack-router                   | spa          | exact       | 100.0% |              2 |    1/1 |        0 |
| tanstack-table                    | spa          | exact       | 100.0% |             64 |  16/64 |        0 |
| tanstarter                        | spa          | unresolved  |   0.0% |              0 |      — |        — |
| taxonomy                          | next-app     | exact       | 100.0% |              3 |    3/3 |        0 |
| teable                            | next-pages   | partial     |  98.1% |              — |      — |        — |
| texlyre                           | spa          | partial     |  96.2% |             38 |      — |        — |
| tldraw                            | react-router | partial     |   2.4% |              — |      — |        — |
| tooljet                           | spa          | static-only |      — |              — |      — |        — |
| transform                         | next-pages   | exact       | 100.0% |             36 |  16/32 |        0 |
| tremor-dashboard                  | next-app     | partial     |  37.0% |              2 |    1/1 |        0 |
| trpc-next-app-dir                 | next-app     | exact       | 100.0% |              1 |      — |        — |
| ts-nextjs-tailwind-starter        | next-app     | exact       | 100.0% |              1 |      — |        — |
| twenty                            | react-router | partial     |  31.4% |              — |      — |        — |
| typebot                           | next-pages   | partial     |  71.0% |              — |      — |        — |
| typescript-nextjs-starter         | next-app     | exact       | 100.0% |              1 |    1/1 |        0 |
| unforget                          | spa          | exact       | 100.0% |              1 |      — |        — |
| uxie                              | next-pages   | partial     |  97.9% |    292,000,000 |      — |        — |
| whodb                             | spa          | partial     |  75.4% |          1,031 |      — |        — |
| windmill-dashboard-react          | spa          | exact       | 100.0% |              0 |      — |        — |
| word-master                       | spa          | exact       | 100.0% |              0 |      — |        — |
| zustand-demo                      | spa          | partial     |  11.3% |              1 |      — |        — |
