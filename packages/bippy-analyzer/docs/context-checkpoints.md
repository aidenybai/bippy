# Selected execution-context storage

`createStateCheckpoint({ contexts, callSites })` now restores selected engine execution-context fields and CallSite records. It reuses `ExecutionContext.copy()` and `CallSite.clone()` with optional in-place targets. It does not copy a native heap or replace engine execution.

## Contract

Each selected context includes its original CallSite. Each selected CallSite includes its context, including that context’s original CallSite. Selection deduplicates identities and reports `contextCount` and `callSiteCount` alongside the existing storage counts. Objects and binding cells still require their own selections.

Capture requires canonical prototypes, exact native field layouts, extensible records, and writable enumerable configurable data fields. The context’s realm must belong to the current Agent. Restore checks these conditions, CallSite identities, and context links before writing any selected storage. Accessors, added fields, frozen records, replaced CallSites, changed owner links, and debugger preview reject. The shared state-checkpoint Agent and last-in-first-out guards still apply.

The existing copy operations retain their default behavior. Async copying still omits `Generator`, `poppedForTailCall`, and `CallSite.nextNode`. Checkpoints save and restore these fields separately. Saved contexts root their referenced engine values until release. Restore preserves original context and CallSite identities.

These are shallow field snapshots. They restore references, not the state beneath those references:

- Environment links do not restore binding cells unless the cells are selected.
- `CodeEvaluationState` and `Generator` links do not rewind continuations or generator positions.
- Host-defined records, capture arrays, Promise capabilities, scripts, realms, private environments, and parser nodes remain separately owned or unowned.
- Agent stack membership, jobs, event loops, modules, diagnostics, and host effects do not rewind.

Use Agent evaluation checkpoints to coordinate control and a validated owner for the remaining state. Selecting contexts alone is not an evaluator checkpoint. Realm provenance checks are not a general native-record provenance or hostile-host sandbox.

## Actual React diagnostics

The expanded React capture selects 2,199 guest objects, 138 environments, 814 binding cells, 20 contexts, and 44 CallSites together. The earlier reference traversal visited 24 CallSites. Context selection adds their 20 original CallSites, which `ExecutionContext.mark()` does not visit. This difference is further evidence that marking is not complete ownership discovery. The combined capture probe releases without restoration.

A separate, intentionally partial owner restores this selected storage and the context-stack list around the first unknown React decision. Four assignments run in each order from that saved decision, with one prefix execution per order. Eight committed-tree, render-count, and layout-cleanup observations match independent full-program native runs. Forced GC runs before each branch and at later decisions. This probe resumes actual React without replaying its prefix, but does not validate or own every reachable native record or host effect.

A timer variant demonstrates the missing isolation. Each branch schedules one callback. After all four branches and checkpoint release, draining the host executes all four callbacks, instead of the selected branch’s one callback. Both orders reproduce the leak despite matching UI observations. The partial owner is diagnostic code in the receipt, not a public explorer or an accepted execution owner.

The first diagnostic replaced the runtime’s step observer. Its log remains archived. The final probes chain the original observer, preserve the runtime budgets, and reproduce both results.

React research uses checkout `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, including dispatcher push/pop and reconciler execution-context restoration. Executed fixture packages use React/Test Renderer 19.3.0. React’s module-level `executionContext` binding is distinct from engine262’s native ExecutionContext records.

## Verification

[The receipt](context-checkpoint-validation/summary.json) stores input hashes, drivers, observations, and gate results. Its logs retain intermediate and final predecessor failures.

- Fourteen focused cases pass. The exact final file fails thirteen cases on the preceding engine, with one existing shallow-reference behavior passing.
- Two scoped Agent runs cover both orders, one prefix each, forced GC, lexical environments, throws, and finally. Four branch observations match V8.
- All 1,678 tests across 54 files pass, as do typechecking and two relocated clean builds.
- The unchanged local smoke passes 74/74. Source and published engines match 361/363 selected variants, including input hashes, compiled hashes, verdicts, and exit code 1. Both fail the two `async-function/evaluation-body.js` scenarios.

[Linux CI](context-checkpoint-validation/ci-status.json) passes 1,678 units and all 74 smoke variants with the matching engine hash. E2E passes. Publishing fails with a server 500 followed by 404, “There is no workflow defined for r6qTmyqoOv”. This green smoke run does not establish timing stability or remove earlier failures.

[Later host-effect guards](checkpoint-host-effects.md) now reject the timer variant at its first user timer call, before scheduling. The preceding leak remains evidence that matching trees do not prove isolation. Queue restoration and transitive ownership remain unimplemented.

## Next required work

Implement rejecting ownership for native captures and host queues using the existing engine records. The timer leak must fail capture or restore correctly before exposing these forks through a guarded React API. Native-record coverage, transition reports, repeated state families, and demo integration remain incomplete.
