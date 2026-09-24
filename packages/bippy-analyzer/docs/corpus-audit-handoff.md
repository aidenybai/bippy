# Corpus audit agent handoff

## Task and checkout

Continue PR #115's React program analysis work toward **500 distinct real GitHub repositories with audited acceptance**. The 500 imports are committed; 500 audited acceptances are **not** established. The user most recently asked to finish low-hanging repositories, move around blocked repositories, and continue without repeatedly asking about unrelated blockers.

Repository: <https://github.com/aidenybai/bippy>

Fetch and check out `handoff/parser-corpus-audit-18ef60c6`. The last corpus-work commit before this handoff document is `18ef60c626817dc6bfde5aba54179542a8426a12`.

**Do not substitute the original remote branch.** Pushing to `devin/1788659752-parser-package` was rejected as non-fast-forward. At handoff, local history was 88 commits ahead and one behind that remote. Its independent commit is `4047a1a9795d0dc78a72662884c6bab98def7c42`, “Preserve symbolic JSON and improve bottom-of-corpus coverage (#140).” It changes production code, tests, corpus files, and evidence. We did not merge, rebase, or force-push it. Our complete committed history was instead pushed to the handoff branch, and its remote SHA was verified. Any integration needs a separate review and revalidation; previous results do not validate #140.

Read these first:

- Repository `AGENTS.md`.
- `scratchpad.md`, especially its newest sections immediately before “20. Complete checked-in corpus ledger.”
- `packages/bippy-analyzer/README.md`.
- `packages/bippy-analyzer/docs/architecture.md` and `module-graph-research.md`.
- `packages/bippy-analyzer/src/corpus/{manifest,render-entry,run-entry}.ts` and `scripts/corpus.ts` before writing tooling.

The package is `bippy-analyzer`, described as “React program analysis.” The design is an upfront, renderer-independent causal model preserving causes, correlation, provenance, uncertainty, and omissions. A transition-system rewrite is not approved.

## What Git does and does not transfer

All commits owned by this work through that corpus-work SHA were pushed. The original machine also contains another agent's uncommitted differential-test work: five modified tracked files (`array-differential.test.ts`, `branch-differential.test.ts`, `completion-differential.test.ts`, `property-differential.test.ts`, and `helpers/differential-evaluator.ts`) plus numerous untracked differential tests/docs/helpers. These are **not ours** and were neither staged nor pushed. Do not infer their validation from our test counts.

**A Git checkout does not include the `/tmp` evidence, installed application clones, private candidate worktrees, or their node_modules.** The paths below are locators on the original machine, not downloadable artifacts. Obtain a scoped transfer before continuing a saved-capture scope or relying on its raw evidence. Do not silently recreate missing captures/models and call them historical evidence. Review logs/captures for sensitive content before publishing an archive; never include HOME configuration or credentials.

Important original-machine locations:

- Main checkout: `/Users/aidenybai/Developer/bippy`.
- Candidate selection: `/tmp/bippy-low-hanging-repositories-inventory.json`.
- Application clones/captures: `/tmp/bippy-parser-next-expansion/`, `/tmp/bippy-parser-game-expansion/`, `/tmp/bippy-parser-game-expansion-two/`, `/tmp/bippy-parser-utility-expansion/`, and `/tmp/bippy-parser-productivity-expansion/`. Saved captures live in expansion-root `.out/<id>.capture.json`.
- Latest complete replay evidence: `/tmp/bippy-small-sudoku-two-*`, `/tmp/bippy-small-next-pair-*`, `/tmp/bippy-small-next-warning-*`, `/tmp/bippy-small-followup-*`, `/tmp/bippy-small-todos-*`.
- Latest failed source-only scope: `/tmp/bippy-small-guess-*`.
- Earlier small batches: `/tmp/bippy-low-hanging-*`, `/tmp/bippy-small-calculator-*`, `/tmp/bippy-small-batch-*`, `/tmp/bippy-small-memory-*`, `/tmp/bippy-small-sudoku-*`.
- Deeper history: `/tmp/bippy-parser-recovered-context/` contains recovered conversations/handoffs. Scratchpad links many older receipts.

The final todo commit succeeded before a user interruption. Its format/15-manifest-test/stage gates passed. The subsequent post-commit audit was interrupted: `/tmp/bippy-small-todos-after-audit.log` was empty, with no completion receipt. Do not claim that audit passed. No known owned application/validation job remained active at handoff.

## Latest results

### `18ef60c6`: two todo replays and a source-only identity failure

Reviewed `joycefatima-todo-list`, `ignite-todo`, and `fullstack-adivinhe`: 76 authored text bodies, 97 displayed bounded chunks, 82 pinned tracked files, three preserved/parsed locks, three decoded PNGs. Selected installed-manifest checks covered 557 locations with no version differences and 83 absences. They do not establish transitive/native integrity or historical installation provenance.

- **Joyce:** first/reused/independent raw outputs and full models agree after excluding only validated snapshot/commit timestamps. One state, no omission/diagnostics. Two exact, non-exhausted CLI saved-capture replays, one assignment/replay each. Its three historical controlled-checkbox warnings remain unchanged; `emptyErrorGatePassed:false`. `onClick` is not `onChange` for React's warning condition. Do not repair it. Three initial incomplete tasks; length-based IDs can collide after deletion. Historical result fields structurally unchanged.
- **Ignite Todo:** same successful three-render continuity and two exact CLI stages, with empty capture errors. Starts with no tasks. Add uses clock-based IDs; delete uses `confirm`; interactions were not exercised. Historical `static.stats.modulesLoaded` changed **3757 → 3758**, unattributed; all other compared fields unchanged.
- **Adivinhe:** exactly three source renders, then failure at `/private/tmp/bippy-small-guess-tooling/validate.ts:100:14`, before capture comparison or CLI. Its `dynamic list index` input is **#1, #2, #3** across first/reused/independent renders. Each comparison has two raw differences: predicate strings in the final snapshot and second commit. Saved complete models are equal: six states, no omission/diagnostics. Enumeration equality does not repair raw inequality. No normalization, rerender, randomness reroll, capture comparison, CLI continuation, or production fix. Five-word random mount selection, StrictMode, ten-attempt limit, authored 200ms timer, alerts, and defaults remain unchanged. This demonstrates raw identity drift, not proven native-path corruption.

Evidence: `/tmp/bippy-small-todos-completion.json` (180 evidence paths), `/tmp/bippy-small-guess-failure-audit.json` (351 protected paths), and associated source/models/logs. Completion preparation initially failed a loop-lookup assertion before writing/running its audit; original source/log/exit remain beside the corrected successor.

### `d9ebd7f7`: Sudoku, Twitter, qualified Next search

- **`themaxsandelin-sudoku-react`:** three stable raw/full-model source renders; two exact/non-exhausted CLI replays; one state, no omission/diagnostics. Selection handlers never update the board (`setGameState` unused); no solver authored. 23 direct pnpm manifests checked, retaining full peer-qualified selectors separately. Historical fields unchanged.
- **`masterclass-react-twitter`:** same clean continuity and two CLI stages; one state. `/status` and interaction handlers read, not separately exercised. StrictMode remains authored-commented-out. 97 installed manifests checked, 21 absences. Historical `modulesLoaded` **1060 → 1061**, unattributed.
- **`ignite-performance-react`:** only one standalone source render. The helper's empty-diagnostic gate failed on two historical `next-config` warnings about `compiler.styledComponents`; both match the existing diagnostic artifact. Continuation typecheck retained two TS2451 errors from duplicate `space`; successor renamed that audit variable. The next run failed an incorrect one-state assumption: the frozen model has two states. Final continuation byte-reused that sole model, preserved warnings/states, checked projection, and ran two exact/non-exhausted CLI stages with two assignments/replays each. No additional standalone render, compiler/config repair, or renderer-continuity claim. Neither failed gate is reclassified as passed. Do not start or invent its localhost:3333 backend.

Evidence: `/tmp/bippy-small-followup-completion.json` (190 paths). These scopes total seven standalone renders, six CLI stages, three statistic controls, and zero installs/native starts/recaptures. The signed scratchpad-only checkpoint's post-commit audit passed for 684 protected paths and 246 production files; signature presence was checked, not independently verified.

### Earlier checkpoints

- `0b0877ff`: Madzadev calculator, mortgage, Lorenzo memory cards, Hesbon Sudoku. Twelve source renders/eight CLI stages; raw/full-model continuity and historical fields unchanged. Four statistic controls. Direct-only Yarn metadata for Hesbon. Imperative D3/ref DOM mutations, arithmetic, gameplay, storage, and visual/accessibility correctness remain outside these claims.
- `7d484ff0`: Fullstack Forms, Johnmwendwa calculator, Kanugurajesh calculator. Nine source renders/six CLI stages. Kanugu's controlled-textarea warning and failed empty-error gate retained; successor reused frozen models without rerender. Forms `modulesLoaded` **2 → 3**, unattributed.
- `c50490cb`: corpus expanded to 500 distinct nonfork repository IDs. Imports are not audited acceptance.

No latest batch reran the root suite or recomputed a global acceptance-gap count. Scoped format/manifest checks do not validate production semantics or the other agent's differential work.

## Required methodology

1. Keep sources, defaults, scripts, dependencies, lock bytes, launchers, routes, ports, budgets, inputs, storage, clocks, timers, and randomness intact. No invented credentials/services/APIs, dependency/peer/lock/compiler/Sass/cache/native-module repairs, or random rerolls.
2. Review authored bodies completely in bounded visible chunks, normally 1,300 characters. Inventories, hashes, reconstructions, and truncated searches are not reading. Parse and preserve locks without calling that full textual reading. Decode image assets separately; an authored screenshot is not fresh runtime evidence.
3. Use genuine **Bippy** for interpreted rendering and independent native capture. Never fabricate fibers, replace its hook, or execute application component bodies natively during analysis. Config/compiler/plugin execution is distinct; analysis is not a security sandbox.
4. Freeze source-only raw outputs and complete models before native capture. Saved-capture replay is not recapture; retrospective review cannot backdate approval or excuse post-native model strengthening.
5. Compare raw outputs and enumerated models separately. Exclude **only** validated `snapshot.capturedAt` and `commits[index].capturedAt`. Preserve statistics, application timestamp-named data, IDs, and declaration-array order. Never normalize IDs or arrays. `PatternReader.renameInput` can make enumerations equal despite raw differences.
6. Do not presume one state, zero warnings, or one replay. Record actual counts and diagnostics, retain failed gates, distinguish exact/partial/truncated/genuine mismatch/exhausted. Exhausted comparisons remain inconclusive even if sampled replay passes. Do not raise budgets.
7. Verify pinned tracked bytes, capture revision/schema/hash, installed metadata within its stated scope, production and corpus hashes, and repeat CLI fields structurally. Object-key serialization order is not structural difference; arrays/IDs/statistics must still be compared unchanged.
8. Keep every failure with immutable evidence (`flag:"wx"`, shell `set -C`) and fresh successor prefixes. Never rerun completed helpers, especially those asserting historical HEAD. Long jobs use `nohup`, scoped `caffeinate -i` where available, exit receipts, and at most two test workers. PID files are not proof of current ownership.
9. Stage only owned changes. Keep signing enabled. Never format `packages/bippy-analyzer/corpus/results.json`. Use `pnpm exec vp fmt --check`, not Prettier. Preserve unrelated work and the unrelated original-machine port-3000 website.

Useful CLI pattern:

```sh
pnpm --filter bippy-analyzer corpus \
  --manifest <isolated-manifest> --corpus-dir <isolated-directory> \
  --results <isolated-results> --static-only --skip-install <id>
```

There is no `--replay` flag. Isolate `.out`; compare CLI reports against direct comparisons with `rankWildcards(report.wildcards, 10)`. Import the exported `CorpusResult`, rather than guessing shapes. Results are `{results:[...]}`; errors are `pageErrors`; replay uses `verification:"sample-passed"`. Browser-capture `commits` is a number; static-render `commits` is a snapshot array. Package allowlists live at `static.externalPackageAllowList`.

Use TypeScript, interfaces, descriptive names, arrow functions, kebab-case files, minimal casts/comments, and pnpm per `AGENTS.md`. Clone `facebook/react` locally and consult relevant source before implementation. Original valid reference: `/tmp/bippy-ui10-react-reference`, revision `82c44beb444eda5230c063eaa163d01f38817211`. The older `/tmp/bippy-parser-pr115-react` was incomplete.

Tooling previously used sanitized PATH/HOME/LANG/SHELL, `COREPACK_ENABLE_STRICT=0`, and `TMPDIR=/private/tmp`, without credentials, CI, inherited NODE_PATH/NODE_OPTIONS. HOME is configuration-bearing: the original HOME `.npmrc` contains a token. Never display/copy/use its value or mutate that file. Do not treat sanitization as a sandbox or no-network proof. Pass SSH_AUTH_SOCK only to ordinary signing commits, not application/tooling launchers.

Owned analyzer installs used pinned pnpm 10.12.1 with `--offline --frozen-lockfile --ignore-scripts`; offline is not proof of no network. Do not substitute outer pnpm 11. Application runtimes are independently pinned by their reviewed recipes: ordinarily CRA Node 16.20.2 with npm 6.14.18 for v1 locks or npm 8.19.4 for newer locks; Vite ordinarily Node 22.16.0/npm 10.9.2. Numerous exceptions are documented in scratchpad. On another device, unavailable historical runtimes/installations remain evidence gaps, not permission to substitute or repair them.

## Parked work and non-authorizations

- **Adivinhe:** new raw identity-continuity failure above; leave parked while doing small eligible repositories.
- **Production identity migration:** not approved. Deferred binding candidate remains isolated at `/tmp/bippy-predicate-finalized-bindings-owned` and related `/tmp/bippy-task-cause-{regression,finalized,snapshot}-owned` worktrees. Candidate sources are not integrated or transferred by Git. It retains global evaluator identities and defers output projection, preserving public `snapshotFiberTree(rootFiber)`. Tested continuity improves, but historical Unforget has eight raw differences and ManyGames 790 raw/125 model differences per route. No history waiver or normalization.
- **Durable identity regressions:** `external-value-lifetime.test.ts` and `task-cause-inputs.test.ts` are committed. `it.fails.each` documents unrepaired production limits. Private candidates use the same assertions as ordinary tests. Conditional microtask fixture demonstrates retained-cause association/order defects; do not generalize that to proven real-app native-path corruption.
- **Mertiq:** unstarted pending specific permission for `NO_UPDATE_NOTIFIER=1`; npm 6 notifier can independently read HOME configuration. General continuation does not authorize an override.
- **Word Master:** sole installation mutated its lock; no repair/reinstall/downstream approval. Preserve build metadata differences.
- **Datasheet/Landing:** installs unapproved; existing version/peer/self-package risks and Landing drift remain.
- **2048:** unrelated port-3000 owner; no route/port substitution. Historical model/runtime/capture unavailable; two apparent captures were rejected fixtures.
- **Niinpatel:** pre-existing modified package.json, excluded and untouched.
- Five UI31 extras remain unimported. The userconfig `/dev/null` exception covered only their five reviewed launchers; Unforget's exception was installation-only, not a general permission.
- Unforget's original reused-renderer continuity failure, incomplete/exhausted corpus comparisons, historical post-execution reviews/strengthening, and 24 retained semantic limits remain documented. Do not erase them in an aggregate success statement.

Production integration requires semantic gates, 83 strict checks/24 retained limits, full-model continuity, 53 workflows, ten corpus controls, public API compatibility, and explicit format/history decisions. The 96 saved controls have **72 strict successes/24 limits but 81 exact reports**; those are different metrics. Historical root-suite counts exclude concurrent differential edits and some private wrappers; do not reuse them as current validation.

## Next actions

1. Confirm the handoff branch, read the ledgers, and identify which original-machine evidence was transferred. Keep missing evidence explicit.
2. If transferred, complete a fresh, separately recorded post-commit hash audit for the interrupted todo checkpoint; do not reuse the empty old receipt or claim it passed.
3. Continue installed, source-clean small candidates rather than blocked apps. Inventory leads include `ignite-feed`, `pyxel-dev-biorhythm`, `nlw-expert-react`, `ignite-next-auth-jwt`, `soniikot-memory-game-ts-strict`, `ignite-tailwind-next`, `nlw-moveit`, `bmi-calculator`, `alphapentagon-memory-game`, and `go-react-ama`. These are selection leads, not reviewed/approved/completed scopes. BMI has both npm and Yarn locks; retain both.
4. Complete authored review, freeze first/reused/independent source models, run unchanged saved-capture comparisons and isolated current/repeated static-only CLI stages where eligible, and preserve failures without rerolls. The existing temporary validators are templates, not resumable commands with current HEAD.
5. Record bounded results in scratchpad, run scoped format/manifest/diff gates, and commit only owned changes. The push request authorizes this handoff delivery; it does not waive unrelated runtime, history, integration, or repair restrictions.
