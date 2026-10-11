# bippy-analyzer

Finds every state a React app can be in by reading its source, then checks that answer against real renders. See [GOAL.md](GOAL.md) for why.

- **Analyzer** (`src/compiler`, `src/typescript`, `src/analysis`) reads a project with the TypeScript 7 checker, without running it. For each component it prints the data it depends on, its render tree, and its states with the actions between them. See [docs/symbolic-tree.md](docs/symbolic-tree.md).
- **Verifier** (`conformance/verifier`) checks those claims in a real browser.
- **Conformance** (`conformance/`) runs both on pinned open-source repos. See [conformance/README.md](conformance/README.md).

```sh
pnpm --filter bippy-analyzer analyze test/fixtures/symbolic-tree/tsconfig.json -c Wizard
pnpm --filter bippy-analyzer verify test/fixtures/symbolic-tree/tsconfig.json
pnpm --filter bippy-analyzer conformance run --env vercel -n 8
```

## How verification works

For each exported component:

1. **Instrument.** A Vite dev server serves the app's own code, with a probe on every branch the analyzer modeled and every place a mutation warning points at.
2. **Mount.** Playwright opens a page that loads bippy before React and mounts the component inside the providers the app installs (React Query, React Router, react-hook-form). The harness supplies what apps expect from their real environment: Node globals, placeholder env variables, and stubs for `next/font` and `next/navigation`. When a component throws for want of a parent, like "`DialogTitle` must be used within `Dialog`", it is mounted again inside that parent, found by name in the project or the packages the component imports. A repo can add its own setup on top, such as its mock API and a logged-in user.
3. **Choose props** from each prop's type: every union case, `null`, empty and one-item arrays, and every literal the render compares a prop against.
4. **Explore.** Click every enabled handler and type into every input, breadth-first, a few steps deep, waiting for requests to settle after each step. Read the fiber tree, hook values and probes after each one.
5. **Score** each screen against the predicted states. Every state group must match, and an action must move the groups it changes to predicted states and leave the rest alone. A child component's handler may change any hook or context value the component reads.

| Check       | Wrong when                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| State       | A screen, at the first commit or once settled, matches no predicted state.                                                                           |
| Transition  | An action led somewhere unpredicted, or a handler the analyzer didn't model changed the screen. Unchanged counts only for prop calls or async edges. |
| Effect      | The screen changed after the first commit without a predicted effect, unless it reads hook or context data.                                          |
| Value       | A `useState` or `useReducer` value fell outside the predicted set.                                                                                   |
| Dead branch | A branch side the analyzer called unreachable ran.                                                                                                   |
| Mutation    | A warned mutation never wrote to its state or prop, or a lost update re-rendered.                                                                    |

Each wrong claim says what differed, like `expected <p> "Saved", found <p> "Error"`. A component that **couldn't mount** isn't counted as wrong; its failure is classified (`provider`, `env`, `module`, `missing-data`, `server-component` and so on) so the next harness fix is obvious.

Planting 14 realistic bugs in the analyzer, the verifier catches 13. The one it misses flips the async flag on an effect edge, which a page can't observe.
