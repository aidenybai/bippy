# Third-party notices

## Maintained engine and runtime integration

`src/engine/` and `experiments/engine262/` import the maintained [engine source fork](engine/readme.md), based on engine262 revision `f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a`, by engine262 Contributors. Its [MIT license](licenses/engine262-mit.txt) is retained verbatim here and in the vendor tree. The fork retains upstream source and macro-transform code, generated Unicode data, and a bundled Test262 harness. Its provenance, local changes, and the Test262 BSD/patent notice are recorded in the engine directory.

The exact npm dependency `@engine262/engine262@0.0.1-f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a` remains a regression reference with a [package patch](../../patches/@engine262__engine262@0.0.1-f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a.patch) for selected non-Unicode legacy regex grammar. The maintained fork includes that source patch and builds its own bundle and declarations.

The browser probe reuses installed MIT-licensed React and Happy DOM packages natively through an object boundary. A separate reconciler probe bundles installed React and `react-reconciler` into the engine realm, with a project-authored host renderer. Neither probe recreates React's hooks or class lifecycle implementation. The production `StaticRenderer` engine path additionally bundles the project's installed React and React DOM, plus the existing snapshot recorder, into the engine realm. Shared runtime and browser adapters now live in `src/engine/`; experiments reuse them. No new React implementation was copied into the adapters. Execution remains concrete-only, and the old symbolic backend is still the default. See [the integration contract](src/engine/readme.md) and [the experiment report](experiments/engine262/readme.md).

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
