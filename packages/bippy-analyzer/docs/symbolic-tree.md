# Symbolic tree

Reads a React project with the TypeScript 7 checker and prints, for each component, its data, render tree and states. It never runs the code.

## Run

```sh
pnpm analyze test/fixtures/symbolic-tree/tsconfig.json              # every component
pnpm analyze test/fixtures/symbolic-tree/tsconfig.json -c Wizard    # one component
pnpm analyze test/fixtures/symbolic-tree/tsconfig.json -H           # component tree
pnpm analyze path/to/app/tsconfig.json -f features/ --json
```

Run these from `packages/bippy-analyzer`.

The default output is a tree per component with three sections: data (props, state, hook results), render (the JSX tree, with each handler's effect inline as `onClick ⇒ …`), and states (each reachable state, what it shows, and which button leads where). Bailouts are added when there are any. Run `--help` for all options.

| Option                       | Effect                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `-c, --component <names...>` | Show only these components                                                       |
| `-f, --file <filter>`        | Show only files whose path contains this text                                    |
| `-v, --view <views>`         | Pick sections: `data`, `render`, `states`, `warnings`, `bailouts` (default: all) |
| `-H, --hierarchy`            | Show the parent-to-child component tree with state counts                        |
| `-d, --depth <n>`            | Cut the render tree off at this depth                                            |
| `-a, --attributes`           | Show every JSX attribute, not only event handlers                                |
| `--json`                     | Print the analyses as JSON                                                       |

Render tree symbols:

- `◆` a branch
- `✓` and `✗` its two sides
- `↻` a list
- `onClick ⇒ count = count + 1` a handler and what it does to state
- `"Next" → S3` in a state, the button that leads to another state

## What it does

The pipeline is a port of the React Compiler's front end, followed by our own passes. Read `src/core` in this order:

| File                        | Stage                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `analyze-project.ts`        | Opens the TS project, finds components, runs each one, then lists states               |
| `analyze-component.ts`      | Runs one component through the compiler passes and ours                                |
| `../react-compiler/`        | The React Compiler port, laid out like upstream: HIR, SSA, type and mutation inference |
| `type-provider.ts`          | Types the compiler's HIR from the TS checker                                           |
| `interpret.ts`              | Runs the HIR symbolically: the render tree, with every branch kept                     |
| `infer-domains.ts`          | Turns each value's TS type into the values it can take, and props to mount with        |
| `collect-handlers.ts`       | What each event handler and effect updates                                             |
| `enumerate-states.ts`       | Splits branches into regions and lists each region's states and transitions            |
| `constraints.ts`            | What a path assumes: possible values, branch outcomes, numeric bounds                  |
| `format.ts`, `serialize.ts` | Printing and JSON output                                                               |
| `types.ts`                  | The data passed between stages                                                         |
| `utils/`                    | Small helpers: places, predicates, truthiness, traversal, TS nodes, projects           |

The browser verifier lives in `conformance/verifier`, next to the repos it runs on.

Each ported file names the compiler source it came from.

1. Loads the project with `typescript/unstable/sync` (TypeScript 7).
2. Finds components using the React Compiler's rules: a capitalized function that returns JSX or calls a hook, or one wrapped in `memo` or `forwardRef`.
3. Lowers each component to HIR and runs the compiler's passes, through `inferReactivePlaces`. A function the compiler can't lower becomes a `compiler-error` bailout.
4. Types the HIR with the compiler's `inferTypes`, backed by the checker:
   - React hooks and APIs resolve through the checker, which follows aliases and re-exports to React's declarations.
   - Values the compiler leaves untyped take their TypeScript type: primitives, arrays, `Map`, `Set`, readonly collections and function signatures. A second round lets methods like `items.push` resolve to the compiler's own signatures once `items` is known to be an array.
   - A collection method the compiler doesn't list mutates its receiver when `lib.d.ts` declares it on `Array` but not `ReadonlyArray`, and likewise for `Map` and `Set`.
5. Evaluates the HIR symbolically. Each value becomes an expression over bindings:
   - props, typed from the parameter
   - `useState`, `useReducer` and `useContext`
   - other hooks, typed from their return type
   - `.map` items
   - calls it can't see into whose return type has finite values, like `hasPermission()` returning `boolean`
6. Where control flow merges, the value becomes a `Conditional` that records which terminal decided it. Early returns, `?:`, `&&`, `||`, `??`, `?.` and `switch` all produce one. A `?:`, `&&`, `||`, `??` or `?.` merges where it ends, so a `?.` in a `className` doesn't split the rest of the render. Member reads past a `?.`, and reads of a value that may be `undefined`, are assumed not to throw.
7. Turns each binding's type into its possible values. Unions split into cases, and `any` becomes `Unknown`. For plain JS, literal values at call sites stand in for prop types.
8. Collects handlers from event handlers and effects:
   - `setX(...)`, `setX(prev => ...)`, and `dispatch(action)` evaluated through the reducer
   - calls to local and module functions are followed
   - code after `await` or inside `.then` makes the new value `Unknown(async)`
   - calling into a custom hook's result or a context value, like `query.fetchNextPage()`, may change it to anything, later
   - state the compiler's effects prove a handler mutates is forgotten, since React shows the new contents on the next render
9. Lists the states:
   - It splits the render's branches into regions first. Two branches share a region when their tests read overlapping places, like `toast` and `toast.cancel`, or when one sits inside the other's branch. Regions vary independently, so each is listed on its own and the screens are every combination of one state per region.
   - Within a region it splits only on branches in the render output, and narrows each value as it goes. A truthy `x?.y` also proves `x` isn't null.
   - A difference-bound solver handles `<`, `<=` and `===` on numbers and `.length`.
   - State values are limited to the initial value plus every value a handler can set.
10. For each state and each handler that changes its region, finds which states of the region can come next. A handler that doesn't touch a region leaves it as it is. It also reports branches that can never render.
11. Reports warnings from the compiler's mutation effects:

| Warning           | When                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `lost-update`     | A handler mutates state, then sets it to the same array or object. React skips it. |
| `state-mutation`  | A handler mutates state in place, before copying it or without setting it.         |
| `render-mutation` | State is mutated during render.                                                    |
| `prop-mutation`   | A prop is mutated, like `items.sort()` on an array prop.                           |

To see the HIR for a component, run `pnpm tsx src/cli/hir.ts <tsconfig> -c <name>`.

## Port fidelity

`test/compiler-diff` compares our HIR with the real compiler's after `inferReactivePlaces`, using the newest npm build, with the TypeScript layer turned off. Run `pnpm tsx test/compiler-diff/cli.ts <tsconfig>`.

| Corpus                         | Functions matching |
| ------------------------------ | ------------------ |
| fixtures                       | 16 of 17           |
| bulletproof-react              | 122 of 122         |
| 2048-in-react                  | 8 of 10            |
| The compiler's own test inputs | 941 of 954         |

The compiler's test inputs are vendored from the ported commit in `test/fixtures/react-compiler`, and `pnpm sync:compiler-fixtures` refreshes them. `upstream-fixtures.test.ts` lists every function where the two compilers disagree, with the reason. Most disagreements exist because the npm build predates the ported commit: against a build of that commit, all 955 functions both compilers compile match. The rest are deliberate differences or upstream bugs.

## Example

`test/fixtures/symbolic-tree/src/reducer.tsx`:

```text
Wizard src/reducer.tsx:21
├─ data
│  └─ state reducer WizardState = { step: "details", hasError: false }
│     ├─ .step "details" | "done" | "payment"
│     └─ .hasError false | true reachable false
├─ render
│  └─ ◆ state.step === "done"
│     ├─ ✓ <p> "Thanks!"
│     └─ ✗ <form>
│        ├─ ◆ state.hasError
│        │  └─ ✓ <p> "Something went wrong"
│        ├─ ◆ state.step === "payment"
│        │  └─ ✓ <button onClick ⇒ state.step = "details"> "Back"
│        └─ <button onClick ⇒ state.step = …> "Next"
└─ states (3)
   ├─ S1 state.step === "done"
   ├─ S2 state.step !== "done" ∧ state.step === "details"
   │  └─ "Next" → S3
   ├─ S3 state.step !== "done" ∧ state.step !== "details"
   │  ├─ "Back" → S2
   │  └─ "Next" → S1
   └─ unreachable branches
      └─ never state.hasError L26
```

The error alert can never show, because nothing dispatches `fail`.

## Known gaps

- **Hook result fields are independent.** `query.isPending` and `query.isError` share a state region but each takes every value, even though React Query's union ties them together. The fix is to split on the union type's tag field.
- **Context and stores aren't linked to their source.** A context value or store is typed from its declaration, not from the provider or store that sets it, so its values and the actions that change it are unknown.
- **Calls are opaque unless their return type is finite.** `.filter` results are still `Unknown(call)`, so the analysis doesn't know the result is empty when the source is.
- **Only definite mutations are tracked.** Passing state to a function that may mutate it doesn't forget it.
- **Loops bail out.** A `for` or `while` in render makes the values it changes `Unknown`.
- **No parent-child linking.** Components are modeled separately. Props are narrowed from call sites only when the type is `any`.
- **Class components are skipped.**
