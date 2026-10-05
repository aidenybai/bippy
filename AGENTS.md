Bippy hacks into React internals. `packages/bippy` is the library. `packages/conformance` holds unit and React conformance tests. `packages/e2e` runs Playwright tests against framework fixtures. `packages/website` and the playgrounds are demos.

When implementing anything in this project, clone `facebook/react` locally and search its source to understand the relevant React internals. Do not rely on memory or assumptions.

## Bippy rules

- Make every change work in production builds and across all supported React versions. Never bundle React.
- Keep the public API small. Justify every new export.
- Build demos and integrations on bippy's public API. Keep logic that isn't core out of `packages/bippy`.
- Derive React types and constants from `react-reconciler` or `src/react-internals`. Keep version-specific values there.
- Throw named errors from `src/errors.ts` and let them propagate. Do not wrap them in helpers such as `fail()`.
- Make source resolution work across all bundlers without configuration or plugins.
- Do not add timeouts unless asked.

## Verifying changes

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before you finish. Run `pnpm test:e2e` when a change affects framework integration.

## Branch names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `fiber-rewrite`, `fix-instrumentation-state`, `cleanup-tests`.

## Commits and PR titles

Use conventional commit messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional. Use the affected package when helpful, such as `core`, `conformance`, `e2e`, or `website`.

Examples: `fix(core): harden useFiber capture across React versions`, `feat(website): serve cached npm badges`, `test: preserve useFiber compiler opt-out`.

Keep each commit and PR to one concern. Never merge with failing CI, and merge only when asked.

Use the `/writing-guidelines` skill for PR descriptions.

## Style guide

- Keep code clean, elegant, and simple. YAGNI.
- Remove unused code. Don't repeat yourself.
- Use TypeScript for all project-authored code.
- Prefer `const`. Use ternaries or early returns instead of reassignment and `else`.
- Use arrow functions and kebab-case file names.
- Avoid `any`. Avoid `as` unless necessary.
- Never use star imports or alias imports, such as `import { resolve as pathResolve }`.
- Use pnpm for project scripts, which run with `tsx`. Use Bun only for one-off scripts.
- Use TypeScript interfaces over types. Keep them at module scope.
- Rely on type inference. Add annotations only for exports.
- Do not extract single-use helpers or variables. Inline them at the call site unless the helper is reused, hides a complex boundary, or has a name that clarifies the caller.
- Do not comment unless necessary. Prefix hacks, such as a `setTimeout`, with `// HACK: reason`.
- Avoid `try`/`catch` where possible.
- Use descriptive names. Avoid one or two character names.
  - In `.map()`, use `innerX` instead of `x`.
  - Use `isMoved` instead of `moved`.
  - Use `get`, `set`, and `use` prefixes.
- Use dot notation instead of destructuring, so `obj.a` keeps its context.

## Testing

- Avoid mocks. Use `globalThis` only when nothing else works.
- Test behavior, not implementation. Do not copy logic into tests.
- Make tests deterministic.
- Prefer cases ported from `facebook/react` and real apps over synthetic fixtures.
- Never weaken a test to make it pass. Fix the cause.
