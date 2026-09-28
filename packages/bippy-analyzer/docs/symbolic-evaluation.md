# Symbolic evaluation

`evaluateSymbolicExpression()` is part of the analyzer's source API. It uses engine262's parser and evaluator, with a small evaluation hook for unknown Boolean conditions. It does not use the old analyzer's JavaScript interpreter or compiler.

```ts
import { evaluateSymbolicExpression } from "bippy-analyzer";

const result = await evaluateSymbolicExpression("enabled ? 2 + 3 : 4 * 5", ["enabled"]);
```

The result has two outcomes:

```text
result
├── enabled  → Number("5")
└── !enabled → Number("20")
```

Each outcome carries a guard and either a scalar value or an exception's name and message. Numbers use strings to preserve `NaN`, infinities, and negative zero through JSON. BigInts use decimal strings. The output is not a React tree or a complete JavaScript exception snapshot.

## What engine262 does

engine262 parses the source, resolves input bindings, evaluates concrete expressions, applies JavaScript coercions and arithmetic, and produces exceptions. No arithmetic, JavaScript parsing, or ordinary operator implementation was copied from the old interpreter.

An override in engine262's `Evaluate` dispatcher handles symbolic conditional expressions and symbolic Boolean negation. Everything else goes through the existing dispatcher. The override runs after the engine's node-observation and debugger hooks. An absent override preserves the original dispatch.

For an unknown condition, the adapter evaluates the two branch bodies through engine262 and attaches guards to their results. It tracks decisions by input identity: a nested contradictory branch is never executed. The enclosing script is not rerun for every assignment to all declared inputs. The current implementation can still grow with the number of feasible branch outcomes; it is not a general path-merging algorithm.

## Engine extension

The installed engine remains unmodified and is the independent concrete oracle in tests. The symbolic loader imports a source-built engine from `engine/dist/engine.mjs`. Runtime loading never edits a bundle, builds code, or creates a temporary engine file.

Run `pnpm --filter bippy-analyzer build:engine` before consuming the source API. The build applies the typed hook to pinned engine262 sources and emits JavaScript, declarations, and a valid source map. The loader verifies source/build identity and artifact hashes before importing the result. Missing, changed, or stale artifacts fail with a rebuild instruction and the original cause.

Only one extended module is loaded per host module instance. Every request gets a fresh agent and realm; synchronous evaluation restores the previous agent even on failure. Results retain the `originalEngineSha256` and `patchedEngineSha256` fields. The latter now identifies the source-built extension, not a runtime-patched copy.

Pinned upstream:

- engine262 commit: `a600354c2954300d62d108bf9ed3459a8e4a289b`
- npm package: `0.0.1-a600354c2954300d62d108bf9ed3459a8e4a289b`
- original ESM SHA-256: `bbc66b6f71a0f36e23c5ea07bbf3cc2c390de9c6c7bb1f4a0ecf5791b2b2600b`

The maintained source patch is `engine/patches/evaluation-hook.patch`. See [source-built engine262](../engine/README.md) for source provenance, toolchain pins, clean-build comparison, concrete checks, and upgrade instructions. This changes engine delivery, not the supported symbolic subset.

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
- Concrete arithmetic, equality, relational comparisons, and selected unary operations.
- Unknown Boolean inputs in ternary tests, including Boolean negation.
- Nested ternaries, correlated decisions, and guarded exceptions.

Rejected before execution, even in unreachable branches:

- Calls, objects, arrays, property access, mutation, declarations, loops, and async work.
- Symbolic arithmetic, symbolic equality, `&&`/`||`, and conditional results used as conditions or operands.
- Unknown Boolean tokens escaping into ordinary value positions.

Unknown inputs are internal opaque engine objects, not new general ECMAScript Boolean primitives. The AST boundary prevents the ordinary engine from coercing those tokens as objects. Removing that boundary without extending the affected semantics would be incorrect. Both branches may be evaluated in one realm only because the accepted subset cannot mutate application state or call user code. This is **not** heap isolation or state merging.

Defaults are 10,000 evaluated nodes and 64 scalar/throw outcomes. Callers may explicitly set `maxSteps` and `maxOutcomes`; exhaustion throws rather than returning a truncated result. Source length is limited to 4,096 UTF-16 code units. Nesting is limited to 128 validation levels. You can declare up to eight unique input names, each at most 128 UTF-16 code units. These limits do not bound the cost of a single arithmetic operation, parsing, or host allocation. This is not a security sandbox.

React rendering, hooks, event transitions, mutable branch state, general symbolic values, and symbolic loops remain unsupported. Published-engine and source-built-engine compatibility checks are reported separately. Neither establishes general symbolic or React support.
