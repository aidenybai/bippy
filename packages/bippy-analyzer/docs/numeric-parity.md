# Numeric remainder and strict equality

The numeric domain now retains `%` expressions and numeric `===` predicates. `!==` uses the same equality predicate through the existing Boolean decision protocol. This supports count parity without assuming mathematical integers or changing React’s hooks.

The public scope changes to `engine262-number-expression-domain-v2`. Consumers must handle the new `remainder` operation and `strict-equal` predicate kind. Earlier additive and SameValue receipts remain historical evidence for v1.

## Original engine operations

`numeric-parity.patch` adds an abstract-operand check to the original `NumberValue.remainder`. Concrete operands still use the original remainder implementation. Engine262 still evaluates operands, reads references, converts values, and rejects mixed Number/BigInt arithmetic. Coercions run even when the numeric term already exists.

`Evaluate_EqualityExpression` intercepts only `===` and `!==` with two Number operands, at least one abstract. It runs after the original operand evaluation and `GetValue` calls. Concrete and different-type comparisons keep their original paths. Strict equality does not coerce objects.

The Number predicate hook receives either `sameValue` or `equal`, with frozen operands. Both paths require an engine Boolean result. `!==` resolves that equality Boolean through `ResolveBooleanCondition`, then negates the chosen value. It can therefore suspend during expression evaluation, before an enclosing `if`.

Low-level `NumberValue.equal`, `IsStrictlyEqual`, SameValueZero, and ordering helpers still return host Booleans. They do not acquire abstract-result support. Loose equality, multiplication, division, ordering, numeric truth tests, and numeric string conversion remain unsupported for opaque Numbers.

## Identity and IEEE behavior

Strict equality and SameValue have separate predicate caches. Strict equality merges positive-zero and negative-zero constant keys. SameValue keeps them distinct. A strict comparison with a known NaN returns false after validating both operands’ provenance.

An unknown Number compared with itself still produces an opaque strict-equality predicate: the Number may be NaN. SameValue of that same value returns true. The domain does not simplify `amount % amount` or `amount % 0` to a constant.

Exact repeated arithmetic operations reuse their Number and expression nodes. The cache key retains the operator, ordered operands, and signed constants. It does not reorder operands, combine additions, or prove algebraic identities. Thus separately recomputed `amount % 2` expressions can reuse one parity predicate without a general solver.

All accepted arithmetic requests consume the lifetime `maxOperations` budget, including cache hits. Predicate cache hits do not consume the distinct-predicate budget. Strict equality and SameValue share that budget. Neither budget rewinds during branch restoration. Domain caches retain their keys and results for their lifetime.

This interning is not general constraint solving. Different predicates can still describe incompatible choices. A consumer must not treat every Boolean assignment as a feasible numeric state. Derived predicates are not independent external inputs merely because the report driver accepts named Booleans.

## Shared-prefix parity reports

A selected-owner fixture starts with an opaque `amount`, computes parity, and pauses at its first decision. The Boolean driver explores both choices and reuses the same predicate when `% 2 !== -0` recomputes the term.

Both traversal orders execute one prefix and create one checkpoint. Forced GC occurs during observation. Forty specializations map each numeric witness through its predicate to the report guard and match fresh native programs. These are engine script forks, not React heap forks. Reports retain unverified execution and coverage.

## Actual React specializations

`tests/fixtures/numeric-parity-react.tsx` starts `useState` at concrete zero and receives an opaque step prop. Real event handlers add that step, add five, reset the count, and subtract five. The UI renders parity text, not opaque numeric text. Layout effects depend on the count.

Seven independent source-engine runs specialize the step to `1`, `2`, `5`, `-2`, `-0`, NaN, and Infinity. A test-only hook evaluates predicate DTOs under that assignment and returns concrete Boolean choices. Number state remains an expression when React accepts the unknown update.

Each run matches an independent native React run for six snapshots, layout/cleanup events, and current state. The step-one count sequence is `0 → 1 → 6 → 0 → −5`. The negative-even case checks remainder’s negative zero. The `-0` step bails out at zero, so it produces no opaque parity decision.

These runs validate 42 lifecycle observations. They do not explore a shared React prefix, discover transitions, change the step interactively, prove repeated-state families, or implement the full demo. The host-effect guard remains unchanged.

## Validation evidence

[Receipts](numeric-parity-validation/summary.json) record 59 new cases and 153 focused cases including the existing numeric suites. Ten remainder sources and eight equality sources specialize at 20 Number witnesses each. A two-input matrix checks 400 remainder and 400 equality results against V8 and the published engine’s original numeric operators.

The final-source predecessor behaves differently under combined and isolated test execution. The combined run records 52 failures and seven passes, including six React test timeouts at the unchanged five-second limit. Isolated files record 45 failures/seven controls and six failures/one control. Those timeout results remain failures; the logs do not establish their cause.

An early test reused an Agent after a budget error and encountered its stored failure. The corrected test discards that Agent. An early identity assertion triggered the test formatter’s abstract-Boolean getter; the final assertion compares identity as a native Boolean. The initial `-0` React assertion incorrectly required a parity decision despite a valid bailout. The final test retains and verifies that bailout.

Fresh source and published Test262 runs both pass 197 modulus and strict-equality variants with matching inputs, compiled sources, and verdicts. These are concrete conformance checks, not symbolic completeness evidence. General React state ownership, guarded event/effect transitions, repeated-state analysis, and integrated demo output remain incomplete.
