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

| Option                       | Effect                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `-c, --component <names...>` | Show only these components                                           |
| `-f, --file <filter>`        | Show only files whose path contains this text                        |
| `-v, --view <views>`         | Pick sections: `data`, `render`, `states`, `bailouts` (default: all) |
| `-H, --hierarchy`            | Show the parent-to-child component tree with state counts            |
| `-d, --depth <n>`            | Cut the render tree off at this depth                                |
| `-a, --attributes`           | Show every JSX attribute, not only event handlers                    |
| `--json`                     | Print the analyses as JSON                                           |

Render tree symbols:

- `◆` a branch
- `✓` and `✗` its two sides
- `↻` a list
- `onClick ⇒ count = count + 1` a handler and what it does to state
- `"Next" → S3` in a state, the button that leads to another state

## What it does

The pipeline is a port of the React Compiler's front end, followed by our own passes. The code lives in `src/core`:

| Folder           | Contents                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `hir`            | The compiler's HIR: blocks, instructions, terminals and places, lowered from the TS 7 AST |
| `ssa`            | `enterSSA` and `eliminateRedundantPhi`                                                    |
| `optimization`   | Constant propagation and dead code elimination                                            |
| `type-inference` | `inferTypes`, with the compiler's hook table                                              |
| `entrypoint`     | Finding components, running the passes, and analyzing a project                           |
| `inference`      | Our passes: symbolic evaluation, transitions, value domains and state enumeration         |

Each ported file names the compiler source it came from.

1. Loads the project with `typescript/unstable/sync` (TypeScript 7).
2. Finds components using the React Compiler's rules: a capitalized function that returns JSX or calls a hook, or one wrapped in `memo` or `forwardRef`.
3. Lowers each component to HIR and runs the compiler passes on it. A function the compiler can't lower becomes a `compiler-error` bailout.
4. Evaluates the HIR symbolically. Each value becomes an expression over bindings:
   - props, typed from the parameter
   - `useState`, `useReducer` and `useContext`
   - other hooks, typed from their return type
   - `.map` items
5. Where control flow merges, the value becomes a `Conditional` that records which terminal decided it. Early returns, `?:`, `&&`, `||`, `??` and `switch` all produce one.
6. Turns each binding's type into its possible values. Unions split into cases, and `any` becomes `Unknown`. For plain JS, literal values at call sites stand in for prop types.
7. Collects transitions from event handlers and effects:
   - `setX(...)`, `setX(prev => ...)`, and `dispatch(action)` evaluated through the reducer
   - calls to local and module functions are followed
   - code after `await` or inside `.then` makes the new value `Unknown(async)`
8. Lists the states:
   - It splits only on decisions in the render output, and narrows each value as it goes.
   - A difference-bound solver handles `<`, `<=` and `===` on numbers and `.length`.
   - State values are limited to the initial value plus every value a transition can set.
9. For each state and transition, finds which states can come next. It also reports branches that can never render.

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
| fixtures                       | 6     | 13         | 26     | 59 ms  | none           |
| bulletproof-react (react-vite) | 127   | 107        | 192    | 695 ms | unknown-call 2 |

## Known gaps

- **Too many states in large components.** Independent sibling branches multiply, up to a cap of 256. States should be stored as independent parts, one per group of branches that share values.
- **Hook result fields are independent.** `query.isPending` and `query.isError` are split separately, even though React Query's union ties them together. The fix is to split on the union type's tag field.
- **Most calls are opaque.** `.filter` and `.trim` results become `Unknown(call)`.
- **Loops bail out.** A `for` or `while` in render makes the values it changes `Unknown`.
- **No parent-child linking.** Components are modeled separately. Props are narrowed from call sites only when the type is `any`.
- **Class components are skipped.**
