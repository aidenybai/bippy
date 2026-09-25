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

## Scope

This is source-file discovery, not exact Node ESM loading or complete framework execution. Default extension search includes JavaScript and TypeScript, and explicit JavaScript extensions can select TypeScript source. Declarations are rejected as executable inputs. Builtins, ignored paths and unresolved requests remain distinct outcomes.

Conditions stay separated by browser/Node, development/production and import/require. A failed Node lookup is not retried using browser conditions. Package exports, imports and browser maps are handled by Oxc under that selected policy.

Configuration functions, mutations, regex aliases, custom alias resolvers and unsupported resolve options report configuration errors rather than executing code or dropping the option. Plugins are not executed: when a config declares plugins, `getConfiguration` reports that their hooks are not represented. Static file matches alone do not prove equivalence to those hooks. Virtual modules, framework-generated aliases, transforms, native addons, custom loaders, Yarn PnP and complete Next layers are not established by this implementation.

The existing native adapters remain differential-test tools and lower-level integrations, not alternative APIs an application must install. A [separate ten-repository audit of this facade](../corpus/module-resolution/project-audit.md) matched 1,694 of 2,299 requests. Six contexts matched completely. Invoify’s dynamic configuration blocked 584 requests; nine Next client/builtin cases and twelve Zustand externalization cases also differed. These failures remain recorded separately from the earlier lower-level audit.

## Knip reference

The design follows Knip’s separation of configuration discovery, workspace-scoped aliases and an Oxc-backed resolver. The inspected source is pinned at [`c0e42f83bda7664065465f2f3faca7af97c988ac`](https://github.com/webpro-nl/knip/tree/c0e42f83bda7664065465f2f3faca7af97c988ac):

- [`ProjectPrincipal.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/ProjectPrincipal.ts): scoped paths and root directories.
- [`resolve-module-names.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/typescript/resolve-module-names.ts): lookup, alias candidates and source remapping.
- [`util/resolve.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/util/resolve.ts): Oxc options and fallback policies.
- [`plugins/webpack/index.ts`](https://github.com/webpro-nl/knip/blob/c0e42f83bda7664065465f2f3faca7af97c988ac/packages/knip/src/plugins/webpack/index.ts): configuration and alias collection.

Knip is ISC-licensed. No implementation was copied. Its combined import/require conditions, alternate-platform fallback, declaration lookup and build-mode merging serve dependency analysis; they are not adopted as execution semantics here.
