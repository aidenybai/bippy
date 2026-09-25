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
  builtinModules: false,
  tsconfig: { configFile: "/project/tsconfig.json" },
});

resolver.resolve("./schema", "/project/src/app.tsx");
```

This is an explicitly configured Oxc resolver, **not a Node, Vite, or Next emulator**. Options include extension substitution, aliases, package conditions, main fields, tsconfig references, symlinks, module directories, and fully specified requests. Conditions, extensions, and main fields are required. TypeScript paths and browser mappings are not enabled implicitly. Use absolute configuration paths.

The default mapping precedence is Oxc's tsconfig-before-alias behavior. `aliasPrecedence: 'alias'` selects explicit aliases first. Configuration errors remain errors; an explicitly missing tsconfig does not silently select jsconfig. `NODE_PATH` is disabled unless requested. Options are copied, including nested arrays. Set `builtinModules: false` when the host must not recognize Node builtins. This also disables fallback builtin classification after a failed filesystem lookup.

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

### Vite, webpack, Rollup and Rolldown

```ts
const viteResolver = createViteModuleResolver(server.environments.client);
const webpackResolver = createWebpackModuleResolver(configuredWebpackResolver);
const rollupResolver = createRollupModuleResolver(rollupPluginContext);
const rolldownResolver = createRolldownModuleResolver(rolldownPluginContext);
```

The Vite adapter calls the supplied environment’s plugin container and forwards native request options. The webpack adapter calls the supplied configured resolver, including its plugins. Its optional third argument supplies `context` and `resolveContext` for issuer-sensitive plugins and dependency tracking.

Rollup and Rolldown have separate plugin-context adapters. They forward their native request options rather than translating one toolchain’s defaults into another’s. Rolldown preserves dependency kind; Rollup preserves import attributes. Both preserve custom options, entry status, `skipSelf` and external decisions.

These adapters do not discover configuration, invent fallback resolvers or load application bodies themselves. Creating toolchains and running their plugins executes host code. Use isolation for downloaded project configuration.

Select the correct Vite environment or webpack dependency/layer resolver before calling the adapter. There is no automatic framework detection. The webpack adapter is not a webpack compilation: module rules, loaders, externals, and module factories can still change what is loaded.

Results retain file, builtin, virtual, external, ignored, and unresolved outcomes. Vite browser-external markers and Rolldown’s version-specific empty-module marker are ignored, not fabricated executable modules. An external result retains explicit absolute/relative mode. A plugin-owned builtin-shaped ID remains virtual unless the toolchain externalizes it. Plugin errors retain their messages and nested causes, including Rolldown’s wrapped plugin errors. External results do **not** authorize native application execution. Virtual modules still need their owning loader. Plugin adapters classify absolute IDs as `file`; that does not prove a physical file exists or that reading it reproduces the plugin’s output. Use the owning toolchain’s loader for those IDs too.

IDs belong to their resolver/toolchain context. Do not globally merge equal IDs from client, server, RSC, different plugin environments, or different transformations. Oxc and webpack retain path/query IDs; Vite, Rollup and Rolldown retain plugin IDs; Node retains file URLs. This layer does not define the future module graph's complete identity.

## Evidence and remaining framework work

On Node 26.4.0, the package has 150 passing Vitest tests across twelve files, including its engine smoke test. Resolution checks include:

- Vite+ 0.3.1's Vite 8.2.2: entry selection, aliases, paths, browser maps, real plugins, virtual/external IDs, client/SSR builtins, and plugin failures.
- Node ESM and CommonJS: conditional exports, private imports, package self-reference, strict ESM paths, URL identity, blocked subpaths, and missing targets. Native subprocesses are independent references.
- Next 15.5.18: installed client/Pages/server-ESM main-field selection, its real `JsConfigPathsPlugin`, and a native Turbopack fixture selecting distinct RSC, browser and client-SSR export branches.
- Rollup 4.62.4 and Rolldown 1.2.4: actual plugin contexts, request options, external decisions and bundle/module evidence. Vanilla Rollup does not resolve bare npm packages without a plugin.
- esbuild 0.28.2: native bundles proving alias lookup scope and the difference between omitted and explicitly empty conditions. There is no esbuild adapter.
- Explicit expected targets for extension collisions, condition-order permutations, nested packages, symlinks, malformed configuration, and cache invalidation. TypeScript is an oracle for selected path mappings, not for runtime package implementations.

The legacy-style bundler policy in `tests/helpers/bundler-resolver.ts` is only a fixture policy. Its client/server labels and convenience jsconfig selection are not the production API or a universal framework preset. Tests retain known Node/bundler disagreements rather than demanding false parity: `#builtin → node:fs` and even `#builtin → fs` differ across the tested environments.

The [ten-repository audit](../corpus/module-resolution/README.md) records 2,299 request occurrences. It retains nine unresolved requests from applying a Next client resolver to server/Node source and twelve differences from Zustand’s Rollup external policy. Four Vite bundles and Zustand’s base ESM bundle compiled. Native Turbopack compile mode passed for Commerce, failed on an offline font request for the SaaS starter, and exposed a native panic in Invoify’s Next 15.3.8.

**This is not complete Next integration.** The native fixture and builds do not establish per-edge resolver parity or application execution. Layer assignment, edge runtime, generated modules and framework loaders still need their owning pipeline. Resolution has not been connected to engine262 loading, linking or execution.

[Toolchain research](toolchain-resolution-research.md) covers Parcel, esbuild, Rspack, PnP, Metro, Bun, Deno, import maps and Knip’s configuration discovery. It separates source-backed findings from runtime evidence. No Knip implementation or universal configuration-discovery layer is imported.

## Findings carried forward

Reviewed PRs [#115](https://github.com/aidenybai/bippy/pull/115) and [#144](https://github.com/aidenybai/bippy/pull/144), the prior branch's `module-graph-research.md`, `tsc-graph-investigation.md`, resolver/tests, and relevant local Bippy session excerpts. These are research inputs, not current validation receipts.

- The TypeScript investigation exposed the PostHog JSON collision. It also found that declaration-file resolution is not executable-source resolution; do not replace runtime resolution with a type checker.
- The graph research and prior sessions preserved reference-tool disagreements, unavailable-module uncertainty, and stale-cache examples. A missing module is not an empty module; one cache clear is not whole-program invalidation.
- PR #144's browser/server changes supplied useful regressions, but its condition lists cannot define Node or every Next layer. The old browser-entry source-syntax heuristic also disagreed with the installed Vite 8 implementation and was not retained.
- React's local Flight Node loader delegates resolution while adding `react-server`; it does not implement a universal filesystem resolver ([source](https://github.com/facebook/react/blob/90ab3f89f4824ac763b6f877c6f711200d1338d2/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js)).
- Next source was cloned at `9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec` (`v15.5.18`). Its Turbopack [server context](https://github.com/vercel/next.js/blob/9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec/crates/next-core/src/next_server/context.rs) and [client context](https://github.com/vercel/next.js/blob/9ff92cebcaa6ba4e7463b6fd037a8510ba9b81ec/crates/next-core/src/next_client/context.rs) install context-specific import maps, externalization, validation, and font plugins. Copying only their conditions would miss those decisions.
