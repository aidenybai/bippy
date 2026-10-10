# Symbolic tree

Reads a React project with the TypeScript 7 checker and prints, for each component, its data, render tree and states. It never runs the code.

## Run

```sh
pnpm symbolic-tree fixtures/symbolic-tree/tsconfig.json              # every component
pnpm symbolic-tree fixtures/symbolic-tree/tsconfig.json -c Wizard    # one component
pnpm symbolic-tree fixtures/symbolic-tree/tsconfig.json -H           # component tree
pnpm symbolic-tree path/to/app/tsconfig.json -f features/ --json
```

Run these from `packages/bippy-analyzer`.

The default output is a tree per component with three sections: data (props, state, hook results), render (the JSX tree, with each handler's effect inline as `onClick ⇒ …`), and states (each reachable state, what it shows, and which button leads where). Bailouts are added when there are any. Run `--help` for all options.

| Option                       | Effect                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `-c, --component <names...>` | Show only these components                                           |
| `-f, --file <filter>`        | Show only files whose path contains this text                        |
| `-v, --view <views>`         | Pick sections: `data`, `render`, `states`, `bailouts` (default: all) |
| `-H, --hierarchy`            | Show the parent-to-child component tree with state counts            |
| `-d, --depth <n>`            | Cut the render tree off at this depth                                |
| `-a, --attributes`           | Show every JSX attribute, not only event handlers                    |
| `--json`                     | Print the models as JSON                                             |

Render tree symbols:

- `◆` a branch
- `✓` and `✗` its two sides
- `↻` a list
- `onClick→t2` a handler that fires transition `t2`

In the graph view:

- `─t2─▶` a transition
- `┄t1┄▶` an async transition
- `⟲` transitions that stay in the same state

## What it does

1. Loads the project with `typescript/unstable/sync` (TypeScript 7).
2. Finds components using the React Compiler's rules: a capitalized function that returns JSX or calls a hook, or one wrapped in `memo`/`forwardRef`.
3. Collects slots:
   - props, typed from the parameter
   - `useState`, `useReducer` and `useContext`
   - other hooks, typed from their return type
   - `.map` items
4. Turns each type into its possible values: unions split into cases, `any` becomes `Unknown`. For plain JS, literal values at call sites stand in for prop types.
5. Builds a render tree with `Branch` nodes from early returns, `?:`, `&&`, `||`, `??` and `switch`, and `List` nodes from `.map`.
6. Collects transitions from event handlers and effects:
   - `setX(...)`, `setX(prev => ...)`, and `dispatch(action)` matched to the reducer's `case`
   - calls to local functions are followed
   - code after `await` or inside `.then` makes the new value `Unknown(async)`
7. Lists the states:
   - It splits only on branch conditions, and narrows each value as it goes.
   - A small difference-bound solver handles `<`, `<=` and `===` on numbers and `.length`.
   - State values are limited to the initial value plus every value a transition can set.
8. For each state and transition, finds which states can come next. It also reports branches that can never render.

## Example

`fixtures/symbolic-tree/src/reducer.tsx`, abridged:

```text
Wizard  src/reducer.tsx:21
  slots
    state           reducer   WizardState   starts { step: "details", hasError: false }
    state.step      field     "details" | "done" | "payment"
    state.hasError  field     false | true   reachable false
  transitions
    t1   <button>.onClick     state' = { ...state, step: "details" }
    t2   <button>.onClick     state' = { step: state.step === "details" ? "payment" : "done", hasError: false }
  states (3)
    S1  state.step === "done"                                 <p>Thanks!</p>
    S2  state.step !== "done" ∧ state.step === "details"      t2→S3
    S3  state.step !== "done" ∧ state.step !== "details"      t1→S2  t2→S1
  dead branches: never state.hasError
```

The error alert can never show, because nothing dispatches `fail`.

## Corpus results

| Repo                           | Files | Components | States | Time   | Top bailouts                          |
| ------------------------------ | ----- | ---------- | ------ | ------ | ------------------------------------- |
| fixtures                       | 6     | 13         | 26     | 43 ms  | none                                  |
| bulletproof-react (react-vite) | 127   | 107        | 145    | 257 ms | destructured-local 2, render-call 1   |
| invoify                        | 152   | 165        | 537    | 2.0 s  | destructured-local 36, untyped-hook 9 |
| excalidraw (no deps installed) | 652   | 302        | 2,031  | 1.3 s  | untyped-hook 275, untyped-prop 263    |

## Known gaps

- **Too many states in large components.** Independent sibling branches multiply. `LayerUI` and `VoiceInput` hit the 256 cap. States should be stored as independent parts, one per group of branches that share values, instead of as a full product.
- **Hook result fields are independent.** `query.isPending` and `query.isError` are split separately, even though React Query's union ties them together. The fix is to split on the union type's tag field.
- **Values derived through locals are opaque.** `const { a } = obj` (`destructured-local`) and most calls (`.filter`, `.trim`) aren't modeled.
- **No parent-child linking.** Components are modeled separately. Props are narrowed from call sites only when the type is `any`.
- **Class components are skipped.** That affects excalidraw's `App`.
- **Variable names are resolved by name, not by symbol.** A shadowed name can be mistaken for the outer one.
