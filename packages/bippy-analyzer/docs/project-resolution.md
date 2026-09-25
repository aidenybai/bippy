# Project-aware resolution

A project imports `@/components/button.js`, while its source lives at `src/components/button.tsx`. Callers should not need to assemble an Oxc policy or install a Bippy plugin to find it.

```ts
import { createResolver } from "../src/index.js";

const resolver = createResolver({
  rootDirectory: "/workspace/app",
  platform: "browser",
  mode: "production",
});

resolver.resolve("@/components/button.js", "/workspace/app/src/page.tsx");
resolver.resolve("conditional-package", "/workspace/app/src/page.tsx", {
  kind: "require",
});
```

`createResolver` is the project-facing API. It collects configuration and delegates filesystem/package resolution to the existing Oxc implementation. There is no second bundler resolution pass, browser extension, or Bippy bundler plugin.

## Discovery

The resolver searches from the importing file toward the workspace root:

- The nearest `tsconfig.json` or `jsconfig.json` supplies paths, base URL, inheritance, references and root directories through Oxc. TypeScript wins when both filenames exist in one directory. Nested workspaces do not inherit an unrelated sibling’s aliases.
- Conventional Vite, Rolldown, webpack, Rspack, Next and esbuild configuration filenames are recognized. Multiple configurations require an explicit `configFile`; unrelated build targets are not merged.
- Static `resolve.alias`, extensions, main fields and conditions are collected. Supported alias forms include objects, string-based arrays, webpack exact matches, fallback targets and `false`. Static Next `turbopack.resolveAlias` and `experimental.turbo.resolveAlias` are also read; this is not a Next framework implementation.
- Common constants, object spreads, `defineConfig({...})`, CommonJS exports, `path.resolve(__dirname, ...)`, and `fileURLToPath(new URL(..., import.meta.url))` are read without executing configuration code. esbuild aliases use the configured working directory and longest matching prefix. Vite string aliases retain literal-prefix, first-match behavior rather than being converted into wildcard mappings.

Ordered alias rewriting lives in the project layer because Oxc’s N-API alias map does not preserve configuration order. Targets still go through Oxc; this does not add a second filesystem resolver.

`getConfiguration(importer, request)` exposes the selected files, policy and diagnostics. Returned metadata is copied. `clearCache()` invalidates configuration discovery as well as filesystem lookup.

Explicit resolver options override collected values. For a dynamic configuration whose selected policy is already known, pass `configFile: false` and its aliases/options directly. This disables toolchain-config discovery, not TypeScript-config discovery.

## Executing Next webpack configuration

Next wrappers and `webpack` callbacks cannot be recovered from an object-literal reader. Opt in to running the project's installed Next configuration loader:

```ts
const resolver = createResolver({
  rootDirectory: "/workspace/app",
  platform: "browser",
  mode: "development",
  allowConfigExecution: true,
  configTimeoutMs: 10_000,
});

resolver.resolve("next-intl/config", "/workspace/app/app/page.tsx");
```

A child process loads Next, materializes the selected client or Node-server webpack configuration, and returns its filesystem settings. Wrappers and callbacks execute; application entry modules are not compiled or evaluated. Oxc remains the lookup engine. This is not a native webpack resolution retry or a Bippy plugin installed in the application.

Execution is disabled by default and currently applies only to discovered Next configurations. Opting in selects Next's webpack filesystem policy, not Turbopack; it does not infer the bundler from package scripts. Each configuration/platform/mode is loaded once, including both import and require policies. Failures are cached too; `clearCache()` starts fresh processes on subsequent requests. `getConfiguration()` exposes `nextVersion`, captured `configurationOutput`, and limitations in `diagnostics`.

The worker has a ten-second default deadline, a 512 MiB JavaScript heap limit, bounded output, and a fresh environment containing the selected `NODE_ENV`, temporary `HOME`, and tooling limits. It does not inherit host credentials or `NODE_OPTIONS`. Next can still read the project's `.env` files. **A child process is not a security sandbox:** untrusted configuration must run inside an outer filesystem/network/resource sandbox. The corpus uses its existing isolated, network-disabled containers.

This extracts filesystem policy, not a whole Next build. Compiler hooks, loaders, externalization, RSC and edge layers are not represented. Callbacks receive synthetic build/preview metadata, so build-identity-dependent behavior is not validated. Unsupported `resolve.plugins` entries and modified standard path-plugin settings fail instead of being discarded. Missing optional peers stay unresolved even where Next would ignore them. No application execution falls back to Node.

## Runtime context

Browser requests no longer classify Node builtins as available. An explicitly configured polyfill can still resolve to a file. Use an explicit Node context for a Node request:

```ts
resolver.resolve("node:fs", "/workspace/app/lib/read-file.ts");
resolver.resolve("node:fs", "/workspace/app/lib/read-file.ts", { platform: "node" });
```

The first request is unresolved under the default browser policy; the second identifies `node:fs` as a builtin. This does not infer a file's Next layer from its imports. Automatic graph/layer assignment remains separate, and engine262 still needs an explicit host implementation to use a builtin.

## Library source versus distribution builds

Resolving Zustand's source import `./vanilla.ts` means locating `src/vanilla.ts`. Its Rollup publishing build rewrites that import to the external package identity `zustand/vanilla`. Those are different contracts, not two candidate answers to the same source lookup.

For source analysis, follow the original import without reading Rollup's packaging recipe. For an installed dependency, follow its shipped package exports and imports. Reproducing a library's distribution build would instead require its build configuration and externalization rules; it is not claimed by this API.

## Scope

This is source-file discovery, not exact Node ESM loading or complete framework execution. Default extension search includes JavaScript and TypeScript, and explicit JavaScript extensions can select TypeScript source. Declarations are rejected as executable inputs. Builtins, ignored paths and unresolved requests remain distinct outcomes.

Conditions stay separated by browser/Node, development/production and import/require. A failed Node lookup is not retried using browser conditions. Package exports, imports and browser maps are handled by Oxc under that selected policy.

In the default static mode, configuration functions, mutations, regex aliases, custom alias resolvers and unsupported resolve options report configuration errors rather than executing code or dropping the option. Static discovery does not execute plugins: when a config declares plugins, `getConfiguration` reports that their hooks are not represented. Static file matches alone do not prove equivalence to those hooks. Virtual modules, framework-generated aliases, transforms, native addons, custom loaders, Yarn PnP and complete Next layers are not established by this implementation.

The existing native adapters remain differential-test tools and lower-level integrations, not alternative APIs an application must install. The [configuration-execution audit](../corpus/module-resolution/project-execution-audit.md) matches 2,278/2,299 requests across ten pinned repositories. Invoify now matches 584/584. Nine browser-context failures and twelve Rollup externalization differences remain nonpasses; separate explicit Node/source checks match all 21 targets. This is not automatic layer assignment or whole-application acceptance. The [static-only baseline](../corpus/module-resolution/project-audit.md), including its 584 blocked Invoify requests, remains preserved.

## Knip reference

The design follows Knip’s separation of configuration discovery, workspace-scoped aliases and an Oxc-backed resolver. The inspected source is pinned at [`c0e42f83bda7664065465f2f3faca7af97c988ac`](https://github.com/webpro-nl/knip/tree/c0e42f83bda7664065465f2f3faca7af97c988ac):

- [`ProjectPrincipal.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/ProjectPrincipal.ts): scoped paths and root directories.
- [`resolve-module-names.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/typescript/resolve-module-names.ts): lookup, alias candidates and source remapping.
- [`util/resolve.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/util/resolve.ts): Oxc options and fallback policies.
- [`plugins/webpack/index.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/plugins/webpack/index.ts): configuration and alias collection.

Knip is ISC-licensed. No implementation was copied. Its combined import/require conditions, alternate-platform fallback, declaration lookup and build-mode merging serve dependency analysis; they are not adopted as execution semantics here.
