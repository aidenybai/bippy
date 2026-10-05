Verify whether four existing symbolic defects escape pinned replay. Do the work, save evidence, and report; do not merely propose a plan.

Read AGENTS.md and tests/helpers/differential-evaluator.ts completely. Paths below are relative to packages/bippy-analyzer. The helper throws on a native/symbolic state-set mismatch BEFORE calling replayStateSpace, so its failures do not establish replay blindness. Concrete-input runs are not pinned-decision replay.

Use only the artifact directory supplied by the controller. Write TypeScript diagnostic scripts and JSON/Markdown/log evidence there. Run scripts with pnpm exec tsx from the package directory; calculate imports relative to the script. Follow repository coding conventions. Search a local facebook/react clone before implementing diagnostics; ask the supervisor for its location if needed. Do not install dependencies or access credentials, private controller files, HOME configuration, or secret environment values.

Select one existing failing case from each:

1. tests/generator-differential.test.ts: shared GENERATOR cursor, not an array iterator (native outcomes 10/20/30, modeled outcome 30).
2. tests/utc-date-differential.test.ts: conditional Date mutation and early return (epoch:0 versus contaminated epoch:1000).
3. tests/array-copy-branch-differential.test.ts: singleton toSorted copy isolation.
4. tests/descriptor-selection-branch-differential.test.ts: missing native `match` outcome.

Preserve exact existing case bodies. Identify suite/test, line, and parameters. Do not change the programs to make replay work.

Build a standalone diagnostic runner following the helper, but record native/symbolic disagreement instead of throwing before replay. Do not modify production sources, helpers, existing tests, dependencies, budgets, options, or checked-in corpus data. Do not call checkSymbolicCases as the top-level runner. Use fresh renderers per case and fresh derived interpreters per replay. Run cases sequentially.

For each case:

- Execute the exact source body natively with all four first/second boolean assignments in isolated Node VMs. Save assignment-to-output mappings.
- Symbolically render the same program as the helper. Save diagnostics, the complete raw StaticRenderResult, primary symbolic tree, enumeration states, omissions, and state-space metadata to disk BEFORE replay. Explicitly serialize Maps, including nested Maps. Shared references must have valid definitions or ancestor paths; do not silently truncate evidence.
- Record native and modeled outcome sets and missing/extra outcomes without aborting.
- If a valid state space exists, call existing replayStateSpace with default options even when outcomes disagree. Intercept its render callback only to capture supplied PinnedDecisions, raw replay render results, and structural text per replay. Never alter the decisions or analyzer behavior.
- Save the full replay summary and corrections separately; never replace original evidence with corrections.
- Report constructed assignments, attempted/replayed assignments, mismatches, incompleteness, and omissions. Only call model-derived assignments exhaustive when replayed equals assignments; these are not native input assignments.
- Classify as: contradiction detected; replay completed without detecting the demonstrated discrepancy; incomplete; analysis/enumeration prevented replay; replay crashed; or not executed with a reason. Distinguish tooling failures from analyzer errors.

Use tests/helpers/concrete-pattern-text.ts for structural text extraction. Preserve unknown-value and enumeration failures; do not fabricate state spaces. Explicitly discuss native paths omitted from the model, for which replay may have no assignments.

Deliver diagnostic.ts, per-case JSON, command/exit logs, and report.md with an evidence table and exact reproduction command. Run it and fix only your diagnostic tooling. Ensure the process terminates: standalone React renderers can retain scheduler MessagePorts; see scripts/render.ts for its shutdown precedent. Capture the actual command exit status, not a self-written intended status or the status of a trailing pipeline command. Preserve failed-attempt logs and use fresh attempt directories. Record git status --porcelain at start/end. Shell requests require supervisor approval. No full suite or shuffled runs are needed. Finish with concise results, uncertainties, and paths; do not claim general correctness or a repaired analyzer.
