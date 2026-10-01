# Third-party notices

## React Compiler

`src/compiler/enter-ssa.ts` and `src/compiler/eliminate-phis.ts` adapt React Compiler's sealed-block SSA construction and redundant-phi rewriting, by Meta Platforms, Inc. and affiliates, under the MIT license.

Sources: [`EnterSSA.ts`](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EnterSSA.ts) and [`EliminateRedundantPhi.ts`](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EliminateRedundantPhi.ts), pinned to `59aff3e18cb5b3a336c280bbfa57ec37999511b9`.

Bippy supplies its own CFG, keys phi operands by incoming edge, fills deferred phis iteratively, and extends simplification to strongly connected phi groups. Its source lowering, constant propagation, verifier, and bounded evaluator are separate implementations, not React's optimization pipeline or runtime.

The full copyright and license notice is included in [licenses/react-mit.txt](licenses/react-mit.txt). Oxc's corresponding Rust passes were examined as references; no Oxc implementation was extracted.

## TypeScript

The flow-narrowing algorithms in `src/evaluate/narrowing.ts` and Boolean-comparison normalization in `src/evaluate/operators.ts` are adapted from TypeScript, by Microsoft Corporation and its contributors, under the Apache License, Version 2.0.

Sources examined:

- [`tsc/internal/checker/flow.go`](https://github.com/microsoft/TypeScript/blob/5f6db9c9148635b4cbf72f1193b821b9c6b42dcc/tsc/internal/checker/flow.go): `narrowTypeByBinaryExpression`, `narrowTypeByEquality`, and `narrowTypeByBooleanComparison`.
- [`src/compiler/checker.ts`, v6.0.3](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/src/compiler/checker.ts): the corresponding TypeScript implementations.

Bippy changes these algorithms to operate on guarded evaluator values rather than TypeScript types. It preserves source input identity in refined scalar views, restricts literal substitution to strict equality, excludes uncertain numeric zero, limits compound refinement to read-only tests, and normalizes Boolean comparisons only when the operand is already modeled as Boolean. Bippy does not import TypeScript's annotation-based type assumptions or compiler implementation.

The full license is included in [licenses/typescript-apache-2.0.txt](licenses/typescript-apache-2.0.txt). See [the research notes](docs/compiler-research.md) for the adaptation and its limits.
