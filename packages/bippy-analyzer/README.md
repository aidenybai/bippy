# bippy-analyzer

An unmodified, pinned engine262 dependency and the existing Test262 harness. No engine fork, patches, symbolic execution, or React integration yet.

Requires **Node 26+**. The published engine uses native APIs such as `Map.prototype.getOrInsertComputed` that Node 24 lacks.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test:test262 '.test262/test/built-ins/Object/is/*.js'
```

`test` uses Vite+/Vitest to check the public engine API and realm isolation.

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
