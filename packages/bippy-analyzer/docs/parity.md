# Parity goal and current evidence

The goal is application and React parity, not a replacement JavaScript interpreter. Delegate parsing, execution, operators, coercions, built-ins, and exceptions to engine262 wherever possible. Reuse actual React and native toolchain behavior. Keep analyzer code focused on unknown values, guards, state ownership, host integration, and observations.

When engine262 cannot support a required behavior, prefer a reviewed engine fix or extension over a separate analyzer implementation. A passing test selection is evidence for that selection, not proof of full correctness.

## Current status

| Area                       | Evidence                                                                                         | Remaining gap                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Source-built engine        | Reproducible builds; original and extended engines both pass 301/306 selected Test262 variants   | Five retained failures; not full Test262 conformance                   |
| Guarded scalar expressions | Independent values, exceptions, guard partitions, and syntax-node traces                         | Boolean input domains only; no general numeric/string constraints      |
| Application loading        | Supplied native-built ES chunks execute with dynamic imports and top-level await                 | Resolver integration, assets, and browser bootstrap remain unfinished  |
| Concrete React             | Nine Test Renderer scenarios match V8; production/development DOM counters match V8 and Chromium | General browser host behavior and broader feature coverage             |
| Symbolic React             | Not implemented here                                                                             | Mutable state isolation, continuations, guarded trees, and transitions |

See the [implementation roadmap](../ROADMAP.md) for all stages. The scalar increment does not complete the React parity goal.

## Scalar parity gate

Run from the repository root with Node 26+:

```sh
pnpm --filter bippy-analyzer test --run
pnpm --filter bippy-analyzer typecheck
```

The current local suite passes **890 tests across 21 files**, using at most two workers. [Linux CI](https://github.com/aidenybai/bippy/actions/runs/36445049262) passed all jobs for the preceding binding-checkpoint revision, including 821 analyzer tests and the 74-variant smoke. The first control-continuation CI run passed 889/890 tests but timed out during the first checkpoint case’s cold load. Its Test262 step did not run. Vitest now loads the built engine natively instead of transforming it again. All 890 local tests pass without changing timeouts. [The failure and correction](control-validation/ci-failure.json) remain recorded; Linux confirmation is pending. The previous scalar and engine suite contains 651 of those tests. The dedicated `tests/scalar-parity.test.ts` selection includes:

- All 144 ordered pairs from 12 selected scalar literals for each of 23 binary/control operators. These produce 3,312 guarded expression templates and 13,248 Boolean witness runs per reference engine.
- 192 generated cases from three fixed seeds, containing 160 distinct expressions. Each uses three declared Boolean inputs and checks all eight assignments, for 1,536 additional witness runs per reference engine.
- Sixteen focused integer-boundary, shift, BigInt-error, and correlation cases.

The generated selection uses depth four and bounds exponent and shift operands during generation. This limits fixture cost without discarding failures. Its SHA-256 is `a29237ea49425e28851872523d257191b4e3d824118e712b3c76d8ccade01f7c`. The test fails if the selection changes or a generated source exceeds the API limit. No rejected or failing program is filtered out.

Other tests retain the earlier coercion matrix, unary operators, rejection boundaries, resource limits, serialization, realm isolation, source maps, and artifact checks.

For each concrete Boolean assignment, the oracle requires:

1. Exactly one matching outcome, with no undeclared guard inputs.
2. Every reported outcome and trace entry to have at least one concrete witness.
3. Values and exception names/messages to match the unmodified engine.
4. Values and exception names to match independent Node execution. Native error messages are not required to match engine262's wording.
5. The specialized syntax trace to match the unmodified engine's node types, text, source spans, and evaluation order.
6. A JSON round trip to preserve the report, including negative zero, infinities, `NaN`, and BigInts.

The reference engine executes each witness once. It observes error fields from the original completion rather than rerunning failing code. Its input bindings and parser are independent of the symbolic adapter. A separate test-side guard evaluator checks the serialized guard contract.

## Limits of this evidence

The literal matrix is exhaustive only over its selected literals and operators. Seeded syntax generation is not exhaustive over JavaScript. Syntax-node traces do not expose every internal specification operation, and value/error parity does not establish mutable heap or scheduler parity.

Calls, objects, property access, mutation, statements, loops, asynchronous work, and React remain outside this scalar contract. Budget exhaustion and unsupported syntax still fail rather than return partial success. The engine artifact and archived Test262 diagnostics are unchanged by these adapter tests.

## Concrete execution gate

The [concrete execution contract](concrete-execution.md) documents the new runtime and 54 additional tests. React and React Test Renderer 19.3.0 execute inside engine262. Native V8 runs the same bundles under an independently implemented restricted task host. The scenarios compare trees, state updates, lifecycle traces, cleanup, and selected error observations. A separate Node process verifies native-built ES module chunks and their dynamic imports. An invalid production-React/development-JSX build remains a negative fixture. Both engines report its render failure; its empty tree is not counted as a successful render.

The initial concrete implementation reused engine262's realm, calls, module cache, loader composition, parser, module linker, Promise jobs, and event loop. It added no engine patch, operator implementation, hook implementation, or reconciler configuration. Its engine bundle stayed unchanged. Four existing locked React/type packages became explicit test dependencies.

The subsequent DOM increment runs actual React DOM and guest-owned LinkeDOM. Production and development counter sequences match native V8 and Chromium, including HTML, lifecycle traces, state updates, and cleanup. Chromium uses the same component without the emulator and waits for an application effect checkpoint. This is selected browser evidence, not an equivalent browser host.

LinkeDOM exposed the pinned engine's missing Annex B `String.prototype.substr`. The maintained source patch reuses existing engine coercion and index operations. The [new Test262 selection](engine-substr-validation/summary.json) passes 30/30 on the built engine and 0/30 on the published engine. Inputs and compiled hashes match. The original 306-variant selection still has the same five failures. A 972-case scalar/UTF-16 matrix and six metadata/coercion checks match V8.

The DOM increment’s initial bundle SHA-256 was `c7a3899d06b4c54f6ff0a0e4c9d7781770a04293043cf7b636466434d5a98d36`. No analyzer string polyfill or dependency-source repair is used. Existing lockfile dependency records remain unchanged. New records supply pinned LinkeDOM dependencies; React DOM and Playwright use existing locked versions.

Guest exception diagnostics retain original values without implicitly serializing their realm and syntax graphs. Four tests cover cached error diagnostics, primitive throws, the global object, and effectful guest getters/coercion methods. The earlier formatter out-of-memory report remains recorded.

The task host still accepts zero-delay timers only. Queue draining is not a completion proof. These concrete tests do not broaden the symbolic-expression subset. Source-map remapping, full native resolver integration, general browser APIs, mutable branch state, symbolic React, and transitions between symbolic states remain unfinished.

## Linux timeout regression

At `c274ddc9`, [Linux analyzer CI](https://github.com/aidenybai/bippy/actions/runs/36393315028/job/108833815268) passes 766 unit tests and all 74 smoke variants. Both numeric `substr` variants pass with the original selection, two workers, and 10-second timeout. The previous run’s 72/74 failure and complete CPU profiles remain archived.

The CLI opts into omitting unreferenced argument bindings under a conservative source check. Default agents and the concrete analyzer runtime retain those bindings. [Allocation rules and receipts](unused-arguments-validation/README.md) document the host-inspection restriction, preserved eval/escaped-identifier behavior, rejected changes, and independent checks. That revision’s engine SHA-256 is `96eefcf1b15d2c61ec22e18cd16b73bc254fc103804bd843add502873e23749c`.

The additional parameter/arguments selection remains 557/559, and the historical selection remains 301/306. Passing the smoke does not establish full JavaScript, browser, or symbolic React parity.

## Selected object checkpoints

The [ordinary-object checkpoint contract](object-checkpoints.md) and its 31 tests add selected-object restoration without replacing JavaScript semantics. The tests compare aliasing, descriptors, property order, prototypes, integrity, and branch visitation order with published engine262 and V8 observations. Additional checks cover ownership, private-brand installation, garbage-collection roots, nested checkpoints, and prototype-cycle rejection.

This is storage restoration, not a suspended execution snapshot. Unselected objects, captured bindings, jobs, and host effects remain outside its scope. The [symbolic React checklist](symbolic-react-status.md) records those missing requirements. The checkpoint revision’s engine hash is `da115b2eeb8743868db509c127cdccfa49832490e61dce7a720a42eac8959d29`.

## Declarative binding roots

The [binding-root fix](declarative-roots-validation/README.md) makes the collector visit each declarative binding record rather than its native map. Before the fix, five focused checks lost weak references to values that remained accessible through bindings. Eight checks now pass, including saved getter captures and module bindings, with independent V8 comparisons for retained values.

Both published and source-built engines pass the additional 152 WeakRef/FinalizationRegistry variants. That upstream selection did not detect this bug. That revision’s engine hash is `7b638705724afba015103efa11308ad4e036b5b7129115564c6d89263425004f`. That fix marks bindings. Selected binding restoration is a separate extension below.

## Selected object and binding checkpoints

The [combined checkpoint contract](state-checkpoints.md) adds selected declarative/function bindings to ordinary-object restoration. Sixteen tests cover closure aliases, separate parameter/body records, temporal dead zones, constant assignment, cell identity, declaration rollback, ownership, GC roots, and validation before restoration. Branch observations compare with V8 and published engine262 in both visitation orders.

These tests restore selected state between separately executed scripts. They do not clone a continuation or render symbolic React trees. Module state, excluded internal collections, unselected mutations, jobs, and host effects remain unsupported. Relocated builds match engine SHA-256 `6d0119e78de339d6a4033e92a705035c67842ddfa05459223ac24646abe4a68a`.

## Engine control continuations

The [control extension](control-continuations.md) lowers engine algorithm generators into explicit resumable frames. Sixty-eight control tests cover native completion behavior, capture metadata, rejected state, poisoning, and actual engine resumption with selected object/binding state. The fixture-specific owner restores the execution-context stack and verifies both branch orders without prefix replay.

This is not a general state owner or a symbolic React fork. A further CLI test checks direct, single-process execution so harness termination cannot leave a launcher child running. Supplied Boolean witnesses remain concrete. Numeric/string domains, transitive ownership, internal collections, jobs, and guarded React output remain unfinished.

Relocated builds match engine SHA-256 `cf0fd5f77326b740c6d0da56739e39ad9c770eb9e2a4b195a2430f3dd7980662`. The local smoke passes 74/74. The historical selection retains 301/306 verdicts, but its three tail-call cases now time out instead of overflowing the native stack. No timeout or selection changed. The two Promise failures remain. Raw diagnostics are retained separately.

## Acceptance for later stages

Before broadening a contract, identify the engine262 implementation to reuse and add an independent regression gate. Compare engine and host writes before admitting effectful coercion or calls. Compare actual React commits, state, effects, and scheduling against native execution before reporting React support.

Retain mismatches and original diagnostics. Record whether each result is exact for its declared domain, overapproximated, unsupported, or incomplete. Do not hide failures by replacing dependencies, changing input domains, excluding cases, or raising budgets.
