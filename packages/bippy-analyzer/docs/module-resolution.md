# Resolve the program the toolchain actually loads

These two projects can legitimately resolve the same request differently:

```text
import './schema'

schema.json
schema/index.ts
```

With `extensions: ['.js', '.json']`, the configured resolver selects `schema.json`. With PostHog's researched extension list (`.ts`, `.tsx`, `.js`, `.jsx`, `.scss`, `.css`, `.less`), it selects `schema/index.ts`. Neither list is a universal JavaScript default.

## Choose a resolver explicitly

```ts
import { createModuleResolver } from "./src/module-resolver.js";

const resolver = createModuleResolver({
  conditionNames: ["browser", "import", "development"],
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  mainFields: ["browser", "module", "main"],
  aliasFields: ["browser"],
  tsconfig: { configFile: "/project/tsconfig.json" },
});

resolver.resolve("./schema", "/project/src/app.tsx");
```

This is an explicitly configured Oxc resolver, **not a Node, Vite, or Next emulator**. Options include extension substitution, aliases, package conditions, main fields, tsconfig references, symlinks, module directories, and fully specified requests. Conditions, extensions, and main fields are required. TypeScript paths and browser mappings are not enabled implicitly. Use absolute configuration paths.

The default mapping precedence is Oxc's tsconfig-before-alias behavior. `aliasPrecedence: 'alias'` selects explicit aliases first. Configuration errors remain errors; an explicitly missing tsconfig does not silently select jsconfig. `NODE_PATH` is disabled unless requested. Options are copied, including nested arrays.

Use separate resolver instances for different policies or layers. `clearCache()` clears this resolver's Oxc caches, including misses. It does not refresh a module graph, transforms, or framework caches.

### Node

```ts
import { createNodeModuleResolver } from "./src/node-module-resolver.js";

const imports = createNodeModuleResolver({ kind: "esm" });
const requires = createNodeModuleResolver({ kind: "commonjs" });
```

CommonJS delegates to the running Node's `createRequire().resolve()`. ESM uses pinned `import-meta-resolve` with Node 26's ordinary conditions, optional additional conditions, and explicit symlink preservation. It is a separate implementation checked against Node, not Node's internal resolver API.

ESM rejects missing files and directory imports; `import.meta.resolve()` alone can return their URLs without checking existence. Tests compare existing-file results and independently check native import rejection for missing files and directories. No TS paths, `.js`→`.ts` substitution, browser fields, or `module` condition is injected.

Node file identities are URLs, retaining escaped filenames, queries, and fragments. Resolution does not establish that Node or engine262 can load the file's format. Custom Node hooks, data/network loaders, and alternate default conditions from runtime flags are not implemented by the ESM resolver. CommonJS follows the running process's resolution settings.

Node and `import-meta-resolve` retain process-level caches. Keep project inputs fixed; recreating this wrapper is not a reload guarantee. Use a fresh process after changing package metadata.

### Vite and webpack

```ts
const viteResolver = createViteModuleResolver(server.environments.client);
const webpackResolver = createWebpackModuleResolver(configuredWebpackResolver);
```

The Vite adapter calls the supplied environment's plugin container. The webpack adapter calls the supplied configured resolver, including its plugins. Neither adapter discovers or executes project configuration, invents a fallback resolver, nor loads application bodies. Creating toolchains and running their plugins is trusted host work, not a sandbox.

Select the correct Vite environment or webpack dependency/layer resolver before calling the adapter. There is no automatic framework detection. The webpack adapter is not a webpack compilation: module rules, loaders, externals, and module factories can still change what is loaded.

Results retain file, builtin, virtual, external, ignored, and unresolved outcomes. A Vite browser-external marker is ignored, not a fabricated empty module. Plugin errors retain their messages. External results do **not** authorize native application execution. Virtual modules still need their owning loader.

IDs belong to their resolver/toolchain context. Do not globally merge equal IDs from client, server, RSC, different plugin environments, or different transformations. Oxc and webpack retain path/query IDs; Vite retains plugin IDs; Node retains file URLs. This layer does not define the future module graph's complete identity.

## Evidence and remaining framework work

On Node 26.4.0, the package has 126 passing Vitest tests across seven files, including its engine smoke test. Resolution checks include:

- Vite+ 0.3.1's Vite 8.2.2: entry selection, aliases, paths, browser maps, real plugins, virtual/external IDs, client/SSR builtins, and plugin failures.
- Node ESM and CommonJS: conditional exports, private imports, package self-reference, strict ESM paths, URL identity, blocked subpaths, and missing targets. Native subprocesses are independent references.
- Next 15.5.18: installed client/Pages/server-ESM main-field selection and its real `JsConfigPathsPlugin`, exercised through enhanced-resolve 5.24.5.
- Explicit expected targets for extension collisions, condition-order permutations, nested packages, symlinks, malformed configuration, and cache invalidation. TypeScript is an oracle for selected path mappings, not for runtime package implementations.

The legacy-style bundler policy in `tests/helpers/bundler-resolver.ts` is only a fixture policy. Its client/server labels and convenience jsconfig selection are not the production API or a universal framework preset. Tests retain known Node/bundler disagreements rather than demanding false parity: `#builtin → node:fs` and even `#builtin → fs` differ across the tested environments.

**This is not complete Next integration.** No Next application build or Turbopack differential run has been performed. RSC/client transitions, Next's React aliases, edge runtime, externalization, fonts/images, generated modules, import attributes, and framework loaders still need their owning build pipeline. Other frameworks with custom plugins likewise need an integration, not guessed paths. Resolution has not yet been connected to engine262 loading, linking, or execution.

## Findings carried forward

Reviewed PRs [#115](https://github.com/aidenybai/bippy/pull/115) and [#144](https://github.com/aidenybai/bippy/pull/144), the prior branch's `module-graph-research.md`, `tsc-graph-investigation.md`, resolver/tests, and relevant local Bippy session excerpts. These are research inputs, not current validation receipts.

- The TypeScript investigation exposed the PostHog JSON collision. It also found that declaration-file resolution is not executable-source resolution; do not replace runtime resolution with a type checker.
- The graph research and prior sessions preserved reference-tool disagreements, unavailable-module uncertainty, and stale-cache examples. A missing module is not an empty module; one cache clear is not whole-program invalidation.
- PR #144's browser/server changes supplied useful regressions, but its condition lists cannot define Node or every Next layer. The old browser-entry source-syntax heuristic also disagreed with the installed Vite 8 implementation and was not retained.
- React's local Flight Node loader delegates resolution while adding `react-server`; it does not implement a universal filesystem resolver ([source](https://github.com/facebook/react/blob/90ab3f89f4824ac763b6f877c6f711200d1338d2/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js)).
- Next source was cloned at `9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec` (`v15.5.18`). Its Turbopack [server context](https://github.com/vercel/next.js/blob/9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec/crates/next-core/src/next_server/context.rs) and [client context](https://github.com/vercel/next.js/blob/9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec/crates/next-core/src/next_client/context.rs) install context-specific import maps, externalization, validation, and font plugins. Copying only their conditions would miss those decisions.
