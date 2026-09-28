# Deferred internal argument accessors

[CI at `fc53c74f`](https://github.com/aidenybai/bippy/actions/runs/36383433509/job/108803739157) passed all 739 analyzer tests. Its unchanged Test262 smoke passed 73/74 variants. The strict numeric `substr` case passed, but the default case still exceeded 10 seconds. `initial-ci-failure.json` preserves the failure log.

## Source change

`lazy-argument-accessors.patch` defers getter/setter construction in the private parameter map for non-strict mapped argument objects. The engine still creates the argument object, its visible properties, and its parameter map at function entry. It records pending parameter names instead of allocating internal builtin functions that application code may never use.

A map descriptor read creates the existing `MakeArgGetter` and `MakeArgSetter` functions. Those functions still delegate to the original environment’s binding operations. Argument reads, writes, definitions, and deletions keep their existing engine algorithms. Own-key enumeration materializes remaining map entries. Once no entries remain pending, the map uses its original internal methods again.

The map is not accessible to guest JavaScript. Its host-visible storage now distinguishes pending mappings from allocated accessor descriptors. Descriptor materialization is internal bookkeeping, not a guest property definition. It does not bypass the map’s existing write checks. The accessor functions retain the argument object’s original realm, even when another realm triggers materialization.

A debugger callback present at creation keeps eager accessor construction. Tests also cover deferred reads during debugger preview, rejected writes to an existing map, cross-realm access, alias updates, and numeric key order. These checks do not establish general debugger or heap-snapshot parity.

## Local measurements

`benchmark.json` records three runs per engine/scenario on macOS arm64, Node 26.4.0. It uses the same numeric matrix inputs and process limit as the preceding parameter-binding benchmark. The baseline is a separate checkout of `fc53c74f` with the same dependencies.

| Scenario | Baseline median | Candidate median |
| -------- | --------------: | ---------------: |
| Default  |      4494.45 ms |       3629.54 ms |
| Strict   |      3172.16 ms |       3255.59 ms |

The default case improved locally. The strict case did not. These measurements do not establish CI timing. The selected tests, two-worker setting, and 10-second timeout remain unchanged.

The local unit suite passes 746 tests across 13 files, including the existing V8 and Chromium comparisons. The unchanged Test262 smoke passes 74/74 variants. Relocated clean builds match, and typecheck, lint/format, and frozen offline installation pass.

The 559-variant parameter/arguments selection retains 557 passes and the same two legacy caller failures. The comparison reuses the preceding `fc53c74f` receipt at `../parameter-binding-validation/after.json`. The new `after.json` retains candidate diagnostics. Input hashes, compiled hashes, and verdicts match. The historical selection remains 301/306 with the same five failures. These failing commands still exit with code 1.

Full JavaScript, browser, and symbolic React parity remain unverified.
