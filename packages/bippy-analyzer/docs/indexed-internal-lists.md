# Indexed engine-internal lists

`indexed-internal-lists.patch` replaces native iterators with indices in four engine algorithms:

- Function declaration instantiation: parameter names, variable declarations and names, lexical declarations and names, and functions to initialize.
- Block declaration instantiation: declarations and bound names.
- Argument evaluation: argument parse nodes and template substitution expressions.
- Resource disposal: the existing reversed resource snapshot.

These are engine-internal specification lists, not guest arrays or iteration protocols. Declaration order, reverse function precedence, binding initialization, spread iteration, template identity, and disposal completions remain in engine262. No result or declaration metadata is cached. The disposal list still uses `toReversed()` before invoking any disposer; additions to the original resource stack do not enter the active iteration.

The change removes generated iterator helpers from these loops. It also makes their positions explicit control locals rather than opaque native array iterators. That does not provide ownership or restoration of their elements, environments, resource stacks, or asynchronous work.

## Evidence

[Receipts](indexed-internal-lists-validation/summary.json) record:

- Eight new programs compared with independent V8 and the published engine, with argument elision both off and on in the source engine. They cover declaration precedence, lexical bindings, spread ordering and abrupt completion, template evaluation and site identity, reverse disposal, suppressed errors, and initialization failure.
- 917 local tests across 22 files; typecheck, root check, and relocated builds pass.
- The unchanged 74/74 smoke, 212/212 generator variants, and 557/559 parameter/arguments variants. Inputs, compiled hashes, and verdicts match the preceding control revision. The two parameter failures remain.
- Complete `using` and `await using` statement-directory comparisons with the published engine, including input and compiled hashes and raw diagnostics.
- Three local numeric diagnostic samples with a 3495.72 ms median, compared with 3908.49 ms at the preceding revision. Input SHA-256 remains `c10662bb40d9fc9ad0264cc67023f936466e3f403896c4afaef46b99cf24c126`.

Engine SHA-256: `d0eba416803f0d343b0eff7c897c5bee2502b5cbe2c8283623d61a1577e5ce9f`.

## Linux status

The preceding revision `0d1b9483` passes all 909 Linux unit tests but still fails the unchanged smoke at 72/74. Both numeric `substr` variants time out. Its failure-only profiles take 10136.59 ms by default and 10311.31 ms without Maglev. Logs and compressed profiles are retained in the receipts; diagnostic success under a longer limit is not a passing gate.

[Linux CI at `964f06c4`](indexed-internal-lists-validation/ci-indexed-failure.json) passes all 917 units but still fails both numeric smoke variants, for 72/74. All other CI jobs pass. Its AMD EPYC runner records 11632.47 ms by default and 11618.16 ms without Maglev in failure-only profiling. The preceding revision ran on an Intel Xeon; these runs are not a controlled performance comparison.

The Test262 timeout remains 10 seconds, unit timeout 5 seconds, and worker count two. No selection changed. Further performance work is needed. Additional local validation retains the historical 301/306 result and passes 152/152 weak-reference/finalization variants.

A separate attempt to preserve all generator-free host functions during lowering was rejected: 99 focused tests pass, but its local median is 4045.87 ms. Its source and measurements are retained, not used by the build.
