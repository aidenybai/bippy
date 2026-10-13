# Tests

The canonical home for Bippy's unit tests (`unit/`), React conformance tests (`conformance/`), browser and native E2E tests (`e2e/`), the DevTools fixture, framework fixtures and playgrounds (`fixtures/`), and audit findings. None of it is published; it is not a React implementation or a guarantee of universal compatibility.

## Run

```sh
pnpm test:all
```

Runs library tests, DevTools fixture tests, conformance tests, TypeScript checks, a production Bippy build, and fresh-process ESM/CJS checks against development/production React. CI uses the same checks. Browser and Detox E2E remain separate.

Focused commands:

```sh
pnpm --filter bippy test --project unit
pnpm --filter bippy test --project conformance
pnpm --filter bippy typecheck
pnpm --filter bippy coverage
pnpm --filter bippy test:built
pnpm --filter bippy bench:use-fiber
pnpm --filter bippy bench
pnpm --filter bippy bench:smoke
```

Library coverage retains its original unit-test scope and writes reports to `packages/bippy/coverage/`. The normal test command runs all projects, including exact upstream stack assertions, without coverage instrumentation.

## Keep each contract in one place

- Add Bippy conformance and adversarial regression tests in `conformance/`. Keep a replay when it reproduces a Bippy defect or covers a distinct API boundary; do not duplicate React's callback queues, effect publication or scheduling tests. Extend an existing case rather than copying it into another suite.
- Keep implementation unit tests and their runtime helpers in `unit/`, and DevTools facade tests in `fixtures/react-devtools-headless/`. `packages/bippy/src` contains library code only.
- `packages/bippy/vite.config.ts` owns the project list used by both workspace and package test commands. Each project runs once. Unit tests have no shared setup hook so pre-installation, late-load, and frozen-hook cases keep their original load order.
- Unit and conformance test dependencies are `bippy` devDependencies; the DevTools fixture, the E2E runner in `e2e/`, and each framework fixture keep their own.
- `conformance/upstream.json` is the sole upstream inventory. It records reviewed revisions, source hashes, direct ports, and DevTools definitions, including the local counterparts of disabled upstream cases. Complete direct suites reuse those definitions rather than maintaining another title list.
- `conformance/api-coverage.json` maps public runtime exports to their existing tests. Source and packaged-build checks share the same export reader.
- `packages/bippy/scripts/test-inventory.ts` is the shared parser used by inventory tests, source verification, and DevTools synchronization. `conformance/upstream-inventory.test.ts` owns port accounting; the fixture no longer has a parallel inventory checker.
- `AUDIT.md` owns the audit findings, `conformance/README.md` describes the deterministic replay corpus, and `../benchmarks/README.md` covers the performance checks. `conformance/NOTICE` contains the React license.

Matching test titles or export names is accounting, not proof of behavioral equivalence. Development and production runs, different renderers, and synthetic versus live fibers are distinct checks, not interchangeable duplicates. The React test-renderer inspection ports run in development; unreachable production snapshots are not retained or counted as production coverage.

## Upstream maintenance

Use a local `facebook/react` checkout at the main revision recorded in `upstream.json`:

```sh
REACT_SOURCE=/path/to/react pnpm --filter bippy check:upstream
```

This verifies source hashes and direct-port titles. Normal tests need no React checkout. The standalone hook-inspection suite ports all upstream development cases, retaining hook values, IDs, editability, nesting, debug information, and function names; only source file/line/column coordinates are normalized.

To synchronize the DevTools inventory and hook-source fixtures:

```sh
pnpm --filter bippy sync:devtools
pnpm --filter bippy sync:devtools --ref <reviewed-git-ref>
```

The default is the already-pinned DevTools revision, not `main`. Synchronization preserves the other inventory sections and recorded local mappings. Review upstream changes and port assertions before changing a pin or expected coverage; do not merely update counts to make checks pass.
