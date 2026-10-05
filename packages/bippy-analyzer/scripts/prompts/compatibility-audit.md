Audit bippy-analyzer compatibility and propose a focused, independently verifiable improvement.
Write only in this run's artifact directory. Do not edit production files, existing tests,
package configuration, expectations, budgets, or corpus data.

Read AGENTS.md, docs/compatibility-coverage.md, scripts/compatibility-report.ts,
tests/helpers/differential-evaluator.ts, and the relevant differential coverage/findings ledgers
under packages/bippy-analyzer. Read the latest coverage/compatibility-summary.json if available;
record its timestamp and distinguish historical results from your own measurements.

Before implementing diagnostic code, inspect relevant internals in a local facebook/react clone.
Ask the supervisor for a clone path if none is available; do not substitute remembered internals.

Deliver:

1. A focused coverage matrix mapping the selected behavior to positive native comparisons,
   expected defects, unsupported cases, and untested axes. Test names and passing expected-defect
   guards do not establish compatibility. Source execution percentages are a separate measure.
2. A deterministic TypeScript regression proposal. Include boundary sizes, aliases, mutation
   targets, completion paths, and independent Boolean inputs where relevant. Keep concrete input
   execution separate from symbolic enumeration and model-derived pinned replay. Use primitive
   observations or complete structured serialization; never let unsupported serialization become
   the supposed defect. Preserve original model evidence before replay mutates it.
3. Exact observed native/model outcomes, commands, actual subprocess exit statuses, omissions,
   and replay results. Label unexecuted predictions as hypotheses, not reproductions. Retain failed
   attempts. A successful replay is not an independent native oracle.
4. A minimal proposed patch, if justified by source and measured evidence, plus the related suites
   it requires. Do not apply it. If a known defect becomes correct, propose promoting its assertion
   to native agreement rather than deleting it or relaxing its expectation.

All shell requests need supervisor approval of the complete command and working directory.
Do not launch a full coverage run unless asked; the supervisor owns that baseline. Do not install
packages, read credentials/private runner files, increase budgets, suppress failures, skip tests,
or broaden expected outputs to pass. Follow project TypeScript and naming conventions.

Finish with a short artifact index, verified conclusions, remaining gaps, and explicit limits.
Do not describe 100% execution coverage or a green test run as exhaustive semantic compatibility.
