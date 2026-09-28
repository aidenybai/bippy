# Unused argument allocation

The CLI opts into omitting argument objects that guest code cannot reference. Default engine agents and the concrete analyzer runtime keep their existing argument bindings. This change does not extend the symbolic expression subset.

## Allocation rule and host limits

`AgentHostDefined.elideUnusedArguments` defaults to false. The CLI adapter re-exports the verified engine and enables this option for its agents. It does not replace JavaScript evaluation or the Test262 validator.

The source patch checks the raw function body and every formal parameter. Any occurrence of `arguments`, `eval`, or a backslash keeps allocation. The pinned parser retains raw source spans. The backslash check catches escaped identifiers, including `arg\u0075ments` and `e\u0076al`. Matches in comments, strings, and nested functions also keep allocation. These extra matches reduce optimization, not coverage.

The check uses the executed body and formal nodes, not function display text. Defaults and destructuring can read `arguments` before the body starts. Nested arrows can capture the outer binding. Direct eval can construct its identifier text at runtime. All retain allocation under this rule.

Debugger, node-observation, and evaluation callbacks present at function entry disable the optimization. A breakpoint on the internal generator `next` method also keeps allocation. Parameter binding, environments, and function instantiation otherwise use existing engine operations.

Do not enable this option in hosts that inspect unreferenced argument bindings or expose them through custom native callbacks. Omitted bindings cannot be recovered by later debugger activation. This is not general debugger or heap-inspection parity. The default remains false to preserve those host behaviors. The pinned engine’s existing legacy caller failures remain unchanged.

## Local validation

Node 26.4.0 on macOS arm64 passed:

- 766 unit tests across 14 files, including actual React and guest ReactDOM comparisons.
- 74/74 Test262 smoke variants with two workers and the unchanged 10-second timeout.
- Source and package typechecks, lint, formatting, and frozen offline installation.
- Two clean builds in different roots with identical artifacts.

The 559-variant parameter/arguments selection remains 557 passes and two failures. Input hashes, compiled hashes, and verdicts match the previous receipt. Both failures concern legacy `arguments.callee.caller`. The broader historical selection remains 301/306, with the same three strict tail-call failures and two Promise constructor failures.

Parameter tests compare the optimized engine, default concrete runtime, published engine, and independent V8 observations. Host tests check the default policy, explicit opt-in, entry-time callbacks, escaped parameters, defaults, and conservative string matches. The retained initial focused failure came from searching only the function environment. Default initializers put their argument binding in a separate parameter environment. The corrected test inspects both environments.

The bundle SHA-256 is `96eefcf1b15d2c61ec22e18cd16b73bc254fc103804bd843add502873e23749c`.

## Timing and Linux status

Three paired local runs alternate baseline and candidate order. They include CLI startup and integrity checks, use one worker, and retain the 10-second process timeout.

| Numeric `substr` variant | Baseline median | Candidate median |
| ------------------------ | --------------: | ---------------: |
| Default                  |      3574.47 ms |       2869.25 ms |
| Strict                   |      3190.68 ms |       2885.84 ms |

These timings are not Linux passing verdicts. Before this change, Linux run 36386405463 passed 72/74 smoke variants. Both numeric variants timed out. Its serial diagnostic profile took 11053.32 ms with default V8 flags and 11088.70 ms without Maglev. Diagnostic runs use a separate 30-second limit and cannot change the gate result.

The candidate’s Linux result is pending. The gate still uses its original selection, two workers, and 10-second timeout.

## Receipts

- `summary.json` records versions, policy defaults, hashes, selection, and verdict comparison.
- `after.json` retains each variant’s result and raw diagnostics. The prior receipt stays in `../lazy-argument-accessors-validation/after.json`.
- `benchmark.json` retains every paired local timing and process result.
- `initial-ci-failure.json` retains the Linux failure log. `initial-linux-profile.json` records diagnostic commands and platform details.
- `default.cpuprofile.gz` and `no-maglev.cpuprofile.gz` preserve the complete Linux profiles. The summary records compressed and original hashes.
- `validation-logs.json` retains final checks and the initial focused test failure.
- `rejected-benchmarks.json` retains the metadata-cache/lexical-environment, property-presence, identifier-lookup, and shared-descriptor measurements. None of those source changes remains in the build.
