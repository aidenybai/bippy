# Unbounded additive Number expressions

`createNumericDomain()` represents unknown JavaScript Numbers without choosing concrete witnesses. Its scope is `engine262-additive-number-domain-v1`. This is a low-level engine extension, not a symbolic React runtime or a replacement for the Boolean scalar-expression API.

## Engine operations

`engine/patches/abstract-number.patch` adds `NumberValue.createAbstract()` and `NumberValue.isAbstract(value)`. An abstract Number has the engine’s Number type and no concrete numeric payload. Its frozen wrapper rejects `.value`, `.numberValue()`, and native JSON serialization with a host `TypeError`.

The engine calls `AgentHostDefined.evaluateAbstractNumber` when addition, subtraction, or unary negation receives an abstract Number. The callback receives a frozen operation record and operand list. It must return an engine Number. Ordinary concrete arithmetic does not call the callback.

The engine still executes JavaScript evaluation, calls, coercion, mutation, and abrupt completions. For example, it invokes an object’s `valueOf()` before recording numeric addition. It rejects mixed Number/BigInt addition through its existing guest exception path. No analyzer interpreter or replacement React hook implements these operations.

## Numeric domain API

The package exports `createNumericDomain(options?)`. It returns:

- `agentOptions`, containing the arithmetic and SameValue predicate callbacks. Install it when creating a source-built engine Agent.
- `createInput(name)`, returning an abstract Number. Repeated names within the same domain return the same input.
- `getExpression(value)`, returning an immutable expression. Foreign abstract Numbers are rejected.
- `getPredicate(value)`, returning a constant Boolean or [Number SameValue predicate](number-predicates.md).

The expression kinds are `input`, `constant`, and `operation`. Operation nodes retain operand order and parentheses. Constants use strings to preserve `NaN`, infinities, and negative zero. Shared abstract operands reuse expression objects, forming a directed acyclic graph.

The domain records `(amount + 1) + 10` as nested additions. It does not replace the input with zero or a finite sample set. The input can represent any JavaScript Number, including `NaN`, infinities, and negative zero. It does not simplify `amount - amount` to zero or combine additions, because those transformations can change JavaScript results.

## Boundaries and failure handling

Only addition, subtraction, and unary negation have abstract operation support. `Object.is` now supports [abstract Number predicates](number-predicates.md). Other comparisons, numeric truth tests, string conversion, multiplication, division, remainder, and other concrete reads remain unsupported. Supported type-preserving operations, such as unary plus and `Number.prototype.valueOf()`, retain the abstract Number.

An unsupported read or domain budget failure aborts engine evaluation with a host error. It is not a catchable guest exception. Discard that Agent and its pending execution. The low-level domain API does not repair execution contexts or automatically poison an externally managed Agent. The tests discard their fixture Agent after these failures.

`maxInputs` defaults to 128. `maxOperations` defaults to 10,000. `maxPredicates` defaults to 10,000 distinct predicates. All three budgets must be positive safe integers. Input names contain 1 to 128 UTF-16 units. Options are copied before asynchronous engine loading. The operation budget counts recorded abstract operations across the domain’s lifetime and does not reset during branch restoration. It does not count ordinary concrete arithmetic.

These limits are not a sandbox. They do not bound parsing, concrete execution, allocations, or report serialization. Expanding shared expression graphs into JSON can produce exponentially larger output. A report writer needs separate work and output limits.

React’s `basicStateReducer` calls update functions, then `updateReducerImpl` compares state with `Object.is`. The inspected React revision is `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, in `packages/react-reconciler/src/ReactFiberHooks.js`. The native `Object.is` path now emits opaque Boolean predicates. A [single-path React fixture](number-predicates.md) drives both bailout choices without replacing React hooks.

The numeric domain does not provide a decision driver, constraint solver, whole-state ownership, broader numeric comparisons, string domains, or guarded React output. A separate [engine Boolean protocol](boolean-decisions.md) now suspends `if` statements and supports a selected-state guarded fixture. It is not yet integrated with `evaluateSymbolicExpression` or the concrete runtime’s public contract. [Suspended-evaluator marking](suspended-control-roots.md) fixes the original generator probe. External drivers and pending-Promise reactions still have root gaps. [Declared host-job roots](host-job-roots.md) now retain timer and explicit microtask captures.

## Verification

`tests/numeric-domain.test.ts` checks engine calls, aliases, updates, coercion, thrown values, and `finally` with an unbounded input. These are straight-line executions, not symbolic branch forks. It also checks immutable terms, shared operands, input identity, domain boundaries, budgets, and unsupported reads.

Seventeen source expressions specialize at 23 Number witnesses each. Independent V8 runs compare the original source with the recorded expression, including `NaN`, infinities, negative zero, subnormals, and precision boundaries. These 391 comparisons test the representation. They do not define the input domain as a finite set.

[Validation receipts](numeric-domain-validation/summary.json) retain the unit, Test262, type, root-check, and relocated-build evidence. The Test262 comparisons cover concrete execution, not abstract numeric completeness. [The symbolic React checklist](symbolic-react-status.md) remains incomplete.
