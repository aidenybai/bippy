# Compiler research

## The failure

Consider a getter used in a condition:

```ts
let reads = 0;
const value = first
  ? {
      get kind() {
        reads++;
        return "leaf";
      },
      text: "a",
    }
  : {
      get kind() {
        reads++;
        return "node";
      },
      text: "b",
    };
if (value.kind === "leaf") return reads + ":" + value.text;
return reads + ":" + value.text;
```

Native JavaScript reads `value.kind` once. Bippy's speculative narrowing could read it three times: once to execute the condition, then again while testing candidate values. The new differential tests reproduced `3:b` where native execution returned `1:b`.

The fix removes `narrowTestByEvaluation`, not just its handling of getters. Narrowing now inspects modeled values and syntax instead of replaying a condition. Predicate recognition also stops evaluating arbitrary member callees: looking up `helpers.check` a second time can itself call a getter.

## Sequential narrowing

For an explicitly unknown input, each test can supply a fact used by the next:

```ts
const getLabel = (value: unknown) => {
  if (typeof value === "string" && value === "ready") {
    return value.toUpperCase();
  }
  return "waiting";
};
```

On the true path, the left test establishes that `value` is a string. The right test then establishes that it is `"ready"`. The body can return `"READY"`, rather than unknown text.

TypeScript's `narrowTypeByBinaryExpression` applies the right refinement to the left refinement's result. Bippy previously intersected independently constructed values by object identity. Two separately allocated representations of a narrowed value need not have the same identity.

Type refinement must also preserve input identity. A fresh unknown-string value cannot become an independent input: `typeof value` and `value === "ready"` must constrain the same value. Refined scalar views now alias their source. The combined string example exposed this additional defect and is covered by a native-backed regression.

The adaptation in `src/evaluate/narrowing.ts` passes a refined lookup to the right test:

- For `A && B`, use the true side of `A` when refining `B`'s true side.
- For `A || B`, use the false side of `A` when refining `B`'s false side.
- Retain the original value on the other side, rather than introducing a new union algorithm.

The extra compound refinement is restricted to read-only syntax. A callback can overwrite the tested binding; facts about its old value must not restore that value after the callback. Calls, property access, assignments, updates, and coercive comparisons therefore block this compound refinement. Normal short-circuit evaluation still runs, with its existing guards and mutation handling.

Strict literal comparisons also narrow identifier values. For example, the true side of `value === "ready"` can substitute the literal. For a modeled unknown Boolean, the false side of `value === true` can substitute `false`.

This is deliberately narrower than TypeScript's rule. `value == 1` can accept `"1"`; substituting the number would change runtime behavior. Likewise, `value === 0` accepts both `0` and `-0`. Bippy leaves uncertain numeric zero unresolved instead of inventing positive zero. Source annotations are not runtime evidence.

## Boolean identity

A separate regression concerned the relationship between a Boolean input and its comparison:

```ts
const label = first === false ? "pass" : "fail";
return label + ":" + String(first);
```

With `first` explicitly modeled as an unknown Boolean, selecting `first = false` from the combined result admitted `"fail:false"`. Native execution returns only `"pass:false"`. Checking the unassigned set of possible labels would miss this mistake.

TypeScript's Boolean-comparison narrowing reduces a literal comparison to the corresponding truth condition. The adaptation in `src/evaluate/operators.ts` records that relationship directly:

```text
Boolean first === true  → first's existing condition
Boolean first === false → the negation of that condition
```

The same rule handles inequality, reversed operands, and loose equality when both operands are already known to be Boolean. It does not turn arbitrary `value === true` into a truthiness check: `1` is truthy but is not `true`.

All 16 combinations of operator, Boolean literal, and operand order failed the assignment-sensitive tests before this normalization and pass afterward.

## React and Oxc

React Compiler tracks each assignment to `label` separately. In simplified notation:

```text
label₀ = "Login"
if flag:
  label₁ = "Dashboard"
label₂ = phi(true predecessor: label₁, false predecessor: label₀)
```

This is single static assignment (SSA). The phi selects the definition from the predecessor used to reach the join.

`EnterSSA` tracks definitions by block and original identifier. When not all predecessors are available, it creates an incomplete phi and completes it when the block can be sealed. `EliminateRedundantPhi` removes a phi whose non-self operands all name the same value. Repeated passes handle dependencies across back edges.

Oxc's Rust passes implement the same construction and simplification over its HIR. These are not independent runtime models that can validate Bippy by agreeing with one another. Their shared algorithm is useful for tracking which assignment a read refers to, not for supplying JavaScript or React execution semantics.

Bippy already joins execution paths as guarded values. Replacing that with bare phi operands would lose the input-to-path association unless the CFG edges and their conditions were preserved too. Loop phis also describe recurrences; they do not enumerate loop outcomes or scheduled work. The initial narrowing patch did not add SSA. The subsequent implementation adds a CFG and SSA passes while retaining incoming-edge identity and the evaluator's guards.

React's and Oxc's type inference create constraints over HIR identifiers, unify them, and write resolved types back. The React implementation explicitly treats mutable captured-context reads differently from immutable local values. React's separate aliasing model distinguishes assigning a reference, capturing it in an object, extracting a possible alias, and mutating through those references.

Those distinctions matter to an evaluator, but copying the type unifier would not preserve a setter call, a closure's later read, or a queued React update. Its types and environment signatures serve compilation and memoization. This change does not replace Bippy's heap journals, captured scopes, task scheduler, or real React reconciler with compiler assumptions.

## SSA execution

```ts
const getValue = (flag: boolean) => {
  let value = 3;
  while (flag) {
    value = 4;
    break;
  }
  return value;
};
```

With an explicitly modeled unknown Boolean, one analysis must associate `false` with `3` and `true` with `4`. Before direct SSA execution, the guarded regression admitted the wrong result on the false path. Matching the unordered set `{3, 4}` would not catch that error.

A simplified view of the graph is:

```text
entry: value₀ = 3
       branch flag
true:  value₁ = 4; break
join:  value₂ = phi(true edge: value₁, false edge: value₀)
       return value₂
```

`src/compiler/` now contains lexical binding resolution, CFG lowering, sealed-block SSA construction, redundant-phi elimination, dominance verification, and sparse conditional constant propagation. Reassignments get distinct definitions. Loop headers can have incomplete phis until their back-edge definitions become available. Phi simplification also handles mutually recursive phi groups, using iterative traversal rather than the JavaScript call stack.

Edges retain truthy/falsy, nullish/defined, exceptional, and suspension distinctions. Constant propagation considers only executable incoming edges and distinguishes positive and negative zero. Captured bindings remain opaque cells; calls, property operations, and coercive operators carry a conservative effect-token dependency. This is not heap alias analysis.

`evaluate/ssa-execution.ts` executes eligible graphs during function calls. It chooses phi operands simultaneously from the actual incoming edge and uses the existing guard solver for unknown tests. It preserves pending exceptions across nested `finally` execution and checks uninitialized reads and immutable writes. The interpreter's step budget and loop-unrolling bound still apply.

### Why not substitute reads?

An early integration replaced AST identifier reads with compiler constants. For a `const` assignment that the AST evaluator incorrectly accepted, substitution changed the returned value without restoring the required `TypeError`. That was not a fix.

Read substitution was removed. Compiler constants are consumed only inside SSA execution. Unsupported functions use the existing AST evaluator for the whole body. A runtime deoptimization restores the attempt's step budget; the admitted operations cannot call application code or write application state before that fallback.

### Execution boundary

The construction passes operate on general CFGs, but the executable instruction set is narrower. Scalar parameters and operations, local reassignment, branches, loops, and tested exception paths can run through SSA. Reads of the modeled errors' `name` and `message` are also supported. Eligibility uses modeled values, not TypeScript annotations.

Mutable captures, arbitrary heap operations, calls, JSX construction, destructuring parameters, async functions, and generators still use the existing evaluator. The frontend represents many of these as opaque operations or suspension edges; that does not make them executable SSA implementations. In particular, precise iterator cleanup, per-iteration captured environments, and suspension histories need further lowering and runtime work. Dynamic scope and construction limits produce explicit unsupported compilation results; compiler invariant failures are not silently swallowed.

This is an integrated local-value SSA backend, not a complete replacement of JavaScript or React execution. Heap journals, captured scopes, task scheduling, and reconciliation remain necessary.

## Source revisions

The repositories were cloned locally. These are the revisions and relevant passes inspected, not claims to have audited their entire codebases.

**React:** `59aff3e18cb5b3a336c280bbfa57ec37999511b9`

- [Pass pipeline](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/docs/passes/README.md)
- [SSA construction](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EnterSSA.ts)
- [Redundant-phi elimination](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EliminateRedundantPhi.ts)
- [Type inference](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/TypeInference/InferTypes.ts)
- [Mutation and aliasing model](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/Inference/MUTABILITY_ALIASING_MODEL.md)

**Oxc:** `30add53b4386c86b001e7061a547e496910efe0d`

- [SSA construction](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_ssa/enter_ssa.rs)
- [Redundant-phi elimination](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_ssa/eliminate_redundant_phi.rs)
- [Type inference](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_typeinference/infer_types.rs)

**TypeScript:** `5f6db9c9148635b4cbf72f1193b821b9c6b42dcc`, plus v6.0.3 at `050880ce59e30b356b686bd3144efe24f875ebc8`

- [Current Go flow checker](https://github.com/microsoft/TypeScript/blob/5f6db9c9148635b4cbf72f1193b821b9c6b42dcc/tsc/internal/checker/flow.go): equality, Boolean, and compound narrowing; flow-state and reference handling.
- [v6 checker](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/src/compiler/checker.ts): the corresponding TypeScript narrowing algorithms.
- [v6 binder](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/src/compiler/binder.ts): assignment flow and the predecessor edges for logical expressions.

The TypeScript and React adaptations retain [attribution and their Apache 2.0 and MIT licenses](../third-party-notices.md). The React passes were adapted to Bippy's representation, not imported wholesale. No Oxc source was extracted.

## Validation

The change adds 48 tests across `tests/flow-narrowing.test.ts` and `tests/flow-narrowing-differential.test.ts`. They cover sequential `typeof` refinement, strict literals, Boolean comparison identity, getter effects, predicate-callee getters, captured reassignment, and callbacks that overwrite a tested binding. Boundary tests reject loose literal substitution and positive-zero substitution.

The differential tests select each Boolean assignment from one combined analysis and compare every surviving outcome with native execution. They also enumerate and replay symbolic render outcomes. Those render tests now supply explicit unknown-Boolean parameters; a `declare const first: boolean` annotation alone does not establish the runtime input domain.

The SSA work adds 7,662 tests. The original 157 include native read-fact checks, direct executor tests that distinguish execution from fallback, guarded return/throw comparisons, and structural CFG tests in `tests/ssa.test.ts` and `tests/ssa-construction.test.ts`. Those structural tests include parallel predecessor edges, irreducible control flow, genuine loop recurrences, a 12,000-edge predecessor chain, and a 5,000-phi cycle. An architecture test prevents compilation from depending on evaluation or rendering.

The expanded suite adds 7,505 tests:

| File under `tests/`                | Tests | Checks                                                                                                                                             |
| ---------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssa-operators.test.ts`            | 4,740 | Scalar operator matrices through parameters and folded literals; short-circuit effects, assignments, updates, and execution without constant facts |
| `ssa-completion-matrix.test.ts`    | 1,262 | Try/catch/finally combinations of normal, return, throw, break, and continue; concrete and guarded native comparisons                              |
| `ssa-control-flow.test.ts`         |   552 | 256 seeded programs under concrete and symbolic inputs; simultaneous loop phis and switch evaluation order                                         |
| `ssa-bindings.test.ts`             |   152 | TDZ, immutable writes, shadowing, catch-var initializers, closure capture classification, and `arguments` ownership                                |
| `ssa-constant-propagation.test.ts` |   592 | Executable-edge selection, scalar joins including NaN and signed zero, exception edges, and nontrivial phi cycles                                  |
| `ssa-generated-graphs.test.ts`     |    64 | Five-join graphs checked against native assignments under all 32 branch selections, before and after optimization                                  |
| `ssa-boundaries.test.ts`           |    64 | Fallback, budget restoration, compilation limits, dead effects, fresh execution registers, and mixed return/throw continuations                    |
| `ssa-refinement.test.ts`           |    48 | Equality aliases, overwritten definitions, signed-zero uncertainty, and symbolic scalar comparisons against NaN                                    |
| `ssa-verification.test.ts`         |    31 | A valid control graph and 30 malformed graph mutations                                                                                             |

Direct scalar comparisons require SSA execution, not fallback. They compare values with `Object.is`, preserving NaN and signed zero, and distinguish primitive throws from error names. The native wrapper uses the same parameter bindings as the compiled function. Guarded tests check input-to-outcome associations rather than unordered result sets. Generated seeds are fixed for reproducibility; they do not exhaust possible programs.

The new tests exposed and drove fixes for four execution cases: a catch-local `var` initializer overwriting an outer parameter, `in` bypassing AST error handling, primitive `instanceof` returning uncertainty instead of throwing, and known NaN equality retaining impossible scalar matches. They also exposed 13 malformed graph shapes that verification previously accepted. The verifier now checks graph identities, edge ownership and uniqueness, terminal shapes, and phi-variable consistency before accepting the graph.

Seven existing known-defect cases now match native execution and are ordinary regressions: five temporal-dead-zone cases, a switch-case scope case, and an immutable-write case. Other known defects were not relabeled.

Final validation:

- Coverage: 23,301 tests passed across 367 files, including all 587 component fixtures.
- Ordinary assertions: 21,948. Known-defect assertions: 1,353.
- Typecheck, touched-file lint, formatting, and architecture tests passed.
- Strict compatibility still failed: known defects remain, and 238 source files lack complete coverage. No test or source files were missing from the report.

These passes do not establish complete JavaScript or React compatibility. Unsupported execution histories remain, and no corpus performance measurement was made for this change.
