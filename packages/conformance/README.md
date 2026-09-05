# Conformance

The canonical home for Bippy's unit tests, React conformance tests, DevTools fixture, test dependencies, tooling, and audit findings. This is a private test package, not a React implementation or a guarantee of universal compatibility.

## Run

```sh
pnpm test:conformance
```

Runs library tests, DevTools fixture tests, conformance tests, TypeScript checks, a production Bippy build, and fresh-process ESM/CJS checks against development/production React. CI uses the same checks. Browser and Detox E2E remain separate.

Focused commands:

```sh
pnpm --filter conformance test --project unit
pnpm --filter conformance test --project conformance
pnpm --filter conformance typecheck
pnpm --filter conformance coverage
pnpm --filter conformance test:built
```

Library coverage retains its original unit-test scope and writes reports to `coverage/` here. The normal test command runs all projects, including exact upstream stack assertions, without coverage instrumentation.

## Keep each contract in one place

- Add React behavior and adversarial regression tests in `tests/`. Extend an existing case rather than copying it into another suite.
- Keep implementation unit tests and their runtime helpers in `tests/unit/`, and DevTools facade tests in `fixtures/react-devtools-headless/`. `packages/bippy` contains library/build code, not a parallel test tree.
- `vite.config.ts` owns the project list used by both workspace and package test commands. Each project runs once. Unit tests have no shared setup hook so pre-installation, late-load, and frozen-hook cases keep their original load order.
- Test dependencies belong here or in the DevTools fixture package; only dependencies needed to build/type-check the library stay in `bippy`. Its existing test/coverage scripts delegate here.
- `upstream.json` is the sole upstream inventory. It records reviewed revisions, source hashes, direct ports, and DevTools definitions, including the local counterparts of disabled upstream cases. Complete direct suites reuse those definitions rather than maintaining another title list.
- `api-coverage.json` maps public runtime exports to their existing tests. Source and packaged-build checks share the same export reader.
- `scripts/test-inventory.ts` is the shared parser used by inventory tests, source verification, and DevTools synchronization. `tests/upstream-inventory.test.ts` owns port accounting; the fixture no longer has a parallel inventory checker.
- This README owns the audit findings. `NOTICE` contains the React license.

Matching test titles or export names is accounting, not proof of behavioral equivalence. Development and production runs, different renderers, and synthetic versus live fibers are distinct checks, not interchangeable duplicates. The React test-renderer inspection ports run in development; unreachable production snapshots are not retained or counted as production coverage.

## Upstream maintenance

Use a local `facebook/react` checkout at the main revision recorded in `upstream.json`:

```sh
REACT_SOURCE=/path/to/react pnpm --filter conformance check:upstream
```

This verifies source hashes and direct-port titles. Normal tests need no React checkout. The standalone hook-inspection suite ports all upstream development cases, retaining hook values, IDs, editability, nesting, debug information, and function names; only source file/line/column coordinates are normalized.

To synchronize the DevTools inventory and hook-source fixtures:

```sh
pnpm --filter conformance sync:devtools
pnpm --filter conformance sync:devtools --ref <reviewed-git-ref>
```

The default is the already-pinned DevTools revision, not `main`. Synchronization preserves the other inventory sections and recorded local mappings. Review upstream changes and port assertions before changing a pin or expected coverage; do not merely update counts to make checks pass.

## Audit: fixed defects

The source-backed audit reproduced and fixed:

- **`useFiber` capture fragility:** restored early React updates without ref-parity guessing, fixed early CommonJS/ESM interop, rejected unrelated bound objects, and removed the dependency on external-store subscription binds. Development can capture through DevTools with locked `bind`; all tested versions can update after a successful capture without patching `bind`.
- **Production Node crash:** the inherited browser DCE diagnostic scheduled a fatal exception for React's intentionally unbundled Node entrypoints. Node now skips that diagnostic; browser behavior remains tested. Packaged checks do not disable `checkDCE`.
- **Inspection corruption:** hook replay mutated committed compiler-cache slots/indexes, and nested inspection stole outer hook state/logs. Replay now uses copied slots and an independent index, rejects reentrancy, and cleans up dependency-resolution errors.
- **Traversal failures:** `traverseFiber` overflowed on deep/wide trees; cyclic/deep type wrappers also overflowed. Both use iterative traversal, with cycle detection for wrappers. Suspense mount traversal now includes every visible sibling.
- **Incorrect identity checks:** forged/coercible element markers were accepted, and unchanged falsy host props were reported as renders. Element markers now use global symbol identity; prop comparison preserves falsy values.
- **Excessive work:** cached work-tag lookup still walked to the root, current-fiber lookup scanned unrelated subtrees, and invalid host keys polluted the lookup cache. Operation-count regressions cover reductions from 1,001,000 to 2,000 parent reads, 2,000 to zero unrelated child reads, and 500 to zero poisoned-key reads in their respective fixtures.

The audit also replaced the unchecked standalone inspection copy, removed obsolete recursion helpers, aligned the coverage provider with Vitest, and added type/published-entry checks to CI. Public aliases/constants were retained; internal disuse alone does not justify breaking exports.

## Audit: remaining defects and limits

1. **High — listener error isolation.** Commit and injection dispatch stop on the first throwing callback. Existing library tests explicitly expect later listeners not to run. React catches injection failures before retaining its hook reference, so an injection listener can prevent future commit delivery. This needs an explicit error-reporting/isolation contract.
2. **Medium — stale work tags after late renderer association.** Reading a child before associating its root with a React 16 renderer leaves cached FunctionComponent tag `0` on the child while the root reports `1`. The ancestor fast path does not invalidate those caches.
3. **Medium — rendered-phase traversal depth.** `traverseRenderedFibers` still uses recursive mount/update/unmount visitors; a synthetic 20,000-deep tree throws `RangeError`. The stack-safety fix applies to `traverseFiber`, not these visitors.
4. **Medium — inspection is not a sandbox.** Replayed user code can mutate refs, props, or objects inside cached slots. Slot-array copying does not isolate the reachable object graph. `useFiber` may temporarily patch global `Function.prototype.bind` for an initial capture; production mounts with an already-locked intrinsic remain a constraint.
5. **API/version mismatches.** The React peer range begins at 16.0, but hooks require at least 16.8. The `useFiber` version, attack, and fuzz matrices include 16.8.6, 16.12.0, 16.13.0, 16.14, 17, 18, 19, canary, and experimental. This is not exhaustive patch-version coverage. `Fiber` props are typed as objects despite real null/primitive values; generated work-tag numbers are not directly assignable to `Fiber.tag`. The async traversal overload also promises a Promise for a null fiber, although runtime returns null: `await` works, `.then()` does not.
6. **Coverage gaps.** Some older direct ports still disable type checking or hardcode development expectations. Existing React 19 compatibility skips remain visible. Istanbul currently changes standalone inspection stack names (`Component` becomes `renderFunction`), so those exact assertions do not pass under coverage instrumentation. They remain enabled in normal runs. Full reconciler, scheduler, DOM, hydration, streaming SSR, Flight, compiler, native, and feature-gate suites are not ported. Per-renderer/version checks do not establish the same coverage for every API.
7. **Setup gaps.** The combined suite can emit localhost:3000 connection-refused errors while passing and needs a hermetic network audit. Installation still reports Detox/expect and playground Vite/plugin peer mismatches. Broad dependency ranges need review on lockfile refresh. `publint` suggests declaring supported Node versions and reviewing side effects; blindly setting `sideEffects: false` would break hook installation.
8. **Export scope.** The runtime inventory covers `bippy` and `bippy/source`, and packaged checks exercise `bippy/install-hook-only`. Public `./dist/*` patterns expose additional implementation chunks; removing them requires a compatibility decision.

Prioritize listener isolation, cache invalidation, and rendered-phase stack safety, then replace unchecked ports and expand the runtime matrix. The audit was verified locally on Node 24; browser/Detox and CI's Node 22 runtime were not run locally.

## `useFiber` capture contract

Each call writes a unique memo marker and reducer marker. Development capture uses the renderer's `getCurrentFiber` only when that Fiber contains the current memo marker. Otherwise, an initial reducer bind can capture the Fiber, but only alongside the queue carrying this call's reducer marker. Bound argument positions are not hardcoded. Updates select the alternate containing the memo marker without patching `bind` or scheduling passive effects.

React [16.8.6](https://github.com/facebook/react/blob/v16.8.6/packages/react-reconciler/src/ReactFiberHooks.js#L410-L415) through [16.12.0](https://github.com/facebook/react/blob/v16.12.0/packages/react-reconciler/src/ReactFiberHooks.js#L477-L482) attach hook state after the component returns. For these versions, the retained reducer queue proves the hook ran, and an iterative walk of the work-in-progress root locates the rendering alternate. This is not ref-parity guessing. The marker regression introduced in `e2b879b` is covered by mount, update, Strict Mode, hydration, bailout, suspension, render-phase retry, and fuzz cases on early React. Default React imports also fix the old CommonJS namespace interop failure; focused tests exercise both import and require paths through `tsx`.

`use-fiber-capture-contract.test.ts` makes `useSyncExternalStore` throw if called, injects a decoy Fiber and an opaque bound argument through a dispatcher wrapper, and checks exact Fiber identity across development, production, and profiling builds. It also checks zero bind assignments on updates. The Native static suite checks reducer binding in the six shipped renderer bundles; it is not a Native runtime test.

`use-fiber-bind-attacks.test.tsx` tests frozen intrinsics and throwing bind setters before and after mount across React 16.14, 17, 18, 19, canary, and experimental in development, production, and profiling:

| Lock timing              | Development with matching DevTools Fiber     | Production/profiling                         |
| ------------------------ | -------------------------------------------- | -------------------------------------------- |
| Before first capture     | Captures without assigning `bind`            | Returns `undefined`; rendering continues     |
| After successful capture | Captures on updates without assigning `bind` | Captures on updates without assigning `bind` |

**Remaining boundaries:** React's [DevTools injection](https://github.com/facebook/react/blob/f1f7ed2ac267a21dd2e3e67c4a606b9cf56e360b/packages/react-reconciler/src/ReactFiberReconciler.js#L899-L904) exposes `getCurrentFiber` only in development. There is no guaranteed equivalent production hook in the reviewed renderer, so a first production capture with an already-locked `bind` remains unsupported. Throwing setters no longer interrupt hook order. Full SES lockdown was not tested. Future changes to reducer binding, memo storage, or Fiber topology still require compatibility testing; removing the external-store dependency does not make React internals a stable API. Queue correlation rejects unrelated bindings, but is not a security boundary against code that deliberately forges React's private objects.
