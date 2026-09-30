# bippy-analyzer

A source-built engine262 runtime, its Test262 harness, and symbolic evaluation of pure scalar expressions. The symbolic API returns guarded results for unknown Boolean inputs. The separate concrete runtime executes scripts and supplied JavaScript modules, with selected real React and React DOM tests. General browser support and mutable symbolic state remain unfinished.

See the [roadmap](ROADMAP.md) for the remaining implementation stages and completion checks. See [symbolic evaluation](docs/symbolic-evaluation.md) for the API, engine extension, PR #115 reuse, and current limits. The symbolic evaluator uses a [source-built engine262 extension](engine/README.md). The installed dependency and its CLI remain unmodified. The [parity report](docs/parity.md) states what the current tests establish and what remains unsupported.

See [concrete execution](docs/concrete-execution.md) for `createConcreteRuntime()`, executable artifact loading, the restricted task host, and native React comparisons. React supplies both renderers used by these checks. A guest-owned LinkeDOM counter matches native V8 and Chromium observations. These selected checks do not establish general browser or symbolic React parity.

The separate [numeric domain](docs/numeric-domain.md) represents unbounded Number inputs through engine addition, subtraction, and unary negation. It preserves expression structure through calls and mutation, but rejects unsupported concrete reads. It does not yet provide guarded decisions or symbolic React output.

An [engine Boolean protocol](docs/boolean-decisions.md) suspends `if` statements on unknown inputs. [Expression decisions](docs/boolean-expressions.md) also support `?:`, `&&`, `||`, and `!`. Selected-state tests fork guarded outcomes with unbounded numbers and no prefix replay. General state ownership and integrated symbolic React exploration remain missing.

[Number SameValue predicates](docs/number-predicates.md) now drive actual React state bailouts with unknown Numbers. These are separate single-path runs, not isolated React branches. The [engine reuse audit](docs/engine-reuse-audit.md) defines what stays in engine262 and React, and why upstream preview/context copying cannot replace rollback.

The [guarded host-tree report API](docs/guarded-host-tree-reports.md) stores supplied JSON snapshots and guarded diagnostics. It preserves whole-tree correlation and distinguishes selected, uncovered, and ambiguous observations. It does not execute React or establish branch isolation. Reports keep execution and coverage unverified.

The [caller-owned Boolean snapshot driver](docs/boolean-snapshot-exploration.md) connects one engine evaluation to guarded reports without prefix replay. It requires a supplied state owner and snapshot observer. It does not verify isolation or enable a general React renderer.

The [native control-lowering contract](docs/native-lexical-scopes.md) preserves ordinary lexical scopes and lists rejected native source forms. Generator-scope TDZ and complete execution ownership remain unresolved.

Requires **Node 26+**. The published engine uses native APIs such as `Map.prototype.getOrInsertComputed` that Node 24 lacks.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter bippy-analyzer exec playwright install --with-deps chromium
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test:test262 '.test262/test/built-ins/Object/is/*.js'
```

`test` and `typecheck` build the extended engine first. Tests check the engine API, realm isolation, guarded results, rejection boundaries, concrete substitutions, source maps, and artifact integrity. Scalar tests compare with both unmodified engine262 and native Node execution. They also check guard partitions and syntax-node evaluation order. Concrete tests compare real React trees and lifecycle traces with V8, React DOM counter interactions with Chromium, and native-built modules with Node.

`test:engine-build` compares clean builds in different roots. `test:source-test262` uses the existing harness and published CLI with engine imports redirected to the built artifact. It accepts the same test paths as `test:test262` and does not hide failures.

`test:test262` fetches and verifies the pinned suite, then invokes `test262-harness` against engine262's published CLI. Supply quoted test paths or globs relative to this package. Failures produce a nonzero exit code. The harness's default timeout is 10 seconds per variant.

The suite is stored in ignored `.test262/`. Its revision is pinned in `scripts/setup-test262.ts`; an existing checkout with a different revision or local changes is rejected, not overwritten. `pnpm --filter bippy-analyzer setup:test262` performs just this setup/check.

For JSON output, add `--reporter=json` and use pnpm's `--silent` option. To request the full suite, use `'.test262/test/**/*.js'`; that is a much larger run, not the default smoke check.

## Initial results

On Node 26.4.0, this selection produced **301 passes and 5 failures across 306 harness variants (160 files)**, with no timeouts:

```sh
pnpm --filter bippy-analyzer test:test262 \
  '.test262/test/built-ins/Object/is/*.js' \
  '.test262/test/language/statements/try/*.js' \
  '.test262/test/built-ins/Promise/resolve/*.js' \
  '.test262/test/language/module-code/top-level-await/syntax/await-expr-dyn-import.js'
```

The failures are three `try/tco-*.js` cases and both variants of `Promise/resolve/arg-uniq-ctor.js`. They remain failures; there are no exclusions or expected-failure lists. The `Object.is` smoke selection alone passes 42/42 variants.

These are results from the published CLI/harness combination, not a claim of full engine conformance. The upstream harness checks negative error names rather than independently verifying error phases, and emits two variants for the selected module test. Its error normalization can obscure engine crashes. We retain these limitations rather than introduce a custom validator in this setup.
