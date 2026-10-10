# bippy-analyzer

Finds every state a React app can be in by reading its source, then checks that answer against real renders. See [GOAL.md](GOAL.md) for why.

The package has three parts:

- **Analyzer** (`src`) reads a project with the TypeScript 7 checker. It never runs the code. For each component it prints:
  - the data the component depends on
  - its render tree with each branch condition
  - its states, and the buttons that move between them

  See [docs/symbolic-tree.md](docs/symbolic-tree.md).

- **Verifier** (`tests/verify`) checks the analyzer's claims in a real browser. See [How verification works](#how-verification-works).
- **Conformance** (`conformance/`) runs the analyzer and verifier on pinned open-source repos, locally or in Vercel Sandbox, and collects the results. See [conformance/README.md](conformance/README.md).

## Run

```sh
pnpm --filter bippy-analyzer analyze fixtures/symbolic-tree/tsconfig.json -c Wizard
pnpm --filter bippy-analyzer verify fixtures/symbolic-tree/tsconfig.json
pnpm --filter bippy-analyzer conformance run --env vercel -n 8
```

## How verification works

For each exported component:

1. **Instrument.** A Vite dev server serves the app's own code. Every branch condition the analyzer modeled is wrapped in a probe that records which side ran. Every place a mutation warning points at, like `tags` in `tags.push(…)`, is wrapped in a probe that watches writes to that object.
2. **Mount.** Playwright opens a page that loads bippy before React. The page mounts the component inside the providers the app has installed: React Query, React Router and react-hook-form.
3. **Choose props.** Props come from each prop's TypeScript type: every case of a union, `null`, an empty and a one-item array, and so on. Every string or number a prop is compared against in the render is added, so `role === "admin"` gets mounted with `"admin"`. The page tries every combination, or one prop at a time when there are too many.
4. **Explore.** The page clicks every enabled element with a handler and types into every input, breadth-first, a few steps deep. After each step it reads the component's fiber tree, its hook values and the probes that fired. On mount it also keeps the tree from the first commit, before any effect has run.
5. **Score.** Each capture is compared with the analyzer's predicted states:

| Check       | Wrong when                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State       | The rendered tree, at the first commit or after it settles, matches no predicted state. Text the analyzer predicts must match exactly.                                                                                        |
| Transition  | A click led somewhere the analyzer didn't predict, a handler it didn't model changed the screen, or a predicted change didn't happen. An unchanged screen counts only when the handler just calls props or the edge is async. |
| Effect      | The screen changed between the first commit and settling without a predicted effect edge, unless the component reads hook or context data that can arrive later.                                                              |
| Value       | A `useState` or `useReducer` value fell outside the predicted set.                                                                                                                                                            |
| Dead branch | A side the analyzer said can never run was reached.                                                                                                                                                                           |
| Mutation    | A warned mutation's code ran on that state or prop but never wrote to it, or a lost update re-rendered.                                                                                                                       |

A component is counted as **couldn't mount** when it throws before rendering, for example because it needs a parent like `<Menu>` or data from an API. A failed mount means the harness couldn't set the component up, not that the analyzer was wrong, so it's counted separately from wrong claims.

The checks were tested by planting bugs in the analyzer: 14 realistic faults, of which the verifier catches 13. The one it misses flips the async flag on an effect edge, which the first commit can't tell apart from a sync effect.

The numbers to drive are:

- **Wrong:** should reach 0.
- **Witnessed:** predicted states, branch sides and mutation warnings a real render reached. Should reach all of them.
- **Unwarned mutations:** state or props the page saw change in place without a warning. The analyzer only warns about mutations it can prove, so these aren't wrong, but they show what it misses.
- **Couldn't mount:** should go down as the harness learns more providers and fakes.
