# Symbolic evaluation

`evaluateSymbolicExpression()` is part of the analyzer's source API. It uses engine262's parser and evaluator to compute guarded scalar alternatives from unknown Boolean inputs. It does not use the old analyzer's JavaScript interpreter or compiler.

```ts
import { evaluateSymbolicExpression } from "bippy-analyzer";

const result = await evaluateSymbolicExpression("(enabled ? 1 : 2) + 3", ["enabled"]);
```

The result has two outcomes:

```text
result
├── enabled  → Number("4")
└── !enabled → Number("5")
```

The result scope is `engine262-pure-scalar-expression-v2`. Each declared input is an independent unknown Boolean, not an arbitrary number or string. Each outcome contains a guard and either a scalar value or an exception's name and message. Numbers use strings to preserve `NaN`, infinities, and negative zero through JSON. BigInts use decimal strings. The output is not a React tree or a complete JavaScript exception snapshot.

## What engine262 does

engine262 parses the source, resolves input bindings, evaluates concrete expressions, applies JavaScript coercions and arithmetic, and produces exceptions. No arithmetic, JavaScript parsing, or ordinary operator implementation was copied from the old interpreter.

An override in engine262's `Evaluate` dispatcher handles supported expressions whose operands may have guarded alternatives. It runs after the engine's node-observation and debugger hooks. Expressions without symbolic inputs retain ordinary dispatch.

`scalar-operation.ts` identifies eager operands and delegates execution to engine262's exported `Evaluate_*` functions. For each feasible operand tuple, the adapter supplies cached concrete engine values when the native operation requests those operands. It does not copy arithmetic, coercion, equality, or truthiness rules. The native conditional, logical, and nullish evaluators choose which later operand to execute.

The adapter preserves left-to-right evaluation and guarded abrupt completions. If a left operand throws, its path does not evaluate the right operand. Boolean assignments remain attached to intermediate engine values, so repeated inputs cannot produce contradictory combinations. A common prefix before a choice executes once; the enclosing script is not rerun for every input combination.

This is finite guarded-value distribution. Equal results can retain different guards, and feasible alternatives can still grow exponentially. It does not provide unbounded numeric/string inputs, residual expression graphs, general constraint solving, or heap merging.

## Engine extension

The installed engine remains unmodified and is the independent concrete oracle in tests. The symbolic loader imports a source-built engine from `engine/dist/engine.mjs`. Runtime loading never edits a bundle, builds code, or creates a temporary engine file.

Run `pnpm --filter bippy-analyzer build:engine` before consuming the source API. The build applies the typed hook to pinned engine262 sources and emits JavaScript, declarations, and a valid source map. The loader verifies source/build identity and artifact hashes before importing the result. Missing, changed, or stale artifacts fail with a rebuild instruction and the original cause.

Only one extended module is loaded per host module instance. Every request gets a fresh agent and realm; synchronous evaluation restores the previous agent even on failure. Results retain the `originalEngineSha256` and `patchedEngineSha256` fields. The latter now identifies the source-built extension, not a runtime-patched copy.

Pinned upstream:

- engine262 commit: `a600354c2954300d62d108bf9ed3459a8e4a289b`
- npm package: `0.0.1-a600354c2954300d62d108bf9ed3459a8e4a289b`
- original ESM SHA-256: `bbc66b6f71a0f36e23c5ea07bbf3cc2c390de9c6c7bb1f4a0ecf5791b2b2600b`

The maintained source patch is `engine/patches/evaluation-hook.patch`. See [source-built engine262](../engine/README.md) for source provenance, toolchain pins, clean-build comparison, concrete checks, and upgrade instructions. The scalar adapter uses the same source-built artifact as the initial hook implementation. Its broader expression support does not change the engine bundle or the archived concrete Test262 baseline.

## Carried over from PR #115

Reference commit: `1b73cbf75f6e9eb04d6a4ce03c95318960207906`.

From `packages/bippy-analyzer/src/symbolic/guards.ts`:

- Root-input variable and Boolean guard shapes.
- `truthyGuard`, `constantGuard`, and `negateGuard` implementations.
- A reduced conjunction builder, without the old multi-domain solver or canonicalization machinery.

The regression tests adapt the earlier correlation and concrete-substitution checks. The old interpreter, value model, heap journal, React materializer, CFG/SSA compiler, and full symbolic-tree representation are **not** ported. Heap journals over the old object model cannot safely journal engine262 objects without additional work.

## Current contract

Supported:

- Pure scalar expressions, using numbers, BigInts, strings, Booleans, `null`, and `undefined`.
- Arithmetic `+`, `-`, `*`, `/`, `%`, and `**` over concrete or guarded scalar values.
- Equality `==`, `!=`, `===`, `!==`, and comparisons `<`, `<=`, `>`, `>=`.
- Unary `+`, `-`, `!`, `~`, `typeof`, and `void`.
- Bitwise `&`, `|`, `^` and shifts `<<`, `>>`, `>>>`, including engine-produced errors for unsupported type combinations.
- Unknown Boolean inputs as values, operands, or conditions.
- Nested ternaries, `&&`, `||`, and `??`, with conditional results used as operands or conditions.
- Correlated decisions, guarded exceptions, and JSON serialization of results.

Rejected before execution, even in unreachable branches:

- Calls, objects, arrays, property access, mutation, declarations, loops, and async work.
- Object operators such as `in` and `instanceof`, optional chaining, sequence expressions, and template literals.
- Other syntax outside the listed subset, including undeclared inputs.

Internal opaque engine objects identify guarded alternatives. Syntax validation and operand substitution prevent ordinary engine coercions from receiving these objects. Removing that boundary without extending the affected semantics would be incorrect. Branches share one realm only because accepted expressions cannot mutate application state or call user code. Copying Boolean assignment maps is not a heap snapshot or state isolation.

Defaults are 10,000 node entries and 64 alternatives per lifted expression or final result. `maxOutcomes` bounds intermediate choices even when a later expression could reduce the result. This replaces v1's cumulative leaf-outcome counter. Callers may explicitly set `maxSteps` and `maxOutcomes`; exhaustion throws `SymbolicEngineError` rather than returning a truncated result.

`steps` includes node entries that deliver cached operands. `visitedExpressions` omits those deliveries, so it can contain fewer entries than `steps`. Neither field counts all internal specification operations.

Set `captureTrace: true` to include `evaluations`, an ordered array of guarded syntax-node visits. Each entry records the node type, source text, and start/end indices in the parsed `(${source}\n)` wrapper. Specializing its guards selects the syntax trace for a concrete Boolean assignment. It excludes cached operand deliveries and internal specification operations. Trace capture is off by default and does not change outcomes, step counts, or `visitedExpressions`.

Source length is limited to 4,096 UTF-16 code units. Nesting is limited to 128 validation levels. You can declare up to eight unique input names, each at most 128 UTF-16 code units. These limits do not bound a single expensive operation, parsing, or host allocation. This is not a security sandbox.

## Validation

The scalar tests substitute every Boolean assignment in each fixture and compare with the unmodified engine. Normal values and exception names also match independent Node execution; exception messages are compared only with engine262. The oracle checks complete, disjoint guard partitions and compares specialized syntax traces, including evaluation order. It executes each reference witness once, including throwing cases.

The earlier 17-operator and six-unary-operator matrix over 17 literals remains. A separate suite tests every selected literal pair for 23 binary/control operators, fixed-seed nested expressions, and integer boundaries. See the [parity goal and evidence](parity.md) for counts, commands, and limits.

Regression tests cover correlated choices, short-circuit skips, exceptions before right operands, shared prefixes, JSON round trips, eight-input partitions, and budget failures at every dispatch boundary of a compound expression. These checks do not establish arbitrary JavaScript compatibility.

React rendering, hooks, event transitions, mutable branch state, general symbolic values, and symbolic loops remain unsupported. Published-engine and source-built-engine compatibility checks are reported separately. Neither establishes general symbolic or React support.
