# Parameter binding optimization

[The initial ReactDOM CI run](https://github.com/aidenybai/bippy/actions/runs/36379764438/job/108792906414) passed 718 unit tests, including Chromium comparisons. Its Test262 smoke failed two of 74 variants. Both `substr/start-and-length-as-numbers.js` variants exceeded the existing 10-second timeout. `initial-ci-failure.json` preserves that failure log and its hash.

## Source change

`simple-parameters.patch` changes engine262’s `FunctionDeclarationInstantiation`. For simple parameter lists, it passes argument values to the existing `BindingInitialization` operation. It avoids constructing an internal generator and iterator-result objects for parameter binding. This does not replace application iterators or parameter coercions.

The engine still creates argument objects, environments, and parameter bindings through its existing algorithms. Duplicate parameters retain their existing environment selection. Missing arguments become engine `undefined` values. Defaults, rest parameters, and destructuring retain `IteratorBindingInitialization_FormalParameters`.

The original iterator path also remains active when a debugger callback is installed or the internal generator-next function has a breakpoint. Tests check both debugger configurations. The optimization does not cache bindings or change function bodies, React, or analyzer budgets.

The `substr` patch now uses an explicit branch for omitted length. This avoids completion-macro hoisting of an otherwise unobservable conversion of `undefined`. The prior intrinsic receipts remain historical records of their original patch bytes.

An earlier ordinary-property dispatch experiment gave little improvement and was rejected. No property-dispatch changes remain in the source build.

## Local measurements

`benchmark.json` records three runs per scenario and engine on macOS arm64, Node 26.4.0. Each process used the same input, one worker, and a 10-second limit. The inputs concatenate the pinned `assert.js`, `sta.js`, and unchanged numeric `substr` matrix. The strict scenario adds a strict-mode directive. The baseline comes from a separate checkout of `b116d2a3` with the same installed dependencies.

Median process wall times, including CLI startup and artifact verification:

| Scenario |   Baseline |  Candidate |
| -------- | ---------: | ---------: |
| Default  | 5249.58 ms | 3959.59 ms |
| Strict   | 4137.70 ms | 2876.62 ms |

These local measurements do not establish CI timing. The CI selection, two-worker setting, and 10-second timeout remain unchanged.

## Validation scope

The local unit suite passes 739 tests across 12 files. Added tests compare parameter values, argument aliasing, closures, constructors, generators, and fallback syntax with V8 and the published engine. The selected ReactDOM comparisons with Chromium still pass. The unchanged local Test262 smoke passes 74/74 variants.

The additional Test262 selection contains 559 variants from `language/arguments-object` and `language/expressions/function`. Both builds pass 557 and fail the same two legacy `arguments.callee.caller` tests. Both commands exit with code 1. `before.json`, `after.json`, and `summary.json` retain input hashes, verdicts, and separate diagnostics. No failed variant was excluded.

The historical 306-variant selection still passes 301 and fails the same five cases. The three tail-call and two Promise constructor failures remain unresolved.

Full JavaScript, browser, and symbolic React parity remain unverified.
