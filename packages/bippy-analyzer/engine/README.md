# Source-built engine262

The symbolic evaluator loads `dist/engine.mjs`, built from pinned engine262 TypeScript sources. It no longer edits a compiled bundle at runtime. The published package stays unmodified and supplies the independent concrete reference.

## Build and check

From the repository root, with Node 26+, Git, and a frozen dependency installation:

```sh
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer typecheck
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer test:engine-build
```

`typecheck` and `test` build first. A valid, current build is reused. `build:engine --force` performs a clean build. `test:engine-build` compares two clean builds in different filesystem roots, including JavaScript, maps, declarations, license, and manifest.

The source API requires the full workspace installation, including build dependencies. This private package is not yet a standalone production-only distribution. Call `build:engine` before importing the source API in another process. Runtime loading verifies inputs and artifacts but never builds, patches, or writes files. Missing, changed, or stale artifacts produce an error with the original cause.

Do not rebuild during active analysis. Restart the consuming process after a rebuild because JavaScript modules are cached. Build processes use an exclusive `.build/lock` directory. After a terminated build, remove that directory only after confirming no build is running.

## Inputs and source changes

`source.json` records the upstream commit, npm version, source-tree hash, published bundle hash, harness-data hash, and macro-transform hash. The npm package includes the TypeScript source and generated Unicode/error data for that release. The build uses those pinned bytes rather than fetching mutable Unicode data or an unpinned Git checkout.

The source changes are checked in under `patches/`:

- `evaluation-hook.patch` adds `AgentHostDefined.evaluateNode` and invokes it in `Evaluate`, after node observation and debugger handling. Returning `undefined` preserves ordinary dispatch. A returned evaluator supplies the node's completion.
- `string-substr.patch` adds Annex B `String.prototype.substr`. It reuses `RequireObjectCoercible`, `ToString`, `ToClampedIndex`, and `ToIntegerOrInfinity`, preserving their coercion order and abrupt completions. The final substring uses the same native string operations as existing engine intrinsics.
- `simple-parameters.patch` binds simple function parameters through the existing `BindingInitialization` operation. It avoids internal iterator allocations while retaining argument objects and duplicate-parameter behavior. Defaults, rest parameters, destructuring, and debugger observation retain the original iterator path. [Validation and timing measurements](../docs/parameter-binding-validation/README.md) describe the tested scope.
- `lazy-argument-accessors.patch` defers private mapped-argument accessor allocation until a descriptor read. Existing engine operations still implement aliasing and mutations. Accessors retain their original realm, and debugger callbacks keep eager construction. [Accessor validation](../docs/lazy-argument-accessors-validation/README.md) records tests and performance limits.
- `unused-arguments.patch` adds the opt-in `elideUnusedArguments` agent option. It omits argument objects and their bindings only when raw body and parameter text contain no `arguments`, `eval`, or backslash. Node, evaluation, or debugger callbacks at function entry retain allocation. Internal iterator breakpoints also retain allocation. Default agents keep the original bindings. [Unused-argument validation](../docs/unused-arguments-validation/README.md) defines the host restrictions and records the measurements.
- `object-checkpoint.patch` adds agent ownership and reusable checkpoints for selected ordinary objects. It restores property descriptors/order, prototypes, and integrity without cloning value identities. Saved references participate in engine garbage collection. [The checkpoint contract](../docs/object-checkpoints.md) excludes unselected objects, captured bindings, jobs, and continuations; it is not yet symbolic React isolation.
- `declarative-roots.patch` marks each declarative binding record during garbage collection. The upstream marker does not traverse the native binding map; values reachable through lexical bindings, captured parameters, or saved getters could otherwise lose their weak references. [Validation](../docs/declarative-roots-validation/README.md) retains the failing cases and independent V8 comparisons. This is not binding restoration.
- `binding-checkpoint.patch` adds `createStateCheckpoint` for selected ordinary objects and declarative/function bindings. It preserves environment and cell identity, initialization, flags, aliases, and saved-value GC roots. [The contract](../docs/state-checkpoints.md) excludes module environments, pending disposal, uninitialized constructor receivers, jobs, and continuations. The ordinary-object API retains its contract and shares the nested checkpoint stack.
- `typecheck.patch` removes one unused `@ts-expect-error` before an existing `console.assert` in `EvaluateBody.mts`. The pinned Node types define `console`, so the suppression itself fails strict checking. This patch does not change executable statements or disable a typecheck.

The build copies sources into `.build/source`, applies these patches, and checks the patched source with the pinned TypeScript native compiler. Babel strips TypeScript, handles decorators, and runs upstream's completion-macro transform. Rollup bundles the resulting JavaScript. The target is Node 26+, not downleveled browser code.

`vendor/transform.mts` is an unchanged copy of upstream `scripts/transform.mts` at the pinned commit. Its MIT license is in `vendor/LICENSE`. Do not format or edit that file independently of an upstream update. The generated bundle retains the license banner and includes a license file.

The build follows upstream's Unicode case-folding treatment by embedding the dependency's map data. Other dependency code is bundled through the pinned Rollup plugins. Dependency versions and transitive resolutions are fixed by `package.json` and the repository lockfile. Unrelated workspace dependencies are not refreshed to adopt this build.

## Outputs and integrity

Generated files stay in ignored `dist/`:

- `engine.mjs`: the extended engine.
- `engine.mjs.map`: a source map with embedded source content and root-independent source names.
- `declaration/`: declarations emitted from the patched source, including the hook's type.
- `LICENSE`: upstream's license.
- `manifest.json`: source/build identity, build Node version, and hashes of all other output files.

Build identity includes the pinned source/data, local build scripts, patches, vendor files, configuration, package manifest, installed tool metadata, and lockfile. Exact direct tool versions must match their package declarations. Verification rejects missing, changed, or extra artifacts. A successful build publishes verified output after compilation; a failed build does not promote partial output. Build and cleanup failures remain observable.

The manifest detects stale or changed inputs and outputs. It is not a signature, a sandbox, or a substitute for a frozen, trusted toolchain installation. Reproducibility is tested between clean roots under one installed toolchain; that alone is not proof across every Node version or platform.

## Concrete compatibility

Unit tests compare supported symbolic expressions and additional concrete JavaScript cases with the published engine. They also check typed hook dispatch, abrupt completions, source-map locations, artifact verification, and CLI module flags.

The existing Test262 harness can use the built engine:

```sh
pnpm --filter bippy-analyzer test:source-test262 \
  '.test262/test/built-ins/Object/is/*.js' \
  '.test262/test/language/module-code/top-level-await/syntax/await-expr-dyn-import.js' \
  '.test262/test/annexB/built-ins/String/prototype/substr/*.js'
```

The TypeScript CLI adapter runs upstream’s published CLI. `cli-api.ts` re-exports the verified engine and enables `elideUnusedArguments` for CLI agents. It does not replace evaluation, the Test262 runner, or validation. Its executable entrypoint preserves module flags that the harness prepends. The harness uses two workers and its unchanged default timeout.

The broader existing baseline selection produced **301 passes and 5 failures in 306 variants** for both engines. The same test variants failed. This is pass/fail parity for that selection, not equality of diagnostic text or full conformance. Source-map paths and upstream crash normalization produce different failure messages; those diagnostics are retained separately. The three strict tail-call cases and two Promise constructor cases remain failures.

[Archived Test262 receipts](../docs/engine-build-validation/summary.json) preserve per-variant verdicts and raw process diagnostics. They replace source and compiled text with hashes and record the original report hashes. They also retain the rejected adapter run.

The first adapter invocation placed module flags before the `tsx` script argument and rejected two module variants. That was a CLI integration failure, not an accepted engine result. The executable adapter fixes the argument ordering, and a regression test covers it.

The source build's Object.is smoke passes 42/42 variants. Its added `substr` selection passes 30/30, against 0/30 for the published engine. [Intrinsic receipts](../docs/engine-substr-validation/summary.json) retain identical input hashes and both engines' diagnostics. The broader baseline still passes 301/306 after the intrinsic patch. The package README retains the published harness's limitations. Adding this concrete intrinsic does not make its operations symbolic or add heap merging.

## Upgrade procedure

1. Select an exact engine262 release and review its matching Git source. Inspect the affected React internals before extending React-facing behavior.
2. Update `source.json` from that package's source, bundle, and generated harness data. Refresh the unchanged upstream macro transform and license if needed.
3. Rebase the source patches. Remove the typecheck patch if upstream no longer needs it. Review every executable change separately from tooling changes.
4. Update only required toolchain dependencies. Preserve unrelated lockfile resolutions and verify a frozen install.
5. Run relocated clean-build comparison, source and analyzer typechecks, unit tests, and both published/built Test262 selections.
6. Record changes in results and diagnostics. Do not increase budgets, hide failures, or promote a narrower selection as broader compatibility.
