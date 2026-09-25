# bippy-analyzer

A pinned engine262 dependency, the existing Test262 harness, and module-resolution primitives. No engine fork, patches, symbolic execution, or React integration yet.

Requires **Node 26+**. The published engine uses native APIs such as `Map.prototype.getOrInsertComputed` that Node 24 lacks.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test:test262 '.test262/test/built-ins/Object/is/*.js'
```

`test` uses Vite+/Vitest to check the public engine API, realm isolation, and module resolution against native Node and actual toolchains.

`test:test262` fetches and verifies the pinned suite, then invokes `test262-harness` against engine262's published CLI. Supply quoted test paths or globs relative to this package. Failures produce a nonzero exit code. The harness's default timeout is 10 seconds per variant.

The suite is stored in ignored `.test262/`. Its revision is pinned in `scripts/setup-test262.ts`; an existing checkout with a different revision or local changes is rejected, not overwritten. `pnpm --filter bippy-analyzer setup:test262` performs just this setup/check.

For JSON output, add `--reporter=json` and use pnpm's `--silent` option. To request the full suite, use `'.test262/test/**/*.js'`; that is a much larger run, not the default smoke check.

## Module resolution

Use `createResolver({ rootDirectory, mode })` from `src/index.ts` for project-aware source lookup. Its `discover()` method returns independent browser and Node outcomes, classified as browser-only, Node-only, both, or neither. For a single-context `resolve()`, provide a platform on the request or constructor; discovery never chooses an execution target. It discovers TypeScript/JavaScript configuration and supported static toolchain aliases, then resolves through Oxc. No browser extension, Bippy bundler plugin, or application configuration changes are required. See [project-aware resolution](docs/project-resolution.md) for the API, configuration diagnostics and unsupported cases.

`allowConfigExecution: true` opts into bounded execution of installed Next webpack configuration, including wrappers and callbacks. Untrusted configuration still requires an outer sandbox. Browser lookups reject unprovided Node builtins; individual requests can select an explicit Node platform.

Resolution is separate from loading and execution. Explicit Oxc policies and native Node/toolchain adapters remain available for lower-level use and differential tests; callers of the project-facing API do not choose between those adapters.

See [module resolution](docs/module-resolution.md) for examples, prior research, validated behavior, and limits. The [ten-repository audit](corpus/module-resolution/README.md) retains successful resolutions, policy differences and native build failures. [Toolchain research](docs/toolchain-resolution-research.md) explains configuration discovery and backend-specific behavior. Native Next/Turbopack fixtures and compile-mode builds are tested; complete integration is **not** implemented.

## Initial engine results

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
