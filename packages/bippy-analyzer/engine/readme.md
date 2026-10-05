# Bippy engine fork

This directory contains the analyzer's maintained engine262 fork, build scripts, and licenses. The analyzer and experiments import it through the private `#engine` alias; there is no separate engine workspace package. `StaticRenderer({ execution: "engine" })` now runs application code, React DOM, and snapshot capture through the [production engine path](../src/engine/readme.md). The existing interpreter remains the default until symbolic and framework contracts are ported.

Concrete execution works. Abstract values, guarded heaps, forkable continuations, and symbolic React execution are **not implemented**.

## Build

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer typecheck:engine
pnpm --filter bippy-analyzer test \
  tests/engine262-fork.test.ts \
  tests/engine262-experiment.test.ts \
  tests/engine262-membrane.test.ts \
  tests/engine262-reconciler.test.ts \
  tests/engine262-host-operations.test.ts \
  tests/engine262-machine.test.ts \
  tests/engine262-checkpoint.test.ts \
  tests/engine-native-captures.test.ts \
  tests/engine-owned-state.test.ts \
  tests/engine262-test262.test.ts
```

`scripts/build.ts` runs upstream's completion-macro transform, Babel's TypeScript/decorator/resource-management transforms, the generator lowering in `scripts/lower-generators.ts`, and esbuild. Removing the completion-macro pass would change execution semantics. Unicode case-folding maps are resolved at build time, avoiding a bundled CommonJS `zlib` require in ESM output.

The analyzer's private `#engine` import maps to the built bundle and its generated declarations. `#self` retains upstream's self-import name; neither alias is a public package export.

TypeScript generates declarations from the current fork source into `dist/types`. Copied package declarations are not used as the fork's type authority. Both the bundle and declarations are ignored build output. Repository build and analyzer typecheck scripts include this directory.

The original focused suite has **352 tests**: 205 boundary/component/reconciler tests, 51 control-machine tests, 26 checkpoint tests, and 70 Test262-runner/module tests. Seventeen production-renderer integration tests cover engine-owned React DOM and API boundaries. The native-capture/state tests add closure discovery and declared-heap restoration. These finite regressions are not exhaustive language or React compatibility.

## Explicit concrete control

`src/execution-machine.ts` drives lowered algorithms with an explicit stack. Frames hold program counters, hoisted activation locals, completion handlers, and delegated iterators. The application still runs through engine262's algorithms; there is no second application-language evaluator.

The lowering uses Babel's generator emitter, not its opaque invocation runtime. It preserves the completion-macro output and supports `next`, `throw`, `return`, delegation, and suspension. Native-backed tests cover captured writes, parameter scopes, loop closures, receivers, abrupt completions, and iterator closing. A 20,000-frame delegation test and a 2,000-call application test run without native recursion.

Upstream `IsInTailPosition` was a stub returning false. The fork now identifies strict tail positions and replaces the owning continuation. Constructors retain their result checks; pending iterator closing, catch/finally work, and resource disposal prevent unsafe transfers. Calls through bound functions, proxies, `call`, `apply`, and `Reflect.apply` have bounded measured continuation depth between 10 and 1,000 recursive calls. This measures active frames, not retained heap.

The compiler is for engine implementation code, not a general-purpose JavaScript transpiler. Babel's block-scoping pass does not preserve host-source TDZ behavior; enabling its TDZ option incorrectly resets loop bindings. Application TDZ remains implemented by engine262. Host-generator prototype/reflection parity is not promised.

### Control checkpoints, not general state forks

`captureControl(iterator, owner)` can restore a suspended continuation without executing its prefix again. The compiler lazily describes lexical captures, including mutable parameter bindings. It now also records captures for ordinary function declarations, function expressions, and arrows. The driver follows registered closures transitively; the owner's optional `references` hook exposes heap edges, including callbacks that lead back to completed creator frames. It saves referenced activation locals, completion handlers, delegation, forwarding, and discovered creator frames. It restores captured bindings and control before calling the supplied state's `restore` method.

The owner is mandatory and trusted. It must account for reachable mutable heap state, unregistered native closures, execution contexts, jobs, host effects, and ambient dependencies—or reject the checkpoint. Metadata does not cover every native callable or hidden state. Control-owned frames/local records must not be duplicated by a heap copier. Restoring is sequential: retained results or escaped callbacks do not automatically become independent branch snapshots.

`OwnedState` supplies restoration for caller-certified records, arrays, Maps, Sets, and registered closures. Its required `describe` policy must certify the objects' state—not infer ownership from a familiar prototype. Private fields can exist on an ordinary-looking object. The policy must also exclude untracked native effects during execution. This is a trusted closed-code profile, not a sandbox or automatic realm classifier. Aliases, cycles, sparse arrays, symbol descriptors, collection order, and supported property-order changes are restored. Discovery does not invoke accessors; native proxies, undeclared ambient names, missing schemas, unregistered callbacks, and unsupported internal state are refused. Irreversible changes poison captured control rather than resume an invalid state.

Native closure metadata uses private fields on the original functions, preserving identity, prototypes, own keys, and integrity. This avoids the allocation/collection cost found with a WeakMap entry for every temporary callback. Inferred names use native named evaluation. Frame emitters and nonescaping compiler-generated factories already have control metadata and are not registered twice. Object/class methods, dynamic computed-name closures, private environments, native arguments aliasing, weak collections, and engine job/realm adapters remain unported.

Tests cover native-backed completions, mutable parameters, completed creator frames, alias-preserving heap restoration under an explicit fixture policy, and an actual engine262 constant-expression continuation. Instrumented prefixes execute once. That engine test restores a narrowly scoped execution-context stack; it is not a general realm snapshot. A new fixture restores escaped native cells, shared heap aliases, an explicit callback array, and return/throw/finally paths with one prefix execution. That callback array is not an engine job queue, and the fixture does not declare abstract inputs.

Running frames, foreign delegates, overridden continuation methods, accessor/immutable locals, and changed read-only captures are rejected. Only compiler-owned control objects are supported; arbitrary host mutation of their shape or prototypes is outside the ownership contract. State policies cannot resume a machine while capturing/restoring. A failed state restore poisons captured continuations; callers must abandon the affected analysis, including escaped callbacks. There is no built-in general heap/job owner, abstract decision mechanism, or safe general-purpose fork API.

### Replacing the build compiler

Babel remains a build-time bridge for upstream's completion macros and generator emitter. Oxc at inspected revision `cd80e3f10d3c0a4a8d7c3c98a813bbe54c99cf89` targets ES2015 and above; its ES2015 pass does not lower ordinary generators into state machines. Its async-to-generator transform does not solve this control-ownership requirement. A replacement needs an Oxc-parsed, TypeScript-authored compiler for completion macros and explicit frames/captures, with the existing differential and Test262 gates retained. Swapping parser packages alone is insufficient. No Oxc code was imported for this investigation.

## React inside the engine

[`reconciler-probe.ts`](../experiments/engine262/reconciler-probe.ts) bundles installed React 19.3.0, `react-reconciler` 0.34.0, the application, and a small host renderer. All four execute in one engine realm. Tests check that React's element factory, the reconciler factory, the component, and the render entry point are engine-owned functions.

The native oracle executes the same bundle with V8 in a fresh closure. It shares the host renderer and virtual clock, so it checks execution under that host policy—not browser behavior or an independent renderer implementation.

The host implements tree insertion, movement, removal, text updates, visibility, and callback invocation. React supplies hooks, classes, queues, effects, error boundaries, and Suspense. Tests cover hook updates and cleanup; class/private-field lifecycles; context, memo, reducers and refs; keyed movement; error boundaries; external stores; transitions/deferred values; suspension and promise `use`; callback-ref cleanup; effect order; and render-phase updates.

Observations include host trees with scalar props, scalar application traces, and errors. Special numbers, BigInt, and undefined use tagged JSON values; trace accessors are read once per observation. Non-scalar traces are rejected. Object-valued host props and event handlers are not compared as data.

This is a production-build, mutation-mode test renderer. It is not React DOM. Hydration, resource loading, browser events, form reset, scopes, and view transitions are not supported. The existing native-React/browser membrane remains a separate concrete baseline.

## Test262

Build the engine, then create a pinned [Test262 checkout](https://github.com/tc39/test262):

```sh
git clone --no-checkout https://github.com/tc39/test262.git /tmp/bippy-test262
git -C /tmp/bippy-test262 checkout --detach 045bf6f9966ce3291b8fbc1e0403cd97b9201b00
pnpm --filter bippy-analyzer build:engine
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262
```

Broader selections are available without changing the runner:

```sh
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262 \
  --scope language/expressions/generators --scope language/statements/generators
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262 \
  --scope language/expressions/async-function --scope language/statements/async-function \
  --scope language/expressions/async-generator --scope language/statements/async-generator
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262 \
  --scope language/module-code --scope language/expressions/dynamic-import
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262 \
  --all --shard 1/16 --list
pnpm --filter bippy-analyzer --silent test:engine:test262 /tmp/bippy-test262 \
  --all --shard 1/16 > report.json 2> progress.jsonl
```

`--scope` selects exact files or recursive directories; repeated scopes form a union. `--all` selects all tracked `.js` tests except `_FIXTURE` support files. Shards use stable path hashes and one-based `INDEX/TOTAL`; they are disjoint, including when scopes change. `--list` reports selection only, not execution. The pinned tree contains 53,889 JavaScript files: 53,595 test candidates and 294 fixture files. Listing all candidates does not establish support for them.

Each attempted variant runs in a fresh Node process and engine realm. Limits are two million evaluated nodes, 10,000 drained jobs, 60 seconds wall time (`--timeout` overrides milliseconds), 384 MiB V8 old-space, and 1 MiB worker output. Old-space is not a total RSS limit, and process isolation is not a sandbox. Reports record entry/dependency source SHA256s, engine-bundle and runner-source hashes, Node version, selection/fixture/shard exclusions, and separate result categories. A dirty test/harness tree at completion also makes the run unsuccessful. Stderr streams start/result JSONL records so completed outcomes survive an interrupted run; only a completed stdout report supplies final totals. Do not rebuild the engine or edit runner sources during a run; a changed final hash makes the run unsuccessful.

[The manual workflow](../../../.github/workflows/engine-test262.yml) offers regression, generator, async-function/generator, module/dynamic-import, and full-tree selections plus a shard input. It uploads reports even on failure. It is not a mandatory green PR gate, and has not yet run remotely for these uncommitted changes.

By default, the runner selects `tco.js` and `tco-*.js` files throughout the test tree and immediate `.js` files in four directories: `built-ins/Object/isFrozen`, `built-ins/Object/seal`, `language/statements/try`, and `language/statements/for-of`. It verifies the checkout revision and cleanliness, loads the requested harness includes, honors strictness flags, and distinguishes negative parse/early/resolution/runtime tests. Modules run once with module grammar, not a prepended strict directive. Scripts and modules drain the engine job queue before passing.

The module loader caches records per realm, registers entry modules for cycles, preserves live bindings, and supports static/dynamic imports and top-level await. It loads relative JavaScript fixtures inside the test tree, including `_FIXTURE` files excluded from standalone selection. Loading is capped at 512 dependencies and 4 MiB per fixture. Missing paths and unmapped bare specifiers produce catchable engine TypeErrors; unreadable fixtures produce harness errors. Non-JavaScript fixtures, nonempty import attributes, source/defer loading, query/hash specifiers, and paths escaping the tree remain unsupported. A host-level refusal abandons the fresh agent; it cannot be caught as an application exception or hidden by a context-cleanup error. Pending module evaluation at job quiescence is incomplete, even if `$DONE` already ran.

For async tests, the pinned `doneprintHandle.js` loads after `assert.js`/`sta.js` and before requested includes. Raw tests load no harness code and can use the `print` protocol directly. Completion requires exactly one `Test262:AsyncTestComplete` signal and an empty job queue; a failure signal, duplicate completion, or missing completion at quiescence fails. Jobs continue after an initial success signal, so late failure signals are not hidden. A job/node/deadline limit produces an incomplete result.

Unhandled promise rejections are counted per variant and in the report, not automatically converted into uncaught exceptions. Some tests intentionally leave rejected promises: `language/statements/async-function/evaluation-body.js` checks synchronous body entry and leaves a rejected result unobserved. A rejection with no required async completion still fails for missing completion. Attaching a handler removes that promise from the rejection set.

The rerun with isolated workers has **475 selected files**, **885 attempted variants**, and **53,414 excluded files** (53,120 outside the selected scopes and 294 fixtures):

| Result               | Count |
| -------------------- | ----: |
| Passed variants      |   883 |
| Failed variants      |     2 |
| Engine errors        |     0 |
| Unsupported variants |     0 |
| Harness errors       |     0 |
| Incomplete variants  |     0 |

The two failures are the strict/sloppy variants of `Object/seal/seal-sharedarraybuffer.js`: the raw engine has no SharedArrayBuffer global. All 35 selected tail-call files now pass without reducing Test262's iteration counts. The previously unsupported async and module resource-disposal tests now pass. No selected baseline file remains unsupported.

The complete two-directory generator selection passed all **1,056 variants across 556 files**, with no unsupported files, failures, harness/engine errors, or incomplete variants. Shard `1/16` separately passed 74 variants across 39 files. The four async-function/generator directories passed **2,096 variants across 1,091 files**, with two reported unhandled rejections from the intentional case above. `built-ins/Promise/resolve` and `built-ins/Promise/prototype/then` passed **206 variants across 105 files**, with six reported unhandled rejections. Neither run had failures, unsupported files, harness/engine errors, or incomplete variants. The full 53,595-candidate tree has only been listed, not executed.

The module-code and dynamic-import directories ran **2,502 variants across 1,604 files**: **2,344 passed**, **158 were unsupported**, and none failed or produced harness/engine errors or incomplete outcomes. They reported 82 unhandled rejections, including imports of deliberately unresolved specifiers. Unsupported variants remain nonpasses, so this selection still exits unsuccessfully.

Negative tests match the thrown exception's constructor name and required phase, not a spoofable `error.name`. Module loading/linking and evaluation errors are checked separately; expected resolution failures do not execute module bodies. Queued jobs are drained even after an expected synchronous runtime exception. Async runtime-negative completion matching, the module-loader restrictions above, unimplemented host flags, and the raw engine's optional ECMA-402 profile remain explicitly unsupported. Unsupported results also make the command unsuccessful; no expected-failure allowlist converts known defects into passes. This run does not establish Test262 conformance. The browser experiment's host-backed binary intrinsics do not repair the raw engine's missing SharedArrayBuffer implementation.

## Source and licenses

Upstream: [engine262/engine262 at `f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a`](https://github.com/engine262/engine262/tree/f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a), MIT. [`vendor/engine262/LICENSE`](vendor/engine262/LICENSE) is retained verbatim.

Imported from that revision:

- `src/`, preserving upstream paths and style.
- `scripts/transform.mts`, unchanged, including upstream's typecheck suppression.
- `tsconfig.base.json` and the license.

The three generated Unicode JSON files and `lib/test262-harness.json` come from the exact pinned npm distribution. The latter embeds Test262 harness source and its individual notices; upstream's bundler changes `Test262Error` to extend `Error`. Engine262 pins that harness submodule to `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Its [Test262 license](vendor/test262/LICENSE), including the patent notice, is retained verbatim and verified against that revision. This bundled harness is distinct from the newer checkout used by the scoped runner.

Local source changes:

- `parser/RegExpParser.mts`: the existing non-Unicode identity-escape and literal brace/bracket patch, including valid-quantifier detection.
- `utils/container.mts`, `utils/map.mts`, and `execution-context/Agent.mts`: map insertion without requiring Node's newer `getOrInsert`/`getOrInsertComputed` methods. Existing keys with `undefined` values remain present.
- `runtime-semantics/EvaluateBody.mts`: remove an unused `@ts-expect-error`; Node types declare `console` in this build.
- `static-semantics/IsInTailPosition.mts`: replace the stub with strict tail-position analysis, retaining cleanup boundaries.
- `abstract-ops/{function-operations,object-operations,proxy-objects}.mts`, `runtime-semantics/EvaluateCall.mts`, and `intrinsics/{FunctionPrototype,Reflect}.mts`: register continuation boundaries and transfer tail calls through the explicit driver.
- `index.mts`: export synchronous control measurements, native capture inspection, and the low-level, state-owner-dependent checkpoint APIs.

Project-authored build/test scripts use TypeScript. Formatting and linting exclude recognizable upstream source. The pinned npm package and its patch remain installed as a regression reference, not as the fork's implementation.

The generated bundle also contains jsbd 0.0.11, Unicode 17 data, and Babel helpers. Their notices are retained under `licenses/` and copied to `dist/licenses` during the build, alongside the engine262 and Test262 licenses. The node-unicode MIT notice comes from its generator repository at `13dd77f8bcfbb8b876bc4e05518486c722178f22`; the Unicode data notice comes from <https://www.unicode.org/license.txt>. jsbd and Babel notices are copied verbatim from the installed packages. Completion dispatch in `src/execution-machine.ts` is adapted from Babel helpers 7.29.7's regenerator runtime; its separate Facebook copyright is retained in `licenses/babel-helpers-mit.txt`. The build reuses `@babel/plugin-transform-regenerator` 7.29.8 rather than vendoring that compiler.

## Next gate

The concrete driver now owns delegation and tail-call transfer, but lowering has not made every captured value explicit or branch-owned.

Before symbolic branching can preserve mutation and jobs, execution must own captured cells and heap versions. Adding an opaque value class or choosing concrete Boolean assignments would not satisfy that gate. See the [implementation plan](../../../docs/unified-engine-plan.md).
