---
meta:
  title: Module graph research and parity work
  navLabel: Module Graph Research
  contentType: Conceptual
  category: Architecture
  plan: ../../../scratchpad.md#module-graph-research-and-parity-plan
---

# Module graph research and parity work

This is a source review, an implementation comparison, and a bounded repair plan. It is not a claim of parity with six toolchains. A bundler's dependency or liveness graph does not establish the causal behavior of a React application.

The [architecture](architecture.md) describes Bippy's current engine. The findings below separate inspected mechanisms, demonstrated defects, and proposed changes.

## Sources and evidence boundaries

The repositories were cloned locally and the following revisions inspected. Links use those revisions rather than mutable branch names.

| Project               | Revision                                   | Main question                                                                |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Knip                  | `e4fbf46acff08e78370e72b142e795bd81f28561` | How are symbol usage and re-export origins represented?                      |
| webpack               | `a1c4b72787efbfd0ac9ebf87754d1fde21bb0aa9` | How do dependency occurrences, conditions, and invalidation connect?         |
| Rolldown              | `7f44e1445106817c2421a523239af8653a352008` | How are scan results linked into canonical symbols?                          |
| SWC                   | `9fd218151fda5bb51a21a37c58c3b86f87d7ea2c` | What does its bundler add beyond parsing and transforms?                     |
| esbuild               | `f6058f8364fe7ab91ca57a83e02577ed74c9cae4` | How are scan identity, immutable inputs, and export ambiguity handled?       |
| Turbopack, in Next.js | `729ff712b7dc971b74c455a46797047a9347bd72` | How are incremental tasks, module identities, and graph snapshots separated? |

Local clones are under `/tmp/bippy-module-graph-research`. Source inspection does not mean these six revisions were built or their complete suites run. The differential export experiment uses installed esbuild **0.28.2**, not a build of the reviewed esbuild revision, and Node **24.21.0**. No comparative performance measurements were made.

The semantic reference is ECMAScript [Source Text Module Record `ResolveExport`](https://tc39.es/ecma262/#sec-resolveexport). React's [webpack client-reference resolver](https://github.com/facebook/react/blob/82c44beb444eda5230c063eaa163d01f38817211/packages/react-server-dom-webpack/src/client/ReactFlightClientConfigBundlerWebpack.js#L71-L119) was also inspected. It resolves a module ID and export name through a manifest, with a namespace fallback. Resolving the defining JavaScript binding is not sufficient to reproduce that boundary or its chunk-loading behavior.

## 1. Knip: usage is richer than file reachability

### Representation

Knip's [graph types](https://github.com/webpro-nl/knip/blob/e4fbf46acff08e78370e72b142e795bd81f28561/packages/knip/src/types/module-graph.ts) define a `Map<FilePath, FileNode>`. A file records internal, external, and unresolved imports separately. It also records program files, entry files, scripts, import globs, and exports.

An internal edge contains several maps, not one set of dependency paths:

- Direct imports and renamed imports
- Namespace imports
- Direct, namespace, and renamed re-exports
- Property-access references and identifiers whose members are enumerated

Export records retain the local binding name, declaration location, members, registration information, and whether an export is a binding re-export. Those distinctions prevent a namespace property read from looking like consumption of every export.

[`updateImportMap`](https://github.com/webpro-nl/knip/blob/e4fbf46acff08e78370e72b142e795bd81f28561/packages/knip/src/util/module-graph.ts) updates both the importer's internal map and the target's aggregated `importedBy` information. Reverse information is maintained during graph construction instead of reconstructed for every usage query.

### Origins, cycles, and caches

The [export-origin resolver](https://github.com/webpro-nl/knip/blob/e4fbf46acff08e78370e72b142e795bd81f28561/packages/knip/src/graph-explorer/operations/resolve-export-origins.ts) follows aliases and stars to `(filePath, identifier)` origins. It deduplicates those origins, distinguishes explicit exports, and excludes `default` from star propagation. Namespace re-exports identify the source namespace rather than a coincidentally equal runtime value.

Its recursion key includes both file and identifier. It caches root queries, not recursive results computed under an arbitrary `seen` set. This matters: reaching a cycle during one traversal does not prove that a later unrestricted query has no origin.

[Explorer caches](https://github.com/webpro-nl/knip/blob/e4fbf46acff08e78370e72b142e795bd81f28561/packages/knip/src/graph-explorer/cache.ts) belong to the graph through a `WeakMap`. Invalidation clears definition, usage, import-lookup, and exported-identifier caches and advances a generation. [`getUsage`](https://github.com/webpro-nl/knip/blob/e4fbf46acff08e78370e72b142e795bd81f28561/packages/knip/src/graph-explorer/operations/get-usage.ts) returns locations, entry information, and the kind of path through which usage was found.

### Consequence for Bippy

Preserve dependency occurrences and symbol origins before adding a general graph-query cache. A path-only graph cannot explain whether an event handler was imported, re-exported, accessed through a namespace, or invoked. Knip's usage relationships are useful provenance, but do not prove that a callback runs.

## 2. webpack: dependencies and connections have identity

### Representation and conditional edges

[`ModuleGraph`](https://github.com/webpack/webpack/blob/a1c4b72787efbfd0ac9ebf87754d1fde21bb0aa9/lib/ModuleGraph.js) maps dependency objects to connections and modules to graph records. Module records retain incoming and outgoing connections. Two dependency occurrences targeting one module need not become one edge.

A [connection](https://github.com/webpack/webpack/blob/a1c4b72787efbfd0ac9ebf87754d1fde21bb0aa9/lib/ModuleGraphConnection.js) preserves resolved and current origins and targets, the dependency, weak status, conditions, and explanations. Optimization can redirect a connection without erasing where resolution originally led.

Connection state is not just Boolean. It can mean active, inactive, transitive-only, or circular during evaluation. `isActive()` and `isTargetActive()` answer different questions. Adding a condition intersects it with an existing condition. These are bundler runtime/liveness conditions, not Bippy's React update causes.

### Invalidation and export identity

Graph memoization has explicit `freeze`/`unfreeze` stages. Freezing enables a tuple cache; it does not make every module object immutable.

The [resolver cache](https://github.com/webpack/webpack/blob/a1c4b72787efbfd0ac9ebf87754d1fde21bb0aa9/lib/cache/ResolverCachePlugin.js) records file, context-directory, and missing-path dependencies. It creates a filesystem snapshot and validates that snapshot before reuse. A previously missing candidate becoming present can invalidate a result even when the old resolved file did not change.

[Star-export handling](https://github.com/webpack/webpack/blob/a1c4b72787efbfd0ac9ebf87754d1fde21bb0aa9/lib/dependencies/HarmonyExportImportedSpecifierDependency.js) compares terminal bindings, not exported values. The inspected revision also guards same-name paths back to the parent while collecting star contributions. Its comments explicitly distinguish this static export-graph approximation from executing the specification's resolution algorithm.

### Consequence for Bippy

Keep original requests and dependency locations when resolution yields a shared target. Separate graph invalidation from evaluation journals. A correct heap reset cannot repair a stale resolver result, and a resolver cache cannot establish that an application update is reachable.

## 3. Rolldown: scan first, bind canonical symbols later

### Loading and graph storage

The [module loader](https://github.com/rolldown/rolldown/blob/7f44e1445106817c2421a523239af8653a352008/crates/rolldown/src/module_loader/module_loader.rs) uses indexed module tables, AST and statement side tables, importer records, and a symbol database. Task results arrive through a channel. The output includes dynamic-import usage, entry points, top-level-await metadata, and modules added during a partial scan.

The cache distinguishes `Seen(ModuleIdx)` from `Invalidate(ModuleIdx)`. Partial scanning records newly allocated IDs, retains a snapshot, and has rollback handling. A failed partial scan must not leave newly registered identities pretending to be valid old graph entries.

This is more than parallel file reading. Identity allocation, completion, linking, and invalidation are distinct responsibilities.

### Linking and ambiguity

[`bind_imports_and_exports`](https://github.com/rolldown/rolldown/blob/7f44e1445106817c2421a523239af8653a352008/crates/rolldown/src/stages/link_stage/bind_imports_and_exports.rs) collects possible star conflicts before determining whether they are genuinely different bindings. After symbol linking, it compares canonical references and produces sorted, non-ambiguous exports.

Star traversal respects explicit names and excludes ESM `default`. It keeps CommonJS conflicts separate from ESM ambiguity: runtime CommonJS re-export branches are not automatically static linking errors.

The inspected code also chooses generated names using deterministic execution order and names, rather than task completion order. Stable output ordering and module-allocation order are separate concerns.

### Consequence for Bippy

Resolve imported aliases to defining bindings before deciding whether stars conflict. Do not compare abstract values: two distinct `const` bindings can both contain `1`. Do not apply an ESM ambiguity rule indiscriminately to CommonJS property mutation.

Parallel graph construction would need deterministic diagnostic and provenance ordering. The indexed representation alone does not justify a speed claim or a rewrite in Rust.

## 4. SWC: a parser is not a module graph

### Loader, resolver, and binding identity

SWC's [bundler loader](https://github.com/swc-project/swc/blob/9fd218151fda5bb51a21a37c58c3b86f87d7ea2c/crates/swc_bundler/src/load.rs) is separate from resolution. `Load` can return a pre-parsed module, source file, and transform-helper information. Its contract explains why multiple importers should share loading by `FileName`.

The [ID implementation](https://github.com/swc-project/swc/blob/9fd218151fda5bb51a21a37c58c3b86f87d7ea2c/crates/swc_bundler/src/id.rs) caches module IDs and local/export hygiene marks by filename. Symbol IDs combine an atom with a syntax context. Equal identifier spelling does not establish equal binding identity.

### Graph scope and limitations

The bundler's [dependency graph](https://github.com/swc-project/swc/blob/9fd218151fda5bb51a21a37c58c3b86f87d7ea2c/crates/swc_bundler/src/dep_graph.rs) is a directed graph keyed by module IDs. The separate [graph analyzer](https://github.com/swc-project/swc/blob/9fd218151fda5bb51a21a37c58c3b86f87d7ea2c/crates/swc_graph_analyzer/src/lib.rs) records edges, paths, and cycles. Its traversal uses both visited modules and tracked source-target pairs.

The inspected [`Bundler::bundle`](https://github.com/swc-project/swc/blob/9fd218151fda5bb51a21a37c58c3b86f87d7ea2c/crates/swc_bundler/src/bundler/mod.rs) documents restrictions on mutually dependent entry points and contains unfinished dynamic-import handling. SWC parser or transform support must not be presented as proof of complete bundler semantics.

### Consequence for Bippy

Preserve lexical binding identity independently from source names and component display names. Keep parsing, resolution, declaration linking, and evaluation separate. Replacing a parser does not supply module instantiation, live bindings, top-level-await scheduling, or React causality.

## 5. esbuild: reusable scan inputs, per-link mutable state

### Identity and phase separation

The [scanner](https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/internal/bundler/bundler.go) allocates a source index and records the visited path before dispatching parsing. Its path record includes a namespace and other request information; filesystem paths receive platform-specific canonicalization. A source index is not assumed to be stable semantic ordering.

The [linker graph](https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/internal/graph/graph.go) explicitly treats scanner/cache inputs as immutable. Each linker shallow-clones inputs and pre-clones AST fields it may mutate. Reachable files receive deterministic ordering, with a stable-index map separate from allocation indices.

Entry reachability bitsets determine chunk membership. They do not describe possible JavaScript state transitions.

### Export resolution

The [linker](https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/internal/linker/linker.go) follows import trackers to terminal symbols. Potential star ambiguities are retained until their targets can be compared. Recursive ambiguity checks save and restore cycle-detection state instead of leaking traversal context into siblings. Missing exports, probable TypeScript types, and ambiguous matches have different handling.

### Consequence for Bippy

The existing separation between reusable source records and fresh interpreted values is worth keeping. Any new linking cache must have a declared lifetime and must not contain mutable application values. Reusing an AST does not authorize native execution of its component bodies.

## 6. Turbopack: task dependencies and module dependencies are different graphs

### Identity is more than a path

[`AssetIdent`](https://github.com/vercel/next.js/blob/729ff712b7dc971b74c455a46797047a9347bd72/turbopack/crates/turbopack-core/src/ident.rs) includes a path, query, fragment, nested assets, modifiers, module parts, layer, and optional content type. The same file can participate in different transformed or layered module identities.

The [module graph](https://github.com/vercel/next.js/blob/729ff712b7dc971b74c455a46797047a9347bd72/turbopack/crates/turbopack-core/src/module_graph/mod.rs) stores module handles as nodes. Edge data includes the original module reference, chunking type, and binding usage. Graph entries distinguish chunk-group entries from traced modules.

### Layering and consistency

A single graph can refer to modules already present in earlier graphs through visited-module nodes. Graph and node indices identify those references. Traversal skips re-expanding those earlier nodes while preserving access through the layered snapshot.

The builder distinguishes primary chunkable references from traced references and affecting sources. The resulting graph's outgoing ordering is documented; consumers must not assume arbitrary graph-library iteration reproduces source order.

`ModuleGraph::from_graphs` obtains a strongly consistent task result and stores a snapshot of connected graph values. It exposes separate computations for collected modules, async-module information, batching, chunk groups, and merged modules. These are derived products, not one mutable universal graph.

### Consequence for Bippy

A future cache must include the relevant environment and transform identity, not merely an absolute filename. Server/client layers, queries, resolution conditions, and plugin-generated modules can change meaning. Task invalidation should not be conflated with React update causality or with the graph of source imports.

## Current Bippy comparison

The reviewed implementation has useful separation already:

- [`ModuleResolver`](../src/graph/module-resolver.ts) caches by importer kind, referring file, and request. It distinguishes ESM and CommonJS condition sets, aliases, internal/external results, builtins, and unresolved requests.
- [`SourceFileCache`](../src/parse/parse-source-file.ts) separates queried and ordinary source keys and checks file modification time and size before reusing parsed source.
- [`ModuleGraph`](../src/graph/module-graph.ts) stores declaration records, follows re-exports, and separates explicitly analyzed modules from modeled external packages.
- [`ModuleRecord`](../src/types.ts) retains bindings, imports, exports, dependency specifiers, and module-initialization statements.
- Each render starts fresh evaluation state rather than sharing interpreted module values through `StaticRenderer.derive()`.

However, `ModuleGraph.getModule()` returns cached records before consulting `SourceFileCache`. Cached `null` records also persist. The resolver's own map has no invalidation entry point. Therefore the source cache's metadata check does **not** establish incremental correctness for an existing graph. The lifetime probes below now exercise these boundaries; they do not implement watch mode.

The dependency list is not yet a unified occurrence graph. It cannot by itself retain every request's import kind, source span, transform cause, target identity, uncertainty, and reverse dependency relation. Dynamic imports, side-effect imports, configuration dependencies, and runtime invocation causes must not collapse into one reachability bit.

## First repair: conflicting internal star exports

### Demonstrated defect

Before the repair, `resolveExportWithVisited()` returned the first successful internal star result. Distinct bindings with the same exported name therefore depended on declaration order. A nested ambiguous barrel could also be mistaken for a usable first binding.

The [regression suite](../tests/module-exports.test.ts) keeps source-derived expectations separate from compiler outcomes. It covers both star orders, equal-valued distinct bindings, distinct bindings in one module, alias diamonds, direct overrides, explicit re-export overrides, nested conflicts, cycles with a valid source, and namespace origins.

The repair aggregates successful internal resolutions, compares terminal binding identity, and propagates a structured `isAmbiguous` result. Direct exports still win. Multiple paths to the same binding remain valid. It does not evaluate export values to determine identity.

The first full run exposed a regression in the existing `commonjs-package` fixture: reconstructed CommonJS getter loops were incorrectly treated as ESM star conflicts. `ModuleRecord` marks those synthetic re-exports as CommonJS. They now retain their prior lookup behavior instead of receiving the new ESM conflict rule. The unchanged native fixture and the twenty export controls pass after that correction.

This does not implement global ESM instantiation errors or establish complete CommonJS and modeled-external star semantics. Namespace membership now has the separate checks below.

### Reference tools disagree

The original blanket assumption that esbuild and V8 would agree on every case was false. The preserved experiments found:

| Case                                        | Source-derived resolution                                    | esbuild 0.28.2       | Node 24.21.0 VM linker    |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------- | ------------------------- |
| Cycle with a separate valid binding         | Resolves the binding                                         | Rejects as ambiguous | Links                     |
| Two namespace re-exports of the same module | Resolves the same namespace under the reviewed specification | Builds               | Rejects conflicting stars |

Both declaration orders exhibit these differences. The test data records `ambiguous`, `bundlerAmbiguous`, and `nativeAmbiguous` separately. Changing a tool expectation does not change the analyzer's source-derived expectation. These rows are **disagreements**, not independent all-tool verification or complete runtime parity.

The [native helper](../tests/helpers/link-module-graph.ts) constructs and links `SourceTextModule` records. It never calls `evaluate()`. esbuild compiles with `write: false`; it does not execute application bodies. An initial helper failed because a Vite-rewritten URL was not a filesystem URL. That setup failure remains separate from semantic results.

## Namespace membership and reference-loader fidelity

ECMAScript separates `GetExportedNames` from [GetModuleNamespace](https://tc39.es/ecma262/#sec-getmodulenamespace). Candidate names can include an ambiguous star export. A namespace excludes that ambiguous name; reading the absent property yields `undefined`. Bippy now filters proven ambiguities during ESM namespace materialization and handles reads accordingly. CommonJS handling remains separate.

The [namespace suite](../tests/namespace-exports.test.ts) checks keys, reads, spread snapshots, explicit overrides, default re-exports, and a binding diamond. The source-derived expectations are checked before independent execution. Eight cases reproduce six strict baseline failures and two controls.

The original component harness exposed another tool disagreement. Vitest's installed Vite SSR module runner implements `exportAll` by copying keys only when they are not already present. It does not remove conflicting names and does not reproduce ESM namespace key ordering. Consequently, five of these source-derived expectations disagree with its recorded fibers. Those discrepancies remain explicit assertions; they are not normalized away or called exact matches.

A separate [native ESM capture helper](../tests/helpers/capture-esm-component.ts) lowers TypeScript/JSX without bundling the modules, links them using V8 module records, and captures real React commits through Bippy. Application execution occurs only in this independent child-process capture, after static expectations have been checked. The helper does not replace Bippy's hook, fabricate fibers, or execute component bodies during analysis. These are synchronous fixture captures, not general lifecycle validation or a replacement for application build-pipeline captures.

The spread probe initially used the unmodeled `Object.hasOwn` API. Its uncertainty was not evidence of a broken spread snapshot. An unnecessary eager-spread candidate was preserved and removed. `Object.hasOwn` now reuses modeled own-property presence, handles known primitive boxing and missing keys, and rejects nullish targets before key coercion. Controls cover present `undefined`, absence, inheritance, string indices/length, and nullish failures. Effectful key coercion, proxy descriptor traps, and unknown targets remain incomplete. Namespace own-property queries remain uncertain: the enumerable string-export view is not the namespace exotic object. A rejected candidate inferred that `Symbol.toStringTag` was absent, despite its [specified non-enumerable own property](https://tc39.es/ecma262/#sec-module-namespace-objects) and a native `yes` capture. A ninth safety check preserves uncertainty rather than that incorrect `no`; it is not a complete semantic match. Namespace symbols, prototype/extensibility, writes, and live bindings need separate modeling. An initial error-constructor call used the wrong internal signature; its failing typecheck and empty-model result remain preserved separately.

## Opaque external star exports

An unanalyzed package is not evidence that an export is absent or that a particular binding exists. Bippy now returns an unresolved symbol marked `isUncertain` for ESM stars whose unmodeled external sources prevent resolution. That uncertainty propagates through nested stars and explicit re-exports instead of being discarded like a missing name. Distinct known bindings still establish ambiguity; explicit exports still override stars, and stars still cannot supply `default`. Existing CommonJS lookup and explicit external named references remain separate.

The [external-star suite](../tests/external-star-exports.test.ts) checks fourteen cases in both declaration orders. Each graph is analyzed twice: first with package bodies excluded, then with the same packages allowlisted. The identical opaque graph must remain uncertain whether the hidden package exports the requested name or not. V8 linking and esbuild builds independently check the fully available source; neither executes application bodies. These fixture packages use simple `main` entries. The modeled-star suite below additionally checks a real conditional import target; the helper is not a general loader or build-pipeline harness.

This follows webpack's distinction between `provided === false`, `provided === true`, and exports requiring runtime checks, and Rolldown's separate `NoMatch`, `Found`, and `External` import states. [esbuild propagates dynamic export status](https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/internal/linker/linker.go#L2940-L2968) before star-name resolution and leaves unavailable source indices for runtime resolution. Bippy does not copy these tools' runtime fallback generation into analysis. An initial esbuild check used a TypeScript re-export that the compiler could elide as type-only. The preserved failing check was replaced with a live imported value exported by the consumer; source expectations were unchanged.

Unavailable-module propagation and the modeled-library shortcut are addressed separately below. Global instantiation errors and richer conflict provenance still need separate work. The new marker does not imply that an unknown name definitely exists or is definitely ambiguous, and it does not establish causal reachability.

## Modeled values are not binding origins

The modeled-library star shortcut previously returned immediately when the library registry covered a name. It could bypass a conflicting barrel, an opaque source, or two independently known conflicting bindings. Modeled stars now enter the same aggregation as other star sources; CommonJS retains its first-result lookup behavior.

Value modeling does not establish declaration identity. Equal modeled references retain their existing identity comparison, but a differing external reference is not automatically a proven conflict. It may denote the same binding as a parsed source symbol, or two exported names may alias one binding. Such comparisons remain `isUncertain` until origin information can settle them. The aggregation retains a known non-external representative so that two provably different source bindings still establish ambiguity even when a modeled source appears first.

The [modeled-star suite](../tests/modeled-star-exports.test.ts) uses the installed Redux 5.0.1 package, unchanged through a temporary symlink. Fourteen cases in both declaration orders cover modeled/local mixtures, matching references, a model plus its parsed ESM source, distinct modeled names, explicit overrides, opaque stars and independently known conflicts. The package's ESM source hash is checked before and after. This tests linking and modeling boundaries, not Redux behavior or other versions.

The native linker now uses Node's ESM resolution with the explicit parent-resolution flag. Redux's actual conditional `exports.import` target is linked; its CommonJS default target is not parsed as an ESM substitute. The existing native link suites pass with the same ESM resolution path. V8 linking and esbuild builds do not evaluate application bodies. Explicit origin graphs, uncertain-origin provenance, module instantiation and incremental invalidation remain separate work.

## Unavailable modules are not empty modules

The [unavailable-module suite](../tests/unavailable-module-exports.test.ts) distinguishes a successfully analyzed module with no matching export from a module Bippy cannot resolve or analyze. Missing relative requests and resolved internal paths without a module record now produce `isUncertain` symbols. Named imports, namespace re-exports, local import/re-export pairs and nested stars retain that marker. Star aggregation no longer discards these outcomes as if the target had no matching export. Known conflicting bindings still prove ambiguity; CommonJS star lookup keeps its existing behavior.

Eighteen cases run in both declaration orders. Controls cover a missing package, explicit declarations, default exclusion, successfully analyzed empty modules and a file removed after path resolution. Unsupported-source cases compare the same bytes with and without a supplied source transform. V8 links those fixture bytes as ESM; esbuild uses an explicit `.fixture` loader. Neither reference evaluates application bodies. These are module-boundary checks, not 36 exact rendering repairs.

The [specification's `GetImportedModule`](https://tc39.es/ecma262/#sec-GetImportedModule) assumes requested modules have already loaded successfully before export resolution. A missing dependency is therefore not the same outcome as `ResolveExport` returning `null`. Bippy's uncertainty marker describes incomplete analysis; it is not a modeled native loading exception. The tests assert native loading failure separately even when Bippy can identify an explicit declaration or a known declaration conflict. A resolved symbol must not be used as proof that the whole module graph loads or instantiates successfully.

Global loading/instantiation validation, parse failures, unresolved local declarations, loader-specific semantics and structured dependency-failure provenance remain open. This change does not refresh stale caches or make partial module analysis a complete linker.

## Parser failure is not an empty export set

The [unparsed-export suite](../tests/unparsed-exports.test.ts) covers parser failures that leave an empty statement list. When diagnostics accompany that empty list, export lookup now retains `isUncertain` and export-name collection reports `complete: false`. A genuinely empty source with no diagnostics remains a known empty module. The failed record and its diagnostics remain available; the graph does not fall back from a failed queried transform to the valid, untransformed file.

Twenty-seven export checks compare disk-backed sources, failed query transforms and rejected virtual modules. They cover nested stars, named/local re-exports, known siblings, explicit declarations, conflicts and default exclusion. Native reference fixtures contain the specified transformed bytes, not replacements inferred from observations. V8 linking and esbuild builds reject those malformed dependencies without evaluating application bodies. Declaration results remain distinct from whole-program loading success.

Fourteen additional parser checks prevent a broader, unjustified claim. With the installed Oxc 0.148.0 parser's current options, duplicate bindings and missing local exports can produce no diagnostics despite native syntax errors. A valid CommonJS top-level return can produce a diagnostic, while a duplicate default export can retain statements despite an error. Consequently, neither an empty diagnostic list nor a blanket rejection of every diagnostic establishes correct validation. Contextual parser mode plus semantic checks agrees with the native compiler on these fixtures only; production parser options are unchanged.

[esbuild retains parse success separately from its AST](https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/internal/bundler/bundler.go#L267-L300). [React Flight's Node loader](https://github.com/facebook/react/blob/82c44beb444eda5230c063eaa163d01f38817211/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js) catches parse errors while transforming directives or collecting export names, leaving later loading/validation responsibilities separate. These behaviors do not authorize Bippy to equate a failed parse with an empty module. Format-aware parsing, nonfatal diagnostics, semantic validation, namespace creation and global loading/instantiation remain open. The 41 new checks include retained parser limits, not 41 exact rendering repairs.

## Graph lifetime probes

The [lifetime suite](../tests/module-graph-lifetime.test.ts) characterizes fourteen cases with controlled temporary files. It reads declarations and resolves requests without rendering components or executing application bodies. Its passing assertions describe existing cache behavior, including stale results; they are not freshness or incremental-correctness claims.

| Change or control                                          | Reused state                                                                          | Fresh control                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unchanged source                                           | Same module and parsed-file identities                                                | No replacement needed                                                |
| Source edit with changed size                              | The source cache sees new text; the graph retains its old record                      | A new graph can use the refreshed source cache                       |
| Missing file created                                       | Cached graph `null` persists                                                          | A new graph sees the file                                            |
| Loaded file deleted                                        | The graph retains its record even when the source cache returns `null`                | A new graph returns `null`                                           |
| Virtual module registered again                            | The first record stays registered, as documented by `addVirtualModule`                | A new graph accepts the replacement source                           |
| Previously missing resolution                              | Replacing only the graph still uses the resolver's cached failure                     | A new resolver finds the file                                        |
| Higher-priority extension created                          | The resolver retains its original target                                              | A new resolver selects the higher-priority file                      |
| Package exports or tsconfig paths changed                  | The resolver retains its original target                                              | A new resolver observes each tested change                           |
| Transform dependency changed, ordinary or queried source   | The source cache retains old transformed text; a new graph sharing it is insufficient | A new source cache runs the transform against the changed dependency |
| Source bytes changed with equal size and modification time | The source cache retains old text                                                     | A new source cache reads the changed bytes                           |
| Loaded and unread files changed together                   | Old loaded records coexist with new lazily loaded records                             | A new graph reads both changed files                                 |
| Renderer derived after a source edit                       | `derive` shares the already loaded record                                             | A newly constructed renderer sees the tested source edit             |

An existing graph is therefore neither a live filesystem view nor an atomic filesystem snapshot. Keep source and project inputs fixed during analysis and replay. `derive` changes render-time options over the same parsed project; it is not a reload operation. Recreating the whole renderer avoids the tested loaded-record reuse, but these probes do not establish that every framework/plugin cache refreshes correctly or that reads during concurrent edits are coherent.

No `invalidate(file)` method or additional cache is introduced here. A future reload design must account for graph records, analyzed-module membership, resolver successes and failures, resolution configuration, transform dependencies, and renderer project state together. webpack's snapshot validation tracks dependencies beyond the resolved file. React Flight's chunk cache tracks runtime loading by chunk ID; it does not establish validity of Bippy's filesystem-derived products. Neither mechanism should be copied into an unrelated cache without its validity conditions.

## Parity work still required

| Priority | Work                                   | Acceptance evidence                                                                                                                                                        |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Complete export-resolution boundaries  | Extend the bounded namespace/default checks to external uncertainty, CommonJS cases, cyclic aliases, and source-located conflicting origins; preserve engine disagreements |
| 2        | Define graph lifetime and invalidation | Edit a source; create a previously missing file; change package exports, tsconfig paths, and transform dependencies; compare a reused graph with a fresh graph             |
| 3        | Retain dependency occurrences          | Distinguish static import, require, dynamic import, type-only, side-effect, asset, and configuration edges with original spans and resolution provenance                   |
| 4        | Make identity contextual               | Query/fragment, loader/plugin result, environment/layer, conditions, symlink policy, and import attributes; prove sharing and separation with counterexamples              |
| 5        | Separate linking from execution        | Live bindings, initialization order, cycles, module errors, and async dependencies without evaluating application bodies natively                                          |
| 6        | Optimize only measured queries         | Stable diagnostics and symbol results on deep chains, diamonds, cycles, and wide barrels; measure time, memory, and work counts without raising analysis budgets           |
| 7        | Connect the graph to causal analysis   | Preserve why a source or callback matters, then verify scheduling and reachable effects separately from module or symbol reachability                                      |

Do not copy tree shaking into the analyzer as a blanket deletion rule. An apparently unused import can execute initialization effects. A callback reference is not evidence that it was invoked. An external module with unknown exports is not an empty module.

No general module-graph parity, whole-program completeness, watch-mode correctness, renderer independence, or scalability claim follows from this first repair. Corpus acceptance remains a separate gate at 307/500 repositories.
