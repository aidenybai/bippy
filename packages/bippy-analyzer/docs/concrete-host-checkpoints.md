# Concrete timer and diagnostic checkpoints

`ConcreteRuntime.captureHostState()` snapshots the concrete host’s existing timer map, capture arrays, handle counter, diagnostics, and engine queues. Its scope is `concrete-zero-delay-host-state-v1`. It does not snapshot guest execution or arbitrary native callback state.

The runtime composes engine262’s `BasicJobQueue`/`ByTypeJobQueue` and `WebLikeEventLoop` snapshots. There is no replacement scheduler, Job representation, or native heap scanner. The timer callback implementation is unchanged.

## Restored storage

- Original timer-map membership and order, handles, and next-handle counter.
- Original active timer capture arrays and their callback/argument references, including arrays emptied by cancellation or execution.
- Macro/microtask membership and category indexes through the engine snapshots.
- Original console entries, argument arrays, methods, and list order.
- Uncaught-exception list and unhandled-rejection Set membership.

Restore removes branch-added queue entries before rewinding handles. This prevents discarded jobs from using handles reassigned by a later branch. Queue restore does not notify `onNewJob`. Step and job counters remain lifetime work budgets and never rewind.

Restoring diagnostic membership does not rewind guest Error objects, Promise state, or rejection handling. Callback closures can still observe branch mutations in the guest heap or native records. A regression runs the same restored timer twice and observes counts 1 then 2, proving this boundary.

## Roots and lifecycle

`AgentHostDefined.hostDefinedState?: Markable` exposes engine262’s existing collector protocol to the host. Agent marking visits that record. `ConcreteRuntime.mark` roots its realm, live timer captures and diagnostics, and saved checkpoint values. It does not discover arbitrary native closure references. Retaining the Agent retains these declared host roots; disposal does not erase public diagnostics or all queued work.

Saved timer arguments remain live after cancellation until restoration or release. Restoring them preserves the original capture-array identity used by the original timer Job. Release clears saved references without mutating the currently selected branch.

Host snapshots require LIFO access. Both engine queue snapshots expose their existing `assertActive` checks so release can preflight both stacks before popping either. This check covers Agent, release status, and stack position, not restore eligibility or storage layout. Disposal rejects while host snapshots remain open.

Restore failures poison the runtime. Earlier restore writes need not roll back after an unsupported host mutation. Release remains available for cleanup after failure. The original failure identity remains terminal. Configuration, event-loop lifecycle, foreign queue changes, and external host references are not restored. Snapshot allocation and collector traversal are not bounded by the step/job budgets.

## Evidence

Thirteen focused cases fail on the exact predecessor and pass now. Four branch observations and two restored baselines match independent full-program Node VM runs using the existing zero-delay native fixture. These comparisons cover both branch orders, cancellation, consumption, nested timers, microtask ordering, restored handles, and console observations. They do not establish browser scheduling parity.

Other cases verify original Job/capture-array identities, diagnostic membership, nested release, disposal rejection, cross-queue release preflight, lifetime budgets, saved-root release, and live diagnostic roots. The latter tests expose previously unrooted console, uncaught-exception, and rejection references. They collect without a pushed realm context.

The actual React diagnostic composes this host snapshot with selected guest/context storage. Each order captures one existing timer and executes one prefix. It still rejects its first branch-created timer before returning an observation. The evaluation-checkpoint host-effect guard remains unchanged. Guest/native transitive ownership is still missing, so this increment does not authorize React event replay or provide a general guarded explorer.

[Validation receipts](concrete-host-checkpoint-validation/summary.json) retain predecessor failures, the initial protected-field TypeScript failure, corrected tests, hashes, conformance reports, and the diagnostic driver. React source research used the pinned reconciler’s `scheduleTimeout` and `cancelTimeout` paths and test-host aliases. Those paths also use nonzero delays, which remain outside this runtime’s zero-delay contract.
