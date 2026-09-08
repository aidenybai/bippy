# Can the TypeScript compiler API replace the parser's module graph and binding?

Investigation, prototype and recommendation. Nothing under `src/` changed; the prototype
lives in `scripts/tsc-graph-prototype/` and all numbers below come from it.

**Short answer:** no for the graph, no for binding, and only marginally for values.
`ts.createProgram` on the corpus costs 6–13 s and 2.5–9 GB just to get a checker for
PostHog/Sentry, versus ~1 s for the whole current static render. Once the checker exists it
decides 0.5–3 % of the sites the interpreter currently leaves uncertain, and 0 of the 8
PostHog branch deviations on record. The resolver comparison did surface one real bug in the
current oxc-resolver configuration (`.json` in the extension list), which is worth fixing on
its own. Recommendation: status quo, plus that fix, plus an _optional_ lazily-created
checker as a `typeHint` source if a concrete gap ever calls for it (none of the current
ones do).

## 1. Setup and assumptions

- Branch `devin/1788659752-parser-package`, `typescript@5.9.3`, Node `v22.23.2`
  (the corpus recipes ask for Node 24; the corpus installed and rendered fine on 22).
- Corpus checked out under `/home/ubuntu/bippy-corpus` with
  `scripts/corpus.ts --install-only sonner react-router-templates posthog sentry`.
- VM: 31 GiB RAM, no swap. Child processes ran with `--max-old-space-size=24000`.
- Targets: PostHog `frontend/` (entry `src/index.tsx`, 10 292 files in tsconfig), Sentry
  `static/app` (entry `static/app/main.tsx`, 9 260 files), sonner (`test/` Next app that
  analyzes the `sonner` workspace package from source), react-router-templates
  (`default/`).
- Every measurement is a single run on a shared VM; treat ±20 % as noise.
- Assumption: the owner's goal is _parity on the corpus_, so "does the checker answer
  what the interpreter can't" is measured against the sites where the interpreter actually
  produced `unknown`, `unknown-primitive`, a derived `external`, or a `branch`, during a
  static render of each entry.

### A baseline caveat that matters

The first static-only pass of PostHog/Sentry in this session produced 6 747 / 2 466
fibers in 32 s / 10.5 s. That pass ran before `node_modules` finished installing, so
`@posthog/react`, `@base-ui/react`, `react-toastify` etc. were `opaque` and rendered as
transparent wrappers, which inflates the tree. After install the same command renders
PostHog in **1.1 s / 411 fibers / 61 unknowns / 397 modules** and Sentry in
**1.4 s / 2 535 fibers / 144 unknowns / 729 modules**. The checked-in
`corpus/results.json` (which replays a saved runtime capture) reports 750 and 834 fibers
respectively. All comparisons below use the post-install numbers.

## 2. What the parser does today, and what the checker could take over

Pipeline (files in `src/`):

| Stage            | Where                                                                                                               | Notes                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parse            | `parse/parse-source-file.ts`                                                                                        | oxc-parser; `.js .jsx .ts .tsx .mjs .cjs .mts .cts`. Anything else that resolves (`.json`, `.svg`, `.css`) becomes an `unresolved: unsupported module` import.                                                                                                                                                                                                                 |
| Per-module facts | `graph/module-record.ts` (`createModuleRecord`, 768 lines)                                                          | imports, exports, `export *`, local bindings, CommonJS `exports.x =` / `module.exports =`, `Object.defineProperty`/`Object.assign` on exports, member assignments (`Foo.displayName = …`), TS enums/namespaces, deferred top-level mutations.                                                                                                                                  |
| Resolve          | `graph/module-resolver.ts` (`ModuleResolver.resolve`)                                                               | oxc-resolver with the repo tsconfig (`paths`, `baseUrl`), Vite/Next-style aliases from the framework profile, `SOURCE_EXTENSIONS`, `EXTENSION_ALIAS`, conditions, a fallback for bare workspace names, and "outside configured root ⇒ external".                                                                                                                               |
| Graph            | `graph/module-graph.ts` (`ModuleGraph`)                                                                             | `resolveImport`, `resolveLocalName`, `resolveExport`, `listExportNames`; follows re-exports and `export *` with cycle guards; `shouldAnalyzePackage` decides which `node_modules` packages are parsed from source (`externalPackageAllowList`, helper packages) versus kept `external`. Result is a `ResolvedSymbol` that can be `unresolved`/`ambiguous`, not a symbol table. |
| Bind + evaluate  | `evaluate/interpreter.ts` (`lookupIdentifier` L780, `evaluateTopLevelBindingValue` L659, `evaluateExpression` L808) | Lexical `Scope` chain (`evaluate/scope.ts`), then module bindings evaluated lazily through the graph, then builtins/globals, then `unknown`. Narrowing on `if`/`&&`/`?:` is value-based (`evaluate/narrowing.ts`), `typeof` is answered from `StaticValue.kind` (`builtin-calls.ts` `getTypeofValue` L277), enums are evaluated concretely (`typescript-declarations.ts`).     |
| React layer      | `react/element-type.ts` `toElementType`                                                                             | maps a `StaticValue` to host / function / class / context / React API / external / unknown element types.                                                                                                                                                                                                                                                                      |

Responsibility by responsibility:

| Responsibility                                                                                       | Today                                                     | What `ts` offers                                                                                                                                                                                                                                                                 | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module resolution                                                                                    | oxc-resolver, bundler semantics, assets included          | `ts.resolveModuleName` + `ts.createModuleResolutionCache`. Same speed (1.5 s vs 1.1 s for Sentry's 72 k specifiers). Returns `.d.ts` for every package that ships types; returns _unresolved_ for `.svg/.css/.json`-by-directory, `node:*` builtins, and anything not TS-shaped. | Not a drop-in: 6 410 / 13 809 declaration-only results and 278 / 874 tsc-only-unresolved specifiers in Sentry / PostHog (§4). We would still need oxc-resolver for the source file behind the `.d.ts`.                                                                                                                                                                                                                                                                                                                                 |
| Export / re-export resolution                                                                        | `ModuleGraph.resolveExport` etc.                          | `checker.getExportsOfModule`, `getAliasedSymbol`, `resolveExternalModuleName`. Exact for ESM and `export =`.                                                                                                                                                                     | Works only for files in the program. External packages resolve to declarations, so `getExportsOfModule` tells you _names and types_, not the implementation the parser wants to interpret (e.g. `sonner`'s `Toaster` comes from `../src/index.tsx` for the parser but from `dist/index.d.ts` for tsc; all 15 sonner uncertain sites are `not-in-program` for this reason). CommonJS mutation (`exports.foo = …` in a branch, `Object.assign(module.exports, …)`) and runtime `displayName`/static property assignment are not symbols. |
| Identifier → declaration                                                                             | `lookupIdentifier` + `Scope`                              | `checker.getSymbolAtLocation` → `symbol.declarations`. Cheap once the checker exists.                                                                                                                                                                                            | Correct but redundant: the interpreter needs the _value_ bound at that point in evaluation (including loop iteration, closure capture, narrowing), which a declaration-level symbol doesn't carry.                                                                                                                                                                                                                                                                                                                                     |
| JSX element type                                                                                     | `toElementType(value)`                                    | `checker.getTypeAtLocation(tagName)` gives the component's _type_; `getSymbolAtLocation` gives its declaration.                                                                                                                                                                  | The parser needs the component _function_ to run it. Type identity does not give you `props.children` layout, hooks used, or return value.                                                                                                                                                                                                                                                                                                                                                                                             |
| `const` literals / enums                                                                             | `evaluateTopLevelBindingValue`, `evaluateEnumDeclaration` | `checker.getTypeAtLocation` returns literal types for `const x = 'a'`, `as const`, enum members.                                                                                                                                                                                 | Already concrete in the interpreter when the initializer is static. Where the interpreter says `unknown`, the type is almost always `string`/`boolean`, not a literal (§5).                                                                                                                                                                                                                                                                                                                                                            |
| Type facts for narrowing (`typeof x === 'function'`, discriminated unions, `readonly` literal props) | none                                                      | Declared types, `getBaseConstraintOfType`, union constituents, `getTypeOfSymbolAtLocation` at a use site (flow-narrowed).                                                                                                                                                        | Real but small: 25–52 `literal` and 34–73 `literal-union` answers per large repo out of ~2 000–3 000 sites; `typeof x === 'function'` is decidable from the declared type when the type is _only_ a function type — the interpreter already decides it whenever `x` is a known `function`/`method`/`native-function` value.                                                                                                                                                                                                            |

Two structural mismatches sit under everything:

1. **The parser evaluates _values along an execution_, the checker types _declarations_.**
   `parts.length - 1 === idx` has type `boolean` no matter how much the checker knows about
   `parts: string[]`. The interpreter's `unknown` at that site is not a missing fact about
   the program, it is a missing fact about the _input_ (`shown` state, cookie, store).
2. **The program boundary differs.** The parser deliberately analyzes selected
   `node_modules` packages from their shipped JS (`shouldAnalyzePackage`,
   `externalPackageAllowList`) and treats the rest as `external`. tsc analyzes `.d.ts`
   for all of them and never sees the `.mjs` the runtime executes (base-ui's
   `TooltipRoot.mjs` is the concrete case in §6).

## 3. Program cost (`measure-program.ts`)

Variants: `full` = `ts.createProgram(parsedConfig.fileNames)`; `reachable` = program
rooted at the entry file only, letting tsc pull in what it imports; `language-service` =
`ts.createLanguageService` over the reachable root set, `getProgram()`. "check entry file"
is `getSemanticDiagnostics(entry)`; "full semantic check" is `getSemanticDiagnostics()`
for every file, included only to show what a `tsc`-style pass costs — the parser would
never need it.

| entry                  | variant          | createProgram | getTypeChecker | check entry file | full semantic check | source files (project / node_modules / lib) | peak RSS | wall clock |
| ---------------------- | ---------------- | ------------- | -------------- | ---------------- | ------------------- | ------------------------------------------- | -------- | ---------- |
| sonner                 | full             | 440 ms        | 156 ms         | 208 ms           | 53 ms               | 155 (5 / 67 / 82)                           | 363 MB   | 1.0 s      |
| sonner                 | reachable        | 353 ms        | 130 ms         | 193 ms           | 11 ms               | 146 (2 / 61 / 82)                           | 338 MB   | 0.8 s      |
| sonner                 | language-service | 446 ms        | 0 ms           | 190 ms           | 11 ms               | 144 (2 / 60 / 82)                           | 323 MB   | 0.8 s      |
| react-router-templates | full             | 501 ms        | 179 ms         | 27 ms            | 159 ms              | 274 (6 / 209 / 59)                          | 382 MB   | 0.9 s      |
| react-router-templates | reachable        | 426 ms        | 135 ms         | 31 ms            | 0 ms                | 171 (1 / 111 / 59)                          | 341 MB   | 0.6 s      |
| react-router-templates | language-service | 469 ms        | 0 ms           | 10 ms            | 0 ms                | 132 (1 / 72 / 59)                           | 307 MB   | 0.5 s      |
| sentry                 | full             | 6.0 s         | 2.5 s          | 109 ms           | 95.7 s              | 12 553 (9 258 / 3 200 / 83)                 | 5 981 MB | 104 s      |
| sentry                 | reachable        | 3.7 s         | 1.2 s          | 104 ms           | 67.3 s              | 7 846 (5 638 / 2 124 / 83)                  | 3 662 MB | 72 s       |
| sentry                 | language-service | 5.6 s         | 0 ms           | 112 ms           | 69.8 s              | 7 626 (5 638 / 1 904 / 83)                  | 3 566 MB | 76 s       |
| posthog                | full             | 9.3 s         | 3.3 s          | 405 ms           | 153.5 s             | 15 223 (10 461 / 4 693 / 63)                | 9 322 MB | 167 s      |
| posthog                | reachable        | 6.3 s         | 2.2 s          | 266 ms           | 99.4 s              | 10 489 (7 216 / 3 211 / 62)                 | 7 004 MB | 108 s      |
| posthog                | language-service | 9.5 s         | 0 ms           | 256 ms           | 107.4 s             | 9 770 (7 043 / 2 665 / 62)                  | 7 562 MB | 117 s      |

Reading it:

- Nothing OOMed at 24 GB heap, but PostHog needs ~9 GB RSS for the full program and still
  ~7 GB for the reachable one. Sentry needs 3.6–6 GB. That is against ~1 s and well under
  1 GB for the entire current static render.
- `createProgram + getTypeChecker` is the price of _any_ checker question: 8.5 s (Sentry
  full) / 12.6 s (PostHog full), 4.9 s / 8.5 s reachable. Per-question cost after that is
  negligible (2 000–3 000 `getTypeAtLocation` calls in 1.5–2.7 s in §5).
- The reachable program is not a great win: PostHog's entry transitively imports 7 216 of
  10 461 project files. `frontend/src/index.tsx` → `App` → every scene.
- The language service only defers checker creation; memory is the same, and on PostHog it
  was slower than `createProgram` for the reachable set.
- "Just resolve, don't type-check" is not available: `getTypeChecker()` binds every file
  in the program (that is the 2.2–3.3 s), and every `getTypeAtLocation` triggers checking
  of the containing file lazily.
- The small repos are fine (0.5–1 s, ~350 MB) — but they also have almost nothing for the
  checker to answer (§5).

## 4. Resolver comparison (`compare-resolvers.ts`)

For every import/export specifier in every tsconfig file, `ts.resolveModuleName` (with the
repo's parsed `compilerOptions` and a resolution cache) versus the parser's `ModuleResolver`
(same tsconfig, same framework profile aliases).

| entry                  | files  | specifiers | tsc time | oxc time | same file | both external | both unresolved | tsc `.d.ts` only | tsc unresolved only | oxc unresolved only | same file, different kind | different file |
| ---------------------- | ------ | ---------- | -------- | -------- | --------- | ------------- | --------------- | ---------------- | ------------------- | ------------------- | ------------------------- | -------------- |
| sonner                 | 5      | 7          | 5 ms     | 1 ms     | 1         | 0             | 0               | 5                | 1                   | 0                   | 0                         | 0              |
| react-router-templates | 6      | 12         | 5 ms     | 1 ms     | 1         | 1             | 2               | 5                | 3                   | 0                   | 0                         | 0              |
| sentry                 | 9 260  | 72 513     | 1.5 s    | 1.1 s    | 63 276    | 2 544         | 1               | 6 410            | 278                 | 0                   | 0                         | 4              |
| posthog                | 10 292 | 74 494     | 1.6 s    | 1.2 s    | 56 013    | 953           | 2               | 13 809           | 874                 | 0                   | 2 703                     | 140            |

- **Speed is a wash.** Resolution was never the expensive part of tsc; the program is.
- **tsc `.d.ts` only** (6 410 / 13 809): tsc lands on a declaration file where oxc lands on
  the JS the runtime executes. For the parser these are strictly worse answers.
- **tsc unresolved only** (278 / 874): `.svg`, `.css`, `sentry-images/*`, `node:*`, bare
  Node builtins in `.mjs` build scripts, `ai/rsc`. oxc resolves all of them.
- **same file, different kind** (2 703, PostHog): `products/*/frontend/…` and
  `common/replay-shared` resolve to the same physical file, but `ModuleResolver` marks them
  `external` because they sit outside `frontend/` (`isOutsideRoot`), while tsc treats them
  as project files. Not a resolver disagreement — a policy the parser chose.
- **different file** (4 Sentry, 140 PostHog):
  - Sentry: `sentry/stories/storyManifest.generated` → tsc finds
    `storyManifest.generated.d.ts` (a type-only stub for a build artifact), oxc returns
    `external:sentry`. Neither is the runtime file; both are "don't analyze".
  - PostHog: `…/queries/schema` → tsc: `queries/schema/index.ts`; oxc:
    `queries/schema.json`. **The parser is wrong here.** `SOURCE_EXTENSIONS` in
    `module-resolver.ts` L18 ends with `.json`, and oxc-resolver tries
    `<specifier><ext>` before `<specifier>/index.*`, so the sibling `schema.json` wins.
    PostHog's actual bundler (`common/esbuilder/utils.mjs` L204) sets
    `resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.scss', '.css', '.less']` — no
    `.json` — so at runtime `AgentMode`, `NodeKind` etc. come from `schema/index.ts`.
    All 140 PostHog "different file" rows are this one pattern. Because `.json` is not a
    parsable source language, every one of those imports currently ends as
    `unresolved: unsupported module …/schema.json`, i.e. `unknown` — which plausibly feeds
    the 92 `property "…" of undefined` and 123 `call of undefined` unknowns in §5. Fix:
    drop `.json` from the extension probe list (explicit `./x.json` specifiers still
    resolve) — a one-line change in `src/`, out of scope for this PR.

Net: tsc's resolver would _lose_ coverage (assets, JS behind `.d.ts`) and _gain_ nothing
oxc-resolver cannot be configured to do. The comparison is still a useful audit tool.

## 5. How many uncertain values could the checker answer? (`measure-unknowns.ts`)

Method: render each entry with the real `StaticRenderer`, with
`Interpreter.prototype.evaluateExpression` wrapped (prototype-process only) to record every
expression whose result is `unknown`, `unknown-primitive`, `external` with `derived: true`,
or a `branch` produced by a `?:`/`&&`/`||` (recorded on the test expression). Then build the
full `ts.Program`, find the tsc node at the same span, `checker.getTypeAtLocation`, and
classify (`classify-type.ts`):

- `decided` — a single literal type (`'onClick'`, `3`, `true`, `null`, `undefined`,
  `void`), or for a condition, a type that is always truthy / always falsy;
- `narrowed` — a finite literal union (`'a' | 'b'`, an enum);
- `none` — `string`, `number`, `boolean` (including `true | false`), nullable object
  types, `any`/`unknown`, or the site is not in the program.

"Decided" is deliberately generous to tsc: `always-truthy` counts `FileSystemEntry |
FileSystemImport` as deciding `x && …`, which is only sound if the parser also trusts
that no `undefined` leaks past the type system.

| entry                  | render | program + checker | sites | queried in | peak RSS | in program                                   | decided    | narrowed   |
| ---------------------- | ------ | ----------------- | ----- | ---------- | -------- | -------------------------------------------- | ---------- | ---------- |
| sonner                 | 0.1 s  | 0.6 s             | 15    | 0 ms       | 374 MB   | 0 (all in `../src`, outside `test/tsconfig`) | 0          | 0          |
| react-router-templates | 0.1 s  | 0.5 s             | 2     | 7 ms       | 433 MB   | 2 (`.svg` imports)                           | 0          | 0          |
| sentry                 | 1.4 s  | 7.9 s             | 2 287 | 1.5 s      | 2 576 MB | 2 039                                        | 59 (2.6 %) | 26 (1.1 %) |
| posthog                | 1.0 s  | 13.3 s            | 2 991 | 2.7 s      | 4 026 MB | 2 007                                        | 32 (1.1 %) | 60 (2.0 %) |

By kind:

| entry   | kind                 | sites | decided | narrowed |
| ------- | -------------------- | ----- | ------- | -------- |
| sentry  | `unknown`            | 1 045 | 43      | 6        |
| sentry  | `unknown-primitive`  | 795   | 4       | 17       |
| sentry  | `external` (derived) | 186   | 5       | 3        |
| sentry  | condition → `branch` | 261   | 7       | 0        |
| posthog | `unknown`            | 1 509 | 10      | 52       |
| posthog | `unknown-primitive`  | 771   | 11      | 8        |
| posthog | `external` (derived) | 191   | 0       | 0        |
| posthog | condition → `branch` | 520   | 11      | 0        |

Checker verdict distribution over the sites that were in the program:

| verdict                                       | sentry | posthog |
| --------------------------------------------- | ------ | ------- |
| broad primitive (`string`/`number`/`boolean`) | 1 283  | 1 298   |
| always truthy (object/function/array types)   | 490    | 459     |
| nullable object                               | 104    | 100     |
| `any` / `unknown`                             | 67     | 46      |
| literal                                       | 52     | 25      |
| literal union                                 | 34     | 73      |
| broad object                                  | 4      | 6       |
| error type                                    | 5      | 0       |

What the top reasons look like (PostHog; Sentry is the same shape):

| interpreter reason                                 | sites | decided | narrowed |
| -------------------------------------------------- | ----- | ------- | -------- |
| loop variable                                      | 284   | 0       | 16       |
| call of undefined                                  | 123   | 0       | 0        |
| boolean: negation of unknown                       | 107   | 11      | 0        |
| boolean: `===` on dynamic values                   | 102   | 0       | 0        |
| string: template literal with dynamic parts        | 102   | 0       | 0        |
| property "…" of undefined                          | 92    | 0       | 0        |
| call of property "…" of undefined                  | 61    | 0       | 0        |
| kea value `userLogic.user` after the logic mounted | 45    | 0       | 4        |
| `document.querySelector()`                         | 37    | 0       | 0        |
| `reduce()`                                         | 37    | 0       | 0        |

Observations:

- The `decided` sites are almost all of the form `x && …` where `x` has a non-nullable
  object type (`always-truthy`), plus a handful of `void`-returning calls. Nothing among
  them is a `===`/`typeof`/`.length` comparison — those are `boolean` to the checker every
  time, which is exactly the owner's `'onClick'.charCodeAt(0) === 111` concern, confirmed
  at scale: 0 of 102 `=== on dynamic values` sites decided.
- `narrowed` is mostly enum/literal-union typed loop variables and kea selectors typed as
  a union. Useful for shrinking a `branch`, not for choosing an alternative.
- 984 PostHog sites (33 %) and 248 Sentry sites (11 %) are `not-in-program`: JS inside
  allow-listed packages the parser interprets from source, `.mjs` files, JSON, assets.
  The checker cannot see the code the parser is most unsure about.
- Cost per answer: PostHog spends 13.3 s and 4 GB to decide 32 sites and narrow 60, for a
  render that takes 1.0 s.

## 6. The 8 PostHog branch deviations, one by one

`corpus/results.json` has **8** `report.branchDeviations` for PostHog, not 10; the task
asked for 10, so all 8 are covered and none are invented. Three are the same site
(`TooltipRootContext`), two are the same site (`LemonPureField`). Types below were read from
the source and from `checker.getTypeAtLocation` via `inspect-conditions.ts`.

| #       | component (path tail)                        | reason recorded                                   | source condition                                                                                                                                                                                                                                             | checker type                                                                             | verdict                                                                                                                                                                                                                                                                                                                                                    |
| ------- | -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | `Typewriter` → `div`                         | `&& on <boolean: === on dynamic values>`          | `idx === parts.length - 1` where `parts = full.slice(0, shown).split('\n')`, `shown` is `useState` driven by `setInterval` and `window.matchMedia` (`scenes/authentication/shared/authScene/Typewriter.tsx`)                                                 | `boolean` (`idx: number`, `parts: string[]`)                                             | **Concrete evaluation.** Which iteration is last depends on `shown` at capture time — a timer. No type can carry that. The interpreter _could_ decide it per-iteration if it tracked `idx` against a concrete `parts` list, which is a value-level improvement, not a type one.                                                                            |
| 2, 4    | `LemonPureField` → `LemonFieldError`         | `conditional on <boolean: === on dynamic values>` | `typeof error === 'string' ? … : null` (`lib/lemon-ui/LemonField/LemonField.tsx`)                                                                                                                                                                            | `error: React.ReactNode` ⇒ test is `boolean`                                             | **Concrete evaluation.** `error` comes from kea-forms' `Field` render prop; at first render it is `undefined` because the form has no errors yet. The checker cannot know form state. `ReactNode` even includes `string`, so no narrowing is possible either.                                                                                              |
| 3, 6, 8 | `TooltipRootContext` → `TooltipInteractions` | `&& on branch(unknown \| false)`                  | `shouldRenderInteractions = open \|\| mounted \|\| (!disabled && trackCursorAxis !== 'none')`, `open`/`mounted` from `store.useState('open'/'mounted')` (`@base-ui/react/tooltip/root/TooltipRoot.mjs`)                                                      | not in the program at all; the `.d.mts` types `useState('open')` as `boolean`            | **Concrete evaluation.** The runtime file is `.mjs` that tsc never loads. Even via the declarations, the answer is `boolean`. Deciding it requires knowing the store's initial `open: defaultOpen = false`, `mounted: false` — store semantics, i.e. interpreting the store code, which the parser already does partially (hence the `false` alternative). |
| 5       | `LemonButton` → `Spinner`                    | `conditional on branch(<Spinner> \| undefined)`   | `{icon ? <span>{icon}</span> : null}` after `if (loading) icon = <Spinner/>` (`lib/lemon-ui/LemonButton/LemonButton.tsx` L210, L283); `loading={isLoginSubmitting \|\| precheckResponseLoading}` from kea (`scenes/authentication/login/LoginForm.tsx` L396) | `icon: React.ReactElement \| null \| undefined` ⇒ nullable object; `loading?: boolean`   | **Concrete evaluation.** Needs the initial value of two kea loaders/forms selectors (both `false` before any submit). The checker types the selector as `boolean`.                                                                                                                                                                                         |
| 7       | `PasskeyLoginButton` → `LemonTag`            | `&& on branch(<boolean> \| false)`                | `isLastUsed && <LemonTag>…` with `isLastUsed = lastUsedProvider === 'passkey'`, `lastUsedProvider` from `getCookie(LAST_LOGIN_METHOD_COOKIE) as LoginMethod` (`lib/components/SocialLoginButton/SocialLoginButton.tsx` L180, `login/LoginForm.tsx` L126)     | `isLastUsed?: boolean`; the `as LoginMethod` cast even hides the `null` from the checker | **Concrete evaluation / environment.** Decided by `document.cookie` in the captured browser (no cookie ⇒ `null` ⇒ `false`). A `string \| null` type does not know the cookie. This is what the existing runtime-observation replay is for.                                                                                                                 |

Score: 0 of 8 decidable by type information; 0 of 8 even _narrowed_ in a way that changes
the preferred alternative. Every one is a runtime input: a timer, form state, a store's
initial state, a loader flag, a cookie. The kinds of fixes that would move them are
interpreter/materializer fixes (per-iteration list evaluation, kea/base-ui store initial
state modelling, cookie observations), none of which get easier with a checker attached.

## 7. Hybrid designs

Baseline for the risk column: 95 passing tests; `documenso`, `react-router-templates`,
`sonner` are exact.

### (a) tsc as resolver only (swap oxc-resolver)

- **`src/` changes:** rewrite `ModuleResolver.resolve` on `ts.resolveModuleName` +
  `ts.createModuleResolutionCache`; keep our own alias layer (tsc has no Vite/Next alias
  concept beyond `paths`); add a `.d.ts → implementation` step (read `package.json`
  `main`/`module`/`exports` ourselves — which is what oxc-resolver does); add asset
  handling ourselves.
- **Perf:** neutral (1.5 s vs 1.1 s over 72 k specifiers, done lazily anyway).
- **Gaps closed:** none. The one real resolver bug found (§4, `.json`) is a config line in
  the current resolver.
- **Risk:** high for no gain — 278/874 specifiers become unresolved, 6 410/13 809 land on
  `.d.ts`, sonner's allow-listed source analysis stops working (its `sonner` import would
  resolve to `dist/index.d.ts`). `react-router-templates` would lose its `.svg` imports.
  Expect test failures in resolver/graph tests and a regression on all three exact entries.
- **Verdict:** reject.

### (b) tsc for symbol binding + export resolution feeding `ModuleGraph`

- **`src/` changes:** a `ts.Program` behind `ModuleGraph`; `resolveExport`/
  `resolveLocalName`/`listExportNames` implemented via `checker.getExportsOfModule` /
  `getAliasedSymbol` / `getSymbolAtLocation`; a mapping from tsc declarations back to oxc
  AST nodes (by file + span) so the interpreter can keep evaluating oxc nodes; keep
  `ModuleRecord` anyway for CommonJS mutation, `displayName` assignment, `Object.assign`
  exports and deferred top-level effects, which have no symbol representation.
- **Perf:** +5–13 s and +2.5–9 GB per PostHog/Sentry render before the first identifier is
  bound (the render itself is ~1 s). Reachable program does not avoid it (§3).
- **Gaps closed:** none measured. Export resolution is not where deviations come from; the
  graph already handles cycles, `export *`, ambiguity. tsc would add `export =` /
  `import x = require()` fidelity for `.d.ts`, which the parser doesn't evaluate anyway.
- **Risk:** medium-high. Two graphs (tsc for names, oxc for values) must agree on what
  file a name lives in; §4 shows 2 703 + 140 places in PostHog where they would not.
  Package-boundary policy (`shouldAnalyzePackage`) must be re-implemented as program
  construction. Non-TS inputs (`.mjs` in `node_modules`, JSON) need a fallback to the
  current path, so the current code doesn't go away.
- **Verdict:** reject.

### (c) checker types as a `typeHint` refinement on uncertain `StaticValue`s

- **`src/` changes:** optional `TypeOracle` interface (`getHint(filePath, start, end):
TypeHint | null`) on `StaticRendererOptions`; `Interpreter.evaluateExpression` consults
  it when about to return `unknown`/`unknown-primitive`/derive an `external`, attaching
  `typeHint` (literal ⇒ replace with `primitive`; literal union ⇒ `branch` of primitives;
  `always-truthy` ⇒ narrow `&&`/`?:` in `narrowTest`); a `scripts/`-side implementation
  built on `program.ts` from this prototype. Everything else untouched.
- **Perf:** opt-in, so zero by default. When on: +0.5–1 s for small repos, +8–13 s and
  +2.5–4 GB for Sentry/PostHog (the `unknowns` probe _is_ this design, measured).
- **Gaps closed:** upper bound from §5 is 59 + 26 (Sentry) and 32 + 60 (PostHog) of
  2 000–3 000 sites, none of which are current branch deviations (§6). Realistic use:
  string-literal-typed props (`variant: 'primary' | 'secondary'`) turning into a `branch`
  of concrete strings, so class-name templates become a `branch` of concrete class names
  instead of `unknown-primitive string`. That would improve host prop parity in the report,
  not fiber structure.
- **Risk:** low if opt-in (default `null` oracle ⇒ byte-identical behaviour ⇒ 95 tests and
  the 3 exact entries unaffected). Non-zero when enabled: `always-truthy` is unsound under
  `any`-heavy code and `!`-assertions; a wrong "decided" flips a preferred branch that is
  currently correct via runtime observations. Would need a "observation beats type"
  precedence rule.
- **Verdict:** defensible as a future experiment, not justified by current evidence. Keep
  `measure-unknowns.ts` as the gate: if a real deviation appears whose site the probe marks
  `decided`/`narrowed`, revisit.

### (d) status quo

- **`src/` changes:** none for tsc. Recommended unrelated fix from this investigation:
  remove `.json` from `SOURCE_EXTENSIONS` probing in `graph/module-resolver.ts`
  (140 mis-resolved PostHog imports).
- **Perf:** ~1 s / <1 GB on the largest corpus entries.
- **Gaps closed:** the 8 PostHog deviations remain; they need value-level work
  (per-iteration list evaluation, store initial state, kea loader/form defaults, cookie
  observation), which is in the interpreter/materializer's remit today.
- **Risk:** none.
- **Verdict:** recommended.

## 8. Recommendation

1. Do not build the React layer on a `ts.Program`. Its cost is 10–100× the current whole
   render on the large corpus entries, and its model (declared types of declarations)
   answers a different question than the one the parser asks (the value on this path).
2. Keep oxc-parser + oxc-resolver + `ModuleGraph`. Fix the `.json` extension probe.
3. Keep the abstract interpreter as the single source of values. Spend parity effort on the
   value-level items in §6 — they are all "model the initial state of X" problems.
4. If type hints are ever wanted, do it as (c): an opt-in oracle behind an interface, with
   `measure-unknowns.ts` as the acceptance test. The prototype's `program.ts` and
   `classify-type.ts` are reusable for that.

## 9. Prototype files and how to run them

All under `packages/parser/scripts/tsc-graph-prototype/`, run from `packages/parser`
with `pnpm exec tsx`. All accept `--corpus-dir <dir>` and a list of corpus ids.

| file                    | purpose                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corpus-target.ts`      | maps a manifest entry to clone dir, tsconfig and entry file                                                                                                     |
| `program.ts`            | `full` / `reachable` / `language-service` program construction, file counting, RSS helpers, span → node lookup                                                  |
| `measure-program.ts`    | table in §3; one child process per (entry, variant) with `--max-old-space-size=24000`; `--full-check` adds the whole-program semantic pass; `--out` writes JSON |
| `compare-resolvers.ts`  | table in §4 with bounded examples per disagreement kind                                                                                                         |
| `classify-type.ts`      | `ts.Type` → `literal` / `literal-union` / `always-truthy` / …                                                                                                   |
| `measure-unknowns.ts`   | tables in §5; wraps `Interpreter.prototype.evaluateExpression` in-process, renders, then queries the checker; `--out` writes JSON                               |
| `inspect-conditions.ts` | `<relative-file>:<line>:<snippet>` probes → checker type, verdict, declaration origin; used for §6                                                              |

Known limitations of the probe:

- The wrapper records at expression granularity. A `&&` records its left operand; a `?:`
  its test. Nested sub-expressions that are the actual source of uncertainty are recorded
  separately when they themselves evaluate to an uncertain value.
- `renderFramework` is called without replayed runtime observations, so counts differ from
  `corpus/results.json` (which replays a capture). This under-counts what observations
  already fix and is therefore, if anything, favourable to the checker.
- Single run per measurement; no warm cache for tsc (the parser has none either).
