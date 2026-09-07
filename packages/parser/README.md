# @bippy/parser

Builds a React fiber tree from source code without running it. The parser reads a project's modules with `oxc-parser`, links imports with `oxc-resolver`, abstractly interprets each component's render body, and reconciles the resulting elements into the same fiber structure React DOM would commit. Every tree it produces can be checked against a real render captured through Bippy, and the package ships the harness that does so.

This is a private workspace package used for research and tooling; it is not published.

## What it produces

```tsx
const Toggle = () => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!isOpen)}>toggle</button>
      {isOpen && <section>open</section>}
      {isOpen ? <p>yes</p> : <p>no</p>}
    </div>
  );
};
```

```sh
pnpm --filter @bippy/parser inspect tests/fixtures/conditionals.tsx
```

```
HostRoot
└─ Conditionals
   └─ div
      ├─ …
      ├─ Toggle
      │  └─ div
      │     ├─ button
      │     ├─ ? isOpen
      │     │  ├─ then:
      │     │  │  └─ section
      │     │  └─ else: ∅
      │     └─ ? isOpen
      │        ├─ then:
      │        │  └─ p
      │        └─ else:
      │           └─ p
      └─ …
```

The output is a tree of fibers with three kinds of non-fiber nodes:

- **branch** (`? test`): control flow the analysis could not decide, with one alternative per outcome. The same test string has one outcome within a render, so nested branches on it collapse and values that branched on it are refined on each path.
- **list** (`* description`): zero or more repetitions of an item shape, produced by `.map()` over data of unknown length.
- **unknown** (`… description`): a subtree that could be anything, with the reason recorded (`unknown(props.children)`, `state (initially 0)`, `cloneElement of non-element`).

A fiber is **opaque** when its component's implementation is outside the analyzed graph (an external package that is not resolved, or resolved but not parsed). Its children are unknown.

## How it works

```
source files ─▶ module ─▶ project ─▶ link ─▶ analyze ─▶ fiber ─▶ snapshot
                parse      resolve    symbols  interpret   build    compare
```

| directory      | role                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/module`   | Parses one file with `oxc-parser` into a `ParsedModule`: program, bindings (imports, declarations, exports, re-exports, CommonJS `require`/`exports`), a line index, and AST helpers.                                                                                                                                                                   |
| `src/project`  | A set of modules under a root directory. Resolves specifiers with `oxc-resolver` honoring `tsconfig.json` paths and extension aliases, tolerates unresolvable `extends`, follows workspace symlinks, and can shadow the file system with in-memory sources for tests.                                                                                   |
| `src/link`     | Resolves a name in one module to the declaration that defines it across imports, exports, namespaces and re-exports (`LinkedSymbol`), identifies references to React's API (`memo`, `forwardRef`, `createContext`, `Fragment`, …) regardless of how they were imported, and records the module-level member assignments that build compound components. |
| `src/analyze`  | The abstract interpreter. Evaluates expressions and statements over `StaticValue`s, models React's API calls, hooks and contexts, classifies function, class, memo, forwardRef, lazy and context components, and evaluates module bindings lazily on demand.                                                                                            |
| `src/fiber`    | Reconciles the element values a render produced into `StaticFiber`s following `ReactChildFiber` and `ReactFiberConfigDOM`: fragments flatten, a lone string child becomes `textContent` rather than a `HostText`, Suspense fallbacks are kept, hoistables and singletons get their tags, and the render/recursion/fiber budgets cut off runaway trees.  |
| `src/snapshot` | A serializable projection (`FiberSnapshot`) shared by the static builder and the runtime capture, a tree printer, and the matcher that decides whether a runtime tree is one of the trees a static snapshot describes.                                                                                                                                  |
| `src/harness`  | Renders a component for real under happy-dom with Bippy observing commits and turns the committed fiber root into a `FiberSnapshot`; `verifySnapshots` compares it with the static one. Exported as `@bippy/parser/harness`.                                                                                                                            |
| `src/corpus`   | Scans and live-verifies real repositories: checkout, dev server management, a Playwright capture script bundled with Bippy's hook, and report writing. Exported as `@bippy/parser/corpus`.                                                                                                                                                              |
| `scripts`      | The `inspect` and `corpus` command-line entry points.                                                                                                                                                                                                                                                                                                   |

### Static values

Everything the interpreter computes is a `StaticValue` (`src/analyze/values.ts`): literals, text of unknown content, regular expressions, arrays with optional items, lists, objects with an optional unknown spread, functions with their closure scope, components, elements, module namespaces, external references, standard globals, conditionals and unknowns. The rules that matter most:

- **Conditionals** carry the source text of their test. `conditional("isOpen", a, b)` collapses nested conditionals on `isOpen`, normalizes `!x` to `x` with swapped arms, and folds identical arms. Binary operators, property reads, `cloneElement` and `isValidElement` distribute over the arms.
- **Narrowing** refines variables along a path: entering `if (user)` drops the nullish arms of `user`, `x?.y === "a"` refines property paths, `switch` cases refine by equality, and every local value that branched on the same test loses its other arm. Writes inside a narrowed path drop the refinement.
- **Undecided effects**: side effects performed under a branch the analysis could not decide (`items.push(x)` inside `if (flag)`) are recorded as conditional on that branch.
- **Shapes are trusted only where they are complete.** An object with an unknown spread, an array whose items may be absent, a function whose statics were written by code the analysis did not run: reads of absent keys stay unknown. Otherwise absent keys read `undefined`, as they do at runtime.
- **State is forgotten.** Hook and class state keeps its shape but not its values, because the runtime tree is observed after effects and updates ran; a fiber under `? isLoading` is expected, not a defect.
- **Loops** unroll when the trip count is static (including counters assigned in the header, as compiled code emits); otherwise the body runs once under an undecided branch and the result is a list.
- **Globals** (`Object.assign`, `Array.prototype.slice.call`, `Math`, `Symbol`, `process.env.*`) are first-class values so helpers such as Babel's `_extends` fold.

Diagnostics (`interpreter.diagnostics`) explain what could not be modelled and where.

## API

```ts
import { createStaticRenderer } from "@bippy/parser";

const renderer = createStaticRenderer({ rootDirectory: "/path/to/app" });

const { root, snapshot, diagnostics } = renderer.renderExport("src/App.tsx", "default");
const mounts = renderer.findMountPoints("src/main.tsx"); // createRoot().render / hydrateRoot / render
const value = renderer.getExportValue("src/config.ts", "routes"); // any StaticValue
```

`StaticRendererOptions` extends `ProjectOptions` (`rootDirectory`, in-memory `files`, `alias`, `moduleDirectories`, `followExternalModules`) with interpreter options (`environment`, `maxCallDepth`), build budgets (`maxRenderDepth`, `maxRecursion`, `maxFiberCount`) and a `timeBudgetMs` after which a render throws `AnalysisTimeoutError`.

To print a tree the way `inspect` does, use `renderSnapshotTree(snapshot)`; `renderOwnerTree(root)` prints the owner tree instead of the parent tree.

## Commands

```sh
pnpm --filter @bippy/parser test          # unit tests and fixture conformance
pnpm --filter @bippy/parser typecheck
pnpm --filter @bippy/parser inspect <file> [--export name | --entry] [--owner] [--json] [--ids] [--hooks] [--locations] [--diagnostics]
pnpm --filter @bippy/parser corpus [options] [name...]
```

`inspect` renders one export (or, with `--entry`, whatever the file mounts through react-dom) and prints the tree, the fiber count and the unknown count. `--diagnostics` lists what the interpreter could not model.

## Verifying against reality

The static tree is only useful if it agrees with what React commits. Two layers check that.

### Fixture conformance

`tests/fixtures/*.tsx` are small apps covering one feature each (conditionals, lists, context, class components, error boundaries, hooks, HOCs, Suspense, compiled output, path aliases, …). `tests/conformance/fixtures.test.tsx` renders every fixture's default export both ways:

1. statically, with `createStaticRenderer` over the fixtures directory;
2. for real, with `renderRuntimeSnapshot` from the harness: React DOM under happy-dom, Bippy's hook installed before React loads (`tests/setup.ts`), effects and lazies flushed.

The runtime tree must be one of the trees the static snapshot describes, and unless a fixture exports `minCoverage`, every runtime fiber must be explained by a concrete static fiber. A match cannot be bought with wildcards.

### Matching and coverage

`matchSnapshots` compiles each static child list into a small automaton: fibers are literal states, unknown nodes match any run of siblings, branches are alternations and lists are repetitions. Simulating the automaton over the runtime siblings yields, among all accepting paths, the one that explains the most runtime fibers; wildcards absorb only what no concrete fiber can account for. Names tolerate bundler deconflicting suffixes (`RouterProvider2`), and a Suspense boundary caught suspended at capture time (an Offscreen primary tree beside its fallback fragment) is compared against the fallback the static tree describes.

`verifySnapshots` reports `isMatch`, the mismatches with their runtime paths, fiber and unknown counts, and `coverage = explainedFiberCount / runtimeFiberCount`. A match at 60% coverage is honest but weak; the goal is to raise coverage without ever losing the match.

### Corpus

`src/corpus/repositories.ts` describes 30 open-source React applications (cal.diy, shadcn/ui, excalidraw, tldraw, dub, twenty, formbricks, trigger.dev, novu, chakra-ui, pierre, bulletproof-react, rallly, umami, mantine, react-admin, TanStack Router, React Router, documenso, plane, outline, ai-chatbot, heroui, refine, react-three-fiber, docusaurus, material-ui, payload, supabase, appsmith) with their framework, app directory, entry files and, where the app runs without a backend, how to boot its dev server. `src/corpus/workspace-apps.ts` adds the e2e fixture apps of this monorepo.

```sh
pnpm --filter @bippy/parser corpus                          # clone and statically scan every repository
pnpm --filter @bippy/parser corpus --workspace --live       # boot dev servers, capture with Playwright, compare
pnpm --filter @bippy/parser corpus --offline shadcn-ui/ui   # one repository, no network
```

A **scan** renders every component exported by the app directory and reports how many rendered, crashed or timed out, and how many fibers, unknowns and opaque fibers the trees hold; per-component trees are written under `.corpus/report/<repo>/`. A **live** run finds the app's mount point, renders that tree statically, starts the dev server, injects a Bippy-based capture script before the page's React loads, snapshots every committed root once the page settles, and verifies the static tree against the largest root. `report.md` summarizes both. Clones and reports live under `.corpus/`, which is ignored by git.

Product apps that need a database or API (cal, dub, supabase, …) are scanned only. Live targets are the workspace apps and the repositories that run without a backend once their dependencies are installed: excalidraw, tldraw, bulletproof-react, react-admin and the TanStack Router example.

## Known limits

- Externals stay opaque unless `followExternalModules` is on or the package is linked through `moduleDirectories`; React itself is always modelled rather than parsed.
- Module-level statements other than declarations, `X.member = …` and `Object.assign(X, {…})` never run. Bindings such statements mention are marked so their statics read unknown instead of a wrong `undefined`.
- Values from `Proxy`, `Map`/`Set` contents, `Object.create` prototypes and most host APIs are unknown.
- Hook and class state, refs read during render, and anything a `useEffect` changes are unknown by design; the tree describes what could render, not one particular commit.
- One analysis is bounded by `maxCallDepth`, `maxRecursion`, `maxFiberCount` and `timeBudgetMs`; exceeding them yields unknowns or `AnalysisTimeoutError`, not wrong trees.

## Working on it

- Add a fixture under `tests/fixtures/` for any new React behavior, and make it pass conformance at full coverage; set `minCoverage` only for behavior that is unknowable statically.
- Add interpreter behavior tests to `tests/unit/interpreter.test.ts`; they evaluate a virtual module and compare `describeValue` output.
- Use `inspect --diagnostics` and the corpus reports' unknown descriptions to find the next thing to model. A wrong known value is a bug; an unknown is a gap.
- React's own source is the reference: `ReactChildFiber`, `ReactFiberConfigDOM`, `ReactChildren`, `ReactSymbols`, `ReactJSXElement` and `ReactWorkTags` are what `src/fiber` and the element model follow.
