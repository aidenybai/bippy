# Symbolic React completion checklist

The active objective is “finish the symbolic stuff for React”. The [roadmap](../ROADMAP.md) defines the existing acceptance scope. Completion requires unknown inputs and state to produce guarded React output and transitions through actual React and engine262. Concrete rendering or a passing JavaScript smoke test alone does not meet that objective.

## Required evidence

| Deliverable                                                                         | Current artifact and verification                                                                              | Status and missing evidence                                                                                                                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execute actual React with engine262 semantics                                       | `src/concrete/runtime.ts`, `tests/concrete-react.test.ts`, `tests/concrete-react-dom.test.ts`                  | Concrete fixtures exist. They do not receive symbolic inputs.                                                                                                             |
| Preserve unknown inputs and correlations                                            | `src/symbolic/evaluate.ts`, `tests/scalar-parity.test.ts`                                                      | Finite Boolean-input scalar expressions only. General numeric/string expressions and effectful execution remain missing.                                                  |
| Isolate branch mutations with stable identities                                     | `engine/patches/binding-checkpoint.patch`, `tests/state-checkpoint.test.ts`, `tests/object-checkpoint.test.ts` | Selected ordinary objects and declarative/function bindings restore together. Whole-heap ownership, internal collections, modules, jobs, and host effects remain missing. |
| Resume branches without repeating common prefixes                                   | Object tests restore between separately executed branch scripts                                                | No general continuation or symbolic statement fork exists. A storage checkpoint does not restore a suspended generator.                                                   |
| Render guarded React trees                                                          | Concrete React output fixtures                                                                                 | No symbolic React tree API, committed-tree merging, input provenance, or specialization gate exists.                                                                      |
| Preserve fibers, hook queues, refs, context, and component identity across branches | Concrete React regressions and selected cyclic-object restoration                                              | No integrated React branch isolation. Cyclic object tests are not React execution evidence.                                                                               |
| Derive events, effects, async work, and state transitions                           | Concrete timer, Promise, event, and cleanup fixtures                                                           | No guarded transition records, symbolic scheduling, or branch-owned host effects.                                                                                         |
| Represent repeated state families rather than sample counts                         | Roadmap counter/list acceptance cases                                                                          | Numeric state families, repeat summaries, and completeness-aware queries remain missing.                                                                                  |
| Integrate the demo through the package API and CLI                                  | Separate native resolver/demo worktree; concrete counter fixtures here                                         | No end-to-end symbolic demo or analysis CLI. Build observation is not runtime or symbolic coverage.                                                                       |
| Verify specialization against independent native execution                          | V8, published-engine, and Chromium concrete/scalar comparisons                                                 | No independent guarded React specialization suite.                                                                                                                        |
| Preserve provenance, bounds, errors, and unsupported results                        | Existing concrete/scalar contracts and source-build manifest                                                   | Symbolic React report schema and completeness status remain missing.                                                                                                      |

## Demo acceptance

The initial state must be count `0`, step `1`, and details hidden. Later state families must preserve these transitions:

- Increase and decrease use the selected step of `1`, `2`, or `5`.
- Reset changes count only, preserving step and details visibility.
- Count parity stays correlated with its label.
- Details visibility stays correlated with the toggle label and conditional child.
- Lazy details include pending fallback, resolution, hiding, and cleanup.

The browser-checked sequence `0 → 1 → 6 → 0 → −5` must specialize from the symbolic report. It is not exhaustive state-space coverage. None of these symbolic demo requirements is verified by the current property-checkpoint tests.

## Gates and their scope

- `pnpm --filter bippy-analyzer test --run` checks implemented fixtures, not missing symbolic React contracts.
- `pnpm --filter bippy-analyzer typecheck` checks types and the maintained source build, not semantic completeness.
- `pnpm --filter bippy-analyzer test:engine-build` checks relocated reproducibility and integrity, not branch isolation.
- The existing 74-variant Test262 smoke retains two workers and its 10-second timeout. It does not cover full JavaScript or React parity.
- The historical 301/306 and parameter/arguments 557/559 selections retain known failures. They are not full Test262 conformance.
- PR #149 records incremental evidence. A green PR status does not complete the missing rows above.

## Next required increment

The [selected-state checkpoint](state-checkpoints.md) now restores selected object aliases and captured bindings together. Define and test an engine-owned continuation strategy before permitting general effectful symbolic execution. Inventory the remaining mutable records and their ownership. Do not substitute selected storage restoration for execution resumption or whole-heap branch isolation.

Keep the goal active until each required row has implementation and independent acceptance evidence. General browser behavior and later server/native targets retain the separate boundaries in the roadmap.
