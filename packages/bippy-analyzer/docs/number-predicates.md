# Unknown Number SameValue predicates

The source engine can return an abstract Boolean from `Object.is` when either Number operand is unknown. `number-predicates.patch` extends the existing intrinsic. It does not replace React state-update logic or change engine helpers that return host Booleans.

## Engine boundary

Engine262 evaluates both arguments before entering `Object.is`. If both operands are Numbers and either is abstract, the intrinsic calls `AgentHostDefined.evaluateAbstractNumberPredicate`. The callback receives a frozen `sameValue` record with frozen operands and must return an engine Boolean.

Concrete comparisons use the original engine `SameValue` path. Different-type comparisons also retain that path and can return false without reading an abstract Number. Objects are not coerced. An alias of the intrinsic retains this behavior after `Object.is` is overwritten; a replacement JavaScript function does not acquire it by name.

Low-level `SameValue`, `SameValueZero`, strict equality, and ordering helpers remain unchanged. Their callers expect host Booleans, so returning an opaque engine value there would silently select truthy paths. Unsupported abstract reads still reject.

## Numeric domain extension

`createNumericDomain()` now supplies both arithmetic and predicate callbacks through `agentOptions`. Its expression scope is now `engine262-number-expression-domain-v2`, with [remainder and numeric strict equality](numeric-parity.md). `getPredicate(BooleanValue)` returns an immutable record:

- `constant`, containing a known Boolean.
- `same-value`, containing the left and right numeric expression graphs.
- `strict-equal`, containing numeric operands for `===` or the equality decision used by `!==`.

A SameValue comparison of the exact same owned Number value returns true, including for unknown NaN or signed zero. Other SameValue comparisons retain a predicate. Repeated operand identities reuse the same abstract Boolean, including reversed operands because SameValue is symmetric. Concrete keys use their numeric strings, preserving the distinction between positive and negative zero and reusing NaN.

The expression cache now interns exact repeated operations, so identical ordered computations can reuse the same predicate. It preserves signed constants and does not reassociate expressions. It does not solve relations between predicates or prove arbitrary guards feasible. For example, a composite expression that always produces NaN can remain an unsolved predicate. Consumers must not label every chosen branch feasible without evidence.

`maxPredicates` defaults to 10,000 and must be a positive safe integer. Options are copied before asynchronous loading. The budget counts distinct recorded predicates across the domain lifetime, including across branch restoration. Cache hits, reflexive SameValue comparisons, known-false NaN strict comparisons, and concrete comparisons do not consume it. The cache retains its keys and results for the lifetime of its callback closures. This is not a CPU, allocation, or serialization limit.

Foreign abstract Number operands and Boolean predicate results reject. Missing or invalid engine callbacks also reject with host errors. As with other abstraction failures, discard the affected Agent rather than treating the error as a guest exception.

## Actual React execution

`tests/numeric-react.test.ts` loads actual React and Test Renderer 19.3.0 through the existing Vite fixture builder. An opaque Number initializes `useState`. The component’s updater adds one through engine262; React performs its eager bailout, reducer processing, reconciliation, and layout effects.

A test driver supplies one guarded SameValue choice and reuses it for subsequent requests on the same predicate. State remains `amount` on the bailout path or `amount + 1` on the update path. The global input remains opaque. No Number witness enters the symbolic runtime.

The two symbolic runs match ten independent native React executions for render count, complete Test Renderer output, layout-effect events, and unmount output. The witnesses include NaN, infinities, signed zero, subnormal values, and rounding boundaries. They validate specializations, not a finite input domain.

Each choice starts with a fresh runtime. These tests do not fork a React heap or preserve one shared React prefix across branches. The current fixture uses [Agent-owned decision suspension](agent-decisions.md), with explicit GC at every pause. It no longer manually advances an unregistered script iterator. This is not an analyzer-level symbolic-runtime contract. Failure cleanup discards that runtime. The UI displays the concrete render count, not unknown numeric text.

The inspected React source uses native `Object.is` when available (`packages/shared/objectIs.js`). `ReactFiberHooks.js` calls updater functions through `basicStateReducer`, reuses eager state, and tests `!is(newState, hook.memoizedState)`. The implementation keeps those decisions in React.

## Validation and remaining work

`tests/number-predicates.test.ts` checks 46 cases. Twelve expressions at 17 witnesses and a 17-by-17 two-input matrix produce 493 comparisons per independent V8/published reference. It also checks callback records, intrinsic identity, predicate identity, provenance, budgets, and unsupported host-Boolean helpers.

A selected-state fixture explores both SameValue outcomes in both branch orders. It executes its prefix once and restores its object, global declarative bindings, and context stack. Thirty-four specializations per reference match complete native/published program observations. Each outcome has witness evidence of feasibility. This is not general React state ownership.

[Validation receipts](number-predicate-validation/summary.json) retain tests, source hashes, concrete conformance comparisons, and failed checks. [The reuse audit](engine-reuse-audit.md) explains why debugger preview and `ExecutionContext.copy()` cannot replace branch rollback.

[Linux CI at `0dbcb0e9`](number-predicate-validation/ci-failure.json) passes all 1,182 unit tests but fails both numeric `substr` smoke variants at the unchanged timeout. The other CI jobs pass. Separate iOS E2E reports 42 failures after a shared setup hook exceeds 300,000 ms; its twelve source tests pass. Web and Android E2E pass. The retained logs do not establish the iOS setup failure's cause.

General ownership, complete suspended-control GC roots, broader predicates, symbolic strings, guarded React reports, repeated-state families, and the integrated demo remain incomplete. A constraint solver and sound general React explorer are still missing. The [caller-owned Boolean driver](boolean-snapshot-exploration.md) does not supply or verify React state ownership. The [completion checklist](symbolic-react-status.md) remains open.
