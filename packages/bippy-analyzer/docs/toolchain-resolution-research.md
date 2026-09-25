# Module resolution across toolchains

Zustand’s Rollup configuration rewrites `./vanilla.ts` to the external package name `zustand/vanilla`. A filesystem resolver instead finds `src/vanilla.ts`. Both results identify something that exists, but only the first matches this build’s output.

The [repository audit](../corpus/module-resolution/README.md) records this difference. The Rollup adapter preserves the external result. Its regression test also checks the import in the generated bundle. Copying extensions and package conditions into Oxc cannot reproduce a plugin that changes the module’s identity and external status.

## What was inspected and tested

[Source references](../corpus/module-resolution/source-references.json) record 20 locally cloned upstream snapshots, their revisions, and inspected paths. The TypeScript snapshot is 5.9.3. Next is 15.5.18, Rolldown is 1.2.4, and Node is 26.4.0. Other source snapshots are recorded commits, not promises about every release. Repository tests use each project’s installed versions.

| Toolchain or host   | Decisions that affect the result                                                                              | Evidence in this change                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node                | ESM versus CommonJS, exports/imports, package scope, conditions, symlinks, process hooks and flags            | Separate adapters, native subprocess comparisons, p-limit and execa                            |
| Oxc                 | Explicit extensions, main fields, conditions, aliases, tsconfig, filesystem policy                            | Core resolver and adversarial fixtures; not a framework emulator                               |
| Vite                | Environment, plugin order, aliases, custom resolver options, browser exclusions, SSR externalization, dedupe  | Environment adapter; Vite 8 fixtures and four projects using Vite 3, 4, 5, and 6               |
| Rollup              | Plugin resolution, external predicates, attributes, `custom`, `skipSelf`, entry status                        | Plugin-context adapter, actual bundles, Zustand’s base ESM configuration                       |
| Rolldown            | Platform, import/require/URL/CSS dependency kind, plugin context, external checks before and after resolution | Separate adapter and native fixtures; not treated as Rollup or Vite defaults                   |
| webpack             | `byDependency`, aliases/fallbacks, resolver plugins, issuer context, module rules, loaders, externals         | Configured resolver adapter; issuer/dependency tracking tests; Next-generated client resolvers |
| Next with webpack   | Client, Pages, server ESM, React Server Components, edge contexts, framework aliases and plugins              | Installed main-field/path-plugin fixtures and three projects’ client resolver configurations   |
| Next with Turbopack | Layered identities, import maps, externalization and validation plugins, generated assets and loaders         | Native three-context fixture and three real compile-mode builds; no general resolver adapter   |
| esbuild             | Alias resolution directory, platform, import kind, default conditions, namespace, suffix and plugin data      | Native build fixtures for alias scope and omitted versus empty conditions; no adapter          |
| Parcel              | Environment, specifier type, named pipelines, package aliases, source entries, exports opt-in                 | Source and documentation review only                                                           |
| Rspack              | Dependency-specific conditions, its resolver configuration and module factory                                 | Source review only; webpack compatibility is not a validation receipt                          |
| TypeScript          | Resolution mode, extension substitution, declarations, `paths`, `baseUrl`, `rootDirs`, references             | Selected path-map oracle tests and source review; not an executable-source resolver            |
| Yarn Plug’n’Play    | Issuer’s dependency map, virtual peer contexts, zip-backed files, builtin handling                            | Source review only; no PnP acceptance claim                                                    |
| Metro               | Platform extensions, `.native`, Haste, assets, package fields, custom resolver, hierarchical lookup           | Source review only                                                                             |
| Bun                 | Runtime/bundler policy, tsconfig inheritance, package resolution and plugins                                  | Source review only; Node parity is not assumed                                                 |
| Deno                | Workspace/import-map resolution, URL identities, npm package context and managed dependencies                 | Source review only                                                                             |
| Browser import maps | Referrer scopes, URL normalization, prefix rules, blocked mappings and map updates                            | HTML specification review only; no browser loader                                              |
| Knip                | Tool detection, config patterns, entries, dependencies and analysis aliases                                   | Discovery and resolver source review; no imported Knip implementation                          |

## The differences that prevent a universal alias map

### An alias has an owner and an order

Rollup’s alias plugin takes the first matching entry. Entries can use regular expressions or custom resolvers. It then calls the plugin pipeline again. The native Rollup adapter therefore forwards `attributes`, `importerAttributes`, `custom`, `isEntry`, and `skipSelf`. Calling from a plugin with `skipSelf: true` excludes that plugin’s own resolver.

Rolldown builds are lazy. Creating and closing a build did not run eight initial test callbacks. The corrected helper generates a bundle and asserts that its checks completed. Executing those checks exposed Rolldown’s wrapped plugin errors. The adapters now preserve the outer diagnostic and nested `cause` messages, with a cycle guard.

esbuild changes the lookup directory after a package alias matches. In the native fixture, `original` maps to `replacement`. The importer has its own nested `replacement` package. esbuild selects the project-root package; the importer-relative Oxc alias selects the nested package. Both targets are asserted independently, and the esbuild metafile confirms the bundled input.

webpack’s exact-match `$` aliases, fallback aliases, dependency-specific options, and resolver plugins are separate decisions. Select a configured dependency/layer resolver before calling the adapter. Pass issuer context and dependency-tracking sets when plugins need them. The adapter does not reproduce `NormalModuleFactory`, module rules, loader requests such as `loader!file`, or compilation externals.

Vite can use regex aliases, custom resolvers, environment-specific configuration and plugins. Its adapter forwards the native request options. A plugin-owned `node:fs` ID with `external: false` remains virtual. Its spelling alone does not authorize a Node builtin.

### Conditions do not select the whole program

Package export object order determines which matching condition wins. The order of a caller’s condition list is not a replacement for that algorithm. Preserve blocked exports, nested conditions and missing targets instead of retrying with a broader list.

esbuild also distinguishes omitted conditions from `conditions: []`. Its ordinary browser build includes `module`; an explicitly empty custom list disables that addition. A native fixture asserts different bundled files for those two inputs.

The native Turbopack fixture uses this package:

```json
{
  "exports": {
    "react-server": "./server.js",
    "browser": "./browser.js",
    "node": "./node.js",
    "default": "./fallback.js"
  }
}
```

A server component and a client component import it. Next 15.5.18 emits the server marker in a React Server Component chunk, the browser marker in a browser chunk, and the Node marker in the client component’s server-rendering chunk. It emits no fallback marker. This is compilation evidence for those contexts, not execution of the components.

Next’s source installs context-specific import maps, externalization, font handling and validation around those conditions. Turbopack’s `AssetIdent` includes layer, query and fragment. The inspected Next SWC project API exposes compilation and endpoints, not a general `resolve(specifier, importer)` method. No condition-only Turbopack adapter is supplied.

### TypeScript paths are not runtime rewrites

TypeScript documents that `paths` does not change emitted imports. Its resolver also searches declarations and uses type-oriented conditions. A successful `.d.ts` lookup cannot supply executable code.

Resolve relative mappings against their defining configuration. Preserve exact matches, longest-prefix wildcard selection, ordered fallback targets and inherited configuration semantics. Do not union a child’s `paths` with its parent’s mappings. Bun’s inspected implementation explicitly distinguishes an absent `paths` property from an empty object that clears inherited mappings.

`rootDirs` describes a merged source layout for the type checker. It does not copy files into that layout. Package references, source redirects, `.js` extension substitution, and workspace package exports likewise require an explicit policy. They are not reasons to bypass a package’s public exports.

The `tsconfig-paths` library is another policy, not TypeScript’s entire resolver. Its defaults include a match-all rule and `main` lookup. It does not establish runtime parity with every bundler that supports tsconfig paths.

### Parcel adds decisions outside Node package lookup

Parcel’s default resolver passes environment and specifier type to its resolver core. Package exports are disabled unless enabled in the inspected default configuration. Automatically enabling them changes the selected entry.

Parcel also distinguishes JavaScript bare specifiers from HTML/CSS URL dependencies. A leading `/` can mean the project root; `~` uses a package root. Named pipelines, `npm:` URL dependencies, package `alias` mappings, symlinked package `source` fields and browser behavior need Parcel’s owning pipeline. No Parcel runtime result is claimed by the Oxc or Vite tests.

### Filesystem paths are not always module identities

Yarn PnP resolves a request using its issuer’s dependency map. A virtual peer-dependent package path must not be collapsed merely because its files share physical storage. Zip-backed packages also require a compatible filesystem. The Node CommonJS adapter follows the running process’s installed hooks; the ESM implementation does not claim PnP-hook parity.

Metro tries platform-specific files, then `.native` when enabled, then the unqualified extension. It also resolves assets and Haste modules. A generic `.tsx`, `.ts`, `.js` list omits those decisions.

Deno first distinguishes npm-package referrers from workspace resolution. Its URL, npm and import-map policies cannot be replaced by Node filesystem resolution. Browser import maps also use referrer scopes and normalized URLs. A blocked mapping must throw rather than falling through to another package search.

## What to reuse from Knip

Knip is useful for finding configuration and analysis entry points. It is not an oracle for the one implementation a runtime loads.

The inspected Knip webpack plugin evaluates function configurations in development and production. It collects aliases, loader aliases, entries and plugin dependencies. `ProjectPrincipal.addPaths` combines scoped path candidates. That breadth helps find dependencies across build modes; it loses the distinction needed to execute one mode.

Knip’s module resolver includes declaration extensions and both `require` and `import` conditions. On failure, it retries browser conditions without the original tsconfig. These are deliberate dependency-analysis choices. Copying them into execution would convert a configuration failure into a different program.

Reuse these parts when configuration discovery is added:

- Dependency-based plugin detection and supported configuration filename patterns.
- Workspace boundaries, entry conventions and config-file dependencies.
- Alias candidates with their originating file, mode, target, order and raw value.

Keep these boundaries:

- Discovery returns candidates. It does not silently choose between two build configurations.
- Preserve regex aliases, custom resolvers, `false` targets and functions instead of flattening them into strings.
- Ask the installed toolchain to load and normalize its selected configuration. Configuration evaluation executes code and belongs in an isolated process.
- Keep discovery/setup failures distinct from unresolved requests. Do not retry a broken configuration as a configless project.
- Do not import Knip’s private plugin API as a stable runtime contract. Pin and attribute any copied discovery implementation under its ISC license.

No Knip code is vendored in this change. Automatic configuration discovery remains unimplemented.

## Contract for the later module loader

A resolved file is not yet a loadable module. Preserve the following information before building a module graph:

1. The original request, importer identity, dependency kind, import attributes and entry status.
2. The toolchain/version, selected configuration, mode, platform, environment and framework layer.
3. The resolver’s file, virtual, builtin, ignored, external or unresolved outcome. Keep external mode and diagnostics.
4. The owning loader and its namespace, suffix, plugin metadata, transforms, generated imports and source maps.
5. The configuration and filesystem state used for caches. A cached miss also needs invalidation.

The current result union does not contain a complete loader descriptor. In particular, adapters do not preserve every toolchain metadata field or make virtual modules executable. IDs must remain scoped to their resolver context. Oxc’s cache clear is not graph invalidation, and Node’s package caches can require a fresh process.

## Further acceptance checks

The following work is still needed before claiming broader support:

- Native Parcel and Rspack comparisons, including custom resolver plugins and non-JavaScript dependencies.
- Yarn PnP zip/virtual-peer projects, Metro platform/assets/Haste cases, Bun and Deno runtime projects, and browser import-map tests.
- Windows paths, case-sensitive versus case-insensitive filesystems, symlink flags and package-manager layouts outside the measured environment.
- Framework-generated imports, worker/new-URL/CSS requests, import attributes, native addons, JSON/Wasm loaders, remote modules and plugin namespaces.
- Correct Next layer assignment for each reachable import, including edge middleware, server actions, client transitions and externalization.
- Engine262 source loading, linking and actual React execution. None follows automatically from these resolution results.

## Documentation consulted

The source snapshots accompany current documentation, rather than replacing it:

- [TypeScript module resolution reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [Parcel dependency resolution](https://parceljs.org/features/dependency-resolution/)
- [Rollup plugin development](https://rollupjs.org/plugin-development/)
- [esbuild aliases and conditions](https://esbuild.github.io/api/#alias)
- [Vite shared resolution options](https://vite.dev/config/shared-options.html#resolve-alias)
- [webpack resolve configuration](https://webpack.js.org/configuration/resolve/)
- [HTML import maps and module resolution](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
- [Knip plugins and configuration files](https://knip.dev/explanations/plugins)
