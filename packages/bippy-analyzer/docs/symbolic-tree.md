# Symbolic tree

Reads a React project with the TypeScript 7 checker and prints, for each component, its data, render tree and states. It never runs the code.

## Run

```sh
pnpm analyze fixtures/symbolic-tree/tsconfig.json              # every component
pnpm analyze fixtures/symbolic-tree/tsconfig.json -c Wizard    # one component
pnpm analyze fixtures/symbolic-tree/tsconfig.json -H           # component tree
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

The pipeline is a port of the React Compiler's front end, followed by our own passes. The code lives in `src/core`:

| Folder               | Contents                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `hir`                | The compiler's HIR: blocks, instructions, terminals and places, lowered from the TS 7 AST |
| `ssa`                | `enterSSA`, `eliminateRedundantPhi` and instruction-kind rewriting                        |
| `optimization`       | Constant propagation, dead code elimination and props method calls                        |
| `type-inference`     | The compiler's `inferTypes`, with TypeScript filling what it can't infer                  |
| `compiler-inference` | The compiler's mutation, aliasing and reactivity inference, and manual memo dropping      |
| `reactive-scopes`    | Reactive scope variables, which aliasing inference needs                                  |
| `typescript`         | How the TS 7 checker feeds the compiler: types, React exports and mutating methods        |
| `entrypoint`         | Finding components, running the passes, and analyzing a project                           |
| `inference`          | Our passes: symbolic evaluation, transitions, value domains and state enumeration         |

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
6. Where control flow merges, the value becomes a `Conditional` that records which terminal decided it. Early returns, `?:`, `&&`, `||`, `??` and `switch` all produce one.
7. Turns each binding's type into its possible values. Unions split into cases, and `any` becomes `Unknown`. For plain JS, literal values at call sites stand in for prop types.
8. Collects transitions from event handlers and effects:
   - `setX(...)`, `setX(prev => ...)`, and `dispatch(action)` evaluated through the reducer
   - calls to local and module functions are followed
   - code after `await` or inside `.then` makes the new value `Unknown(async)`
   - state the compiler's effects prove a handler mutates is forgotten, since React shows the new contents on the next render
9. Lists the states:
   - It splits only on decisions in the render output, and narrows each value as it goes.
   - A difference-bound solver handles `<`, `<=` and `===` on numbers and `.length`.
   - State values are limited to the initial value plus every value a transition can set.
10. For each state and transition, finds which states can come next. It also reports branches that can never render.
11. Reports warnings from the compiler's mutation effects:

| Warning           | When                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `lost-update`     | A handler mutates state, then sets it to the same array or object. React skips it. |
| `state-mutation`  | A handler mutates state in place, before copying it or without setting it.         |
| `render-mutation` | State is mutated during render.                                                    |
| `prop-mutation`   | A prop is mutated, like `items.sort()` on an array prop.                           |

To see the HIR for a component, run `pnpm tsx src/cli/hir.ts <tsconfig> -c <name>`.

## Example

`fixtures/symbolic-tree/src/reducer.tsx`:

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
   └─ dead branches
      └─ never state.hasError L26
```

The error alert can never show, because nothing dispatches `fail`.

## Corpus results

| Repo                           | Files | Components | States | Time   | Bailouts       |
| ------------------------------ | ----- | ---------- | ------ | ------ | -------------- |
| fixtures                       | 9     | 17         | 34     | 100 ms | none           |
| bulletproof-react (react-vite) | 127   | 107        | 186    | 980 ms | unknown-call 2 |

## Known gaps

- **Too many states in large components.** Independent sibling branches multiply, up to a cap of 256. States should be stored as independent parts, one per group of branches that share values.
- **Hook result fields are independent.** `query.isPending` and `query.isError` are split separately, even though React Query's union ties them together. The fix is to split on the union type's tag field.
- **Calls are opaque unless their return type is finite.** `.filter` results are still `Unknown(call)`, so the analysis doesn't know the result is empty when the source is.
- **Only definite mutations are tracked.** Passing state to a function that may mutate it doesn't forget it.
- **Loops bail out.** A `for` or `while` in render makes the values it changes `Unknown`.
- **No parent-child linking.** Components are modeled separately. Props are narrowed from call sites only when the type is `any`.
- **Class components are skipped.**
