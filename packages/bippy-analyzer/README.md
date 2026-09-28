# bippy-analyzer

A pinned engine262 dependency, its Test262 harness, and symbolic evaluation of pure scalar expressions. The source API returns guarded results for unknown Boolean inputs, including arithmetic, comparisons, and short-circuit expressions. React rendering and mutable symbolic state are not supported yet.

See the [roadmap](ROADMAP.md) for the remaining implementation stages and completion checks. See [symbolic evaluation](docs/symbolic-evaluation.md) for the API, engine extension, PR #115 reuse, and current limits. The symbolic evaluator uses a [source-built engine262 extension](engine/README.md). The installed dependency and its CLI remain unmodified.

Requires **Node 26+**. The published engine uses native APIs such as `Map.prototype.getOrInsertComputed` that Node 24 lacks.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test:test262 '.test262/test/built-ins/Object/is/*.js'
```

`test` and `typecheck` build the extended engine first. Tests check the engine API, realm isolation, guarded results, rejection boundaries, concrete substitutions, source maps, and artifact integrity. Scalar tests compare with both unmodified engine262 and native Node execution.

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
