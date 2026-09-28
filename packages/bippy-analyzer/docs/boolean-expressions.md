# Abstract Boolean expressions

`boolean-expressions.patch` extends the [Boolean decision protocol](boolean-decisions.md) to `?:`, `&&`, `||`, and `!`. Engine262 still evaluates operands, resolves references, chooses branches, and propagates completions. The patch changes only the point where these algorithms need an abstract Boolean choice.

Concrete conditions keep their direct `ToBoolean` path. Abstract conditions suspend through `ResolveBooleanCondition`, using the existing exact-record response protocol. This does not add a separate expression interpreter or Boolean algebra solver.

## Operand and guard semantics

The conditional operator evaluates its condition once, then evaluates only the selected branch. Logical operators preserve the selected operand, rather than replacing it with its truth value. Negation returns a concrete Boolean under the chosen path guard.

For example, a false decision in `enabled && other` returns the original opaque `enabled` value. An enclosing `if` can request that input again. The driver must reuse its existing assignment. The input binding and returned operand remain abstract; the engine does not write a concrete witness into them.

The patch also corrects `BooleanValue.isAbstract` to return `boolean`, not a TypeScript type predicate. Its previous predicate incorrectly excluded all `BooleanValue` instances on the false branch, including concrete Booleans. `ResolveBooleanCondition` now checks the value class explicitly before creating a typed decision record.

## Verification

`tests/boolean-expressions.test.ts` covers 24 source expressions under four input assignments. Each specialization matches independent V8 and published engine262 observations for completion, value, type, and side-effect order. These tests include getters, nested and repeated predicates, omitted right operands, throws, finally, unbound method calls, and guest generators.

Ten further cases check opaque operand identity, repeated decision identity, default-runner rejection, and unsupported diagnostic reads. The inputs retain their original identities after execution.

`tests/guarded-control.test.ts` now runs both statement and expression versions of the selected-state program. Both versions explore actual opaque decisions in both branch orders, with unbounded numeric `amount`. Each run verifies four outcomes, three forks, two reused decisions, and one prefix and condition call. Their 144 specializations per independent reference match V8 and published engine262. This fixture still owns only its selected object, global declarative bindings, and context stack.

The current local suite passes 1,132 tests across 26 files. The unchanged local smoke passes 74/74. The four expression Test262 directories pass 144/148 variants in both engines, with matching input hashes, compiled hashes, and verdicts. Four strict tail-call cases remain failing. Source runs time out; published runs report normalized engine-file errors. These are not equivalent diagnostics or complete conformance.

[Validation receipts](boolean-expression-validation/summary.json) retain the tests, build evidence, rejected checks, and raw outcomes. The initial baseline command was interrupted, so it is not a completed comparison. A later failing comparison exposed diagnostic payload reads on opaque non-callables; those reads now have explicit rejection tests, not a substituted error message.

## React and remaining limits

The inspected React revision is `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. `ReactFiberHooks.js` uses `if (!is(newState, hook.memoizedState))` when applying reducer updates. Negation has a decision boundary, and [Number SameValue predicates](number-predicates.md) now cover the native `Object.is` path.

`ReactChildFiber.js` classifies children by type before creating text, element, and other fibers. Boolean children reach the empty-child result. Preserving the Boolean type and original logical operand matters for these paths. Source inspection is not symbolic React rendering evidence.

Direct abstract operands still reject in logical assignments, loop truth tests, conversions, boxing, and same-type equality. A supported subexpression can first resolve a decision, such as the negation in `while (!enabled)`; this does not provide general loop exploration. `??` keeps its existing type-based nullish behavior and does not decide Boolean truthiness. Calling an opaque Boolean can still fail while engine262 formats the non-callable diagnostic. The analyzer does not invent a concrete payload to complete that message.

Number SameValue predicates now exist. There is still no general engine-state owner, constraint solver, package explorer, guarded React tree, or symbolic demo. The suspended-control GC gap remains open. These additions do not establish whole-state isolation or complete the [React checklist](symbolic-react-status.md).
