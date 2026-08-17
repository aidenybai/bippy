# Conditional hooks

This example makes ordinary React client hooks independent of call order without changing Bippy's package code. A small Vite transform inserts `useConditionalHooks()` at the start of each function component. That bootstrap uses Bippy's exported `useFiber()` API and one stable React reducer before the example virtualizes later hook calls by Fiber and callsite.

```bash
pnpm --filter @bippy/example-conditional-hooks dev
pnpm --filter @bippy/example-conditional-hooks build
pnpm --filter @bippy/example-conditional-hooks preview
```

The dev server exercises React's development build. The build and preview commands exercise its production build.

This is an experimental client-only example. It emulates hook state and effect lifecycles outside React's native positional hook list and is not intended for server rendering.
