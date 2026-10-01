# Declarative binding roots

The binding audit found a garbage-collection bug in pinned engine262. After clearing kept-alive references and collecting, this observation returned `["object", false]`:

```ts
let retained = {};
var reference = new WeakRef(retained);
```

```ts
JSON.stringify([typeof retained, reference.deref() === retained]);
```

The object remained accessible through `retained`, but its weak reference had been cleared. Both the published engine and the selected-object checkpoint build reproduced the failure.

## Fix

`DeclarativeEnvironmentRecord.mark` passed its native `Map` to the engine marker. That marker does not traverse native maps. `declarative-roots.patch` instead marks each binding record. The existing record methods then mark direct values or indirect module targets.

This matters for checkpoints: a saved getter can be the only remaining reference to a closure whose captured binding holds a weakly referenced value. Marking the getter alone did not preserve that captured value before this fix.

This patch changes reachability, not binding restoration. There is still no binding checkpoint or general symbolic React branch isolation.

## Verification

- Five of six initial focused tests failed before the fix. The cleared-binding negative case passed.
- Eight focused tests now pass: global lexical values, block captures, parameter captures, symbols, saved getter captures, direct module bindings, forwarded module bindings, and release after clearing a binding.
- Positive observations compare against independent Node/V8 subprocesses using `--expose-gc` after a task boundary. Native module checks use data URLs; engine module checks use explicitly supplied file-URL artifacts.
- The cleared-binding check tests the engine’s explicit collector. It does not require V8 to collect unreachable objects at a particular time.
- The unchanged smoke passes 74/74. An additional 152 WeakRef/FinalizationRegistry variants pass in both published and source-built engines, with identical inputs and compiled hashes. Those upstream tests did not expose this bug.
- The local full suite passes 805 tests across 16 files. Typecheck, lint/format, and relocated build verification pass.
- The built engine SHA-256 is `7b638705724afba015103efa11308ad4e036b5b7129115564c6d89263425004f`.

[The summary](summary.json) records provenance, hashes, probe observations, and test counts. Raw failure and success logs remain in `validation-logs.json`. The separate [checkpoint CI receipt](../object-checkpoint-validation/ci-success.json) verifies the preceding 797-test revision. [This fix’s Linux analyzer job](ci.json) passed 805 tests and the 74-variant smoke. The workflow’s check job failed on `engine/scripts/build.ts` indentation. The later binding-checkpoint increment corrects that formatting error and reruns the root check.
