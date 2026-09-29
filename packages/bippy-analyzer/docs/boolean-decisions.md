# Resumable abstract Boolean decisions

The source engine can suspend an `if` statement on an unknown Boolean. `boolean-decision.patch` implements this protocol in engine262. It does not replace application semantics or provide whole-state isolation.

## Decision protocol

`BooleanValue.createAbstract()` creates a frozen engine Boolean without a concrete payload. `BooleanValue.isAbstract(value)` identifies it. Direct payload reads throw a host `TypeError`. Ordinary true and false values retain their existing representation.

An `if` statement evaluates its condition and obtains its value through engine262. A concrete condition follows the ordinary `ToBoolean` path. An abstract Boolean condition calls the lowered `ResolveBooleanCondition` generator, which yields a frozen record:

```ts
interface EvaluatorYieldType_AbstractBoolean {
  readonly suspend: "abstract-boolean";
  readonly value: BooleanValue;
}

interface EvaluatorNextType_AbstractBoolean {
  readonly resume: "abstract-boolean";
  readonly decision: EvaluatorYieldType_AbstractBoolean;
  readonly value: boolean;
}
```

Resume with the exact decision record and a host Boolean choice. The engine validates record identity and reads the choice once. Stale, missing, malformed, and non-Boolean responses throw. Restoring a control checkpoint restores the saved decision record, so that record remains valid for the restored suspension.

The driver owns path constraints. The engine does not enforce consistent choices across separate decisions on the same input. A driver must reuse an existing assignment or create guarded branches under a valid state owner.

`skipDebugger` and the default Agent evaluator reject these suspensions rather than inventing a result. The opt-in [Agent-owned decision lifecycle](agent-decisions.md) now retains and resumes them through `resumeEvaluate`. `RunSuspendedContext` forwards them through guest generator execution. Single-pass generator resumption is tested; checkpoint ownership across arbitrary guest generators is not established.

## Unsupported reads fail explicitly

The pinned engine previously treated Boolean values as the two concrete singletons. Identity checks could silently treat a new abstract Boolean as false. The patch changes the affected conversions, equality helper, Boolean string method, JSON serialization, and Test262 debugger flag to read Boolean payloads. Abstract reads then throw instead of returning a concrete substitute.

The remaining executable singleton checks use engine-internal concrete flags. `ForInIteratorPrototype` writes only `Value.true` or `Value.false` to `ObjectWasVisited`. The RegExp replacement algorithm derives its flag from a concrete native string. Assertion comments do not execute.

The original patch adds decisions to `if` statements. The separate [Boolean expression patch](boolean-expressions.md) now covers `?:`, `&&`, `||`, and `!`. Unknown logical assignments, loop conditions, conversions, boxing, and same-type equality still reject unsupported abstract consumption. Known type-based results, such as `typeof enabled` and `enabled === 1`, remain concrete. These bounds are deliberate, not general Boolean abstraction support.

Host errors can leave engine execution contexts active. Discard the Agent after such failures unless a separately verified owner supplies recovery. These failures are not guest exceptions, and guest `catch` does not consume them.

## Selected-state guarded execution

`tests/guarded-control.test.ts` runs one engine script with unknown `enabled`, `fail`, and unbounded numeric `amount`. It explores decisions as the engine emits them, rather than substituting concrete input bindings. The fixture snapshots its shared ordinary object, global declarative bindings, and execution-context stack alongside control frames.

The fixture produces four guarded completions. Their numeric expressions retain `amount` or `amount + 1`. After `finally`, the count retains `amount + 10` or `(amount + 1) + 10`. A guest callback reads the same aliased object after `finally`.

Both branch visitation orders verify:

- One execution of the common prefix and the condition function.
- Three forks and four outcomes.
- Two reused decisions on the original Boolean identity.
- No path multiplication from the unused input.
- Preserved aliases, deferred callback reads, and normal/throw completions.

Each order specializes four outcomes at nine Number witnesses. Independent V8 and published-engine runs match all 72 observations per reference. The actual numeric expressions remain unbounded; the witnesses only check their specializations.

The callback fixture does not use an engine job or timer queue. Its owner is specific to the selected program. It does not prove transitive ownership of execution records, native captures, internal collections, modules, host effects, or escaped functions. [Suspended-evaluator roots](suspended-control-roots.md) cover the original generator probe, and [Promise roots](promise-roots.md) fix the pending-reaction probe. External drivers and partial `Promise.all` results still have proven root gaps. [Host-job declarations](host-job-roots.md) now retain timer and explicit microtask captures.

## Remaining React work

The guarded observations exist in a test fixture, not a package analysis/report API. There is no general statement explorer, guard solver, reachability inventory, or whole-state owner. Numeric predicates, string domains, guarded React trees, transitions, repeated-state families, and the symbolic demo remain incomplete.

[Validation receipts](boolean-decision-validation/summary.json) retain concrete Test262 comparisons, unit checks, rejection failures, and build evidence. The numeric increment’s preceding Linux smoke failure remains in [its CI receipt](numeric-domain-validation/ci-failure.json). No gate selection, timeout, or worker limit changed.
