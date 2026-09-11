# Parser: progress, correctness ledger, and execution plan

## Goal

Build a maintainable, renderer-independent React source-analysis engine whose primary output is a **guarded symbolic tree of the UI states the program can produce**, with explicit input provenance, correlations, omissions, and evidence. Use real React fibers to verify those claims against applications running normally.

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

### Architecture documentation plan

The conceptual page at `docs/parser-architecture.md` explains the current parser implementation. It does not describe unfinished acceptance goals as supported behavior.

- Goal. Explain how source analysis produces React trees and what the comparison results establish.
- Audience. Contributors who know React and TypeScript but have not read the parser implementation.
- Content plan. Follow the explanatory structure of the [esbuild architecture document](https://github.com/evanw/esbuild/blob/main/docs/architecture.md). Start with design constraints and analysis phases. Explain module ownership, conditional evaluation, React rendering, symbolic states, comparison, and replay through implementation details and short TypeScript examples. Explain the reason for each design choice and link it to source. Keep limits explicit.
- Open questions. Corrected states do not update the original symbolic model. Task isolation, renderer coverage, event sequences, and whole-space completeness remain incomplete.
- Writing review. Apply the updated user rubric and ASD-STE100 principles. Use short sentences, active voice, consistent technical terms, and literal descriptions. Do not claim formal STE certification without a full vocabulary review.
- Validation. The page passes Markdown formatting and local link checks for 36 destinations and anchors. Both TSX examples compile and pass four React server renders plus two client effect checks. The related `correlated-guards` and `effect-cause-unmount` component regressions pass. `/tmp/bippy-check-parser-docs.ts` and `/tmp/bippy-parser-doc-example-tests.log` retain the checks. These are documentation checks, not a new whole-project acceptance run.
- Publication review. Human review and any pull request disclosure remain publication tasks, not completed checks.

### Immediate continuation

1. Review fixes are checkpointed at `80b8f278`, initial commit causes at `608d38ab`, guarded heap/read/N-way fixes at `c3b76b75`, predicate caching at `ac3d6a8c`, and replay claims at `985b78e0`. The guarded timer checkpoint `d9d6abc3` adds registration, cancellation, and task-only replay constraints. Architecture documentation is checkpointed at `a85cdf1e`. Promise/task journaling is checkpointed at `9562e79f`, adoption and cleanup ordering at `b845c6eb`, and CRA macros/bundled compiler versions at `3a21a706`. Nothing pushed.
2. Both saved captures still match with 100% strict coverage and no replay contradictions. Sentry is `sample-passed` (1 replay); PostHog is `sample-incomplete` (2 replays, 1 inconclusive missing-container path). Do not describe PostHog's entire sample as verified.
3. Root validation passes **2,873 tests**, with two existing React-19 DevTools skips; this includes **827 parser tests / 47 files**. Root typecheck/build, realm checks, lint and formatting pass. The latest serial corpus run takes 28.351 seconds for Sentry and 181.306 seconds for PostHog. Performance variability remains unresolved. P1/P2 and the 500-repository gate remain incomplete.
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
| Package                        | `packages/parser`, private `@bippy/parser`                             |
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
- `packages/parser/README.md`—partly stale; audit against code.
- `packages/parser/docs/exhaustive-states.md`
- `packages/parser/docs/tsc-graph-investigation.md`
- `packages/parser/corpus/manifest.json`
- `packages/parser/corpus/results.json`

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

| Entry | Revision | Capture SHA-256 | Installed package-lock SHA-256 |
| --- | --- | --- | --- |
| `react-shopping-cart` | `9fa56244d0f0c0d363cab744a3305c50eabc08cb` | `5a901b7ddf90c1817653bbec2d94bc98d58588692ced512f0f5d943830518fff` | `1450db6147463fdd747a051af3182e28ce97a7a260dd1a16cbe4449245ef6fdc` |
| `react-ecommerce-store` | `ae46562743b2e350cfd52deab3f831008a9fcedf` | `e558baf5d1eb6269f28487d60ad91cb2de8273b83935e844fb5a9815ffd1816f` | `0758f7940f69ea9887cb0c9d3382c5e4d6e7ac2fe1e14acb2b5d834f6d06b0d3` |
| `next-ecommerce-shopco` | `f360acb62dbccdeb421d0c261652deedc74829fd` | `1fe29d758dbb3d99cad52d0ffaf834882ed4d9a8cebf09fd0fd7337f23208ea6` | `b45d88da46417676045beccb6004d971cfcd6eca984bc9ed769b2c29ddddbb03` |
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
