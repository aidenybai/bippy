# bippy-analyzer

Finds every state a React app can be in by reading its source, then checks that answer against real renders. See [GOAL.md](GOAL.md) for why.

- **Analyzer** (`src/core`, on the React Compiler's own source in `src/react-compiler`) reads a project with the TypeScript 7 checker, without running it. For each component it prints the data it depends on, its render tree, and its states with the actions between them. See [docs/symbolic-tree.md](docs/symbolic-tree.md).
- **Verifier** (`conformance/verifier`) checks those claims in a real browser.
- **Conformance** (`conformance/`) runs both on pinned open-source repos. See [conformance/README.md](conformance/README.md).

```sh
pnpm --filter bippy-analyzer analyze tests/fixtures/symbolic-tree/tsconfig.json -c Wizard
pnpm --filter bippy-analyzer conformance verify tests/fixtures/symbolic-tree/tsconfig.json
pnpm --filter bippy-analyzer conformance run --env vercel -n 8
```

## How verification works

For each exported component:

1. **Instrument.** A Vite dev server serves the app's own code, with a probe on every branch the analyzer modeled and every place a mutation warning points at.
2. **Mount.** Playwright opens a page that loads bippy before React and mounts the component inside the providers the app installs (React Query, a React Router data router, react-hook-form, nuqs, a signed-in next-auth session). The harness supplies what apps expect from their real environment: Node globals, placeholder env variables, stubs for `next/font`, `next/navigation`, `next/router`, `next/document` and `server-only` along with Next's router contexts, and server actions that do nothing, as a client bundle gets them. It also accepts what Next's bundler allows and Vite doesn't: `require` calls and CommonJS modules in the app's own code. Stylesheets load empty, since fibers don't depend on them. Every dependency is pre-bundled before the first mount, a `require` of a package that isn't installed throws only where it runs, and navigations a script starts are cancelled. When a component throws for want of a parent, like "`DialogTitle` must be used within `Dialog`", it is mounted again inside that parent. The parent comes from the project (nearest file first), the packages and namespaces of parts the component imports, or its own file's compound root and other parts. It goes just outside whichever mounted component threw, read from React's component stack. A repo can add its own setup on top, such as its mock API and a logged-in user. Components are verified on several pages at once.
3. **Choose props** from each prop's type: every union case, `null`, empty and one-item arrays, an element for an element-typed prop, and every literal the render compares a prop against. Untyped props also take the literals their call sites pass, and a component that passes its props on whole, like `templateCtx(props)`, mounts with a sample of its whole props type.
4. **Explore.** Click every enabled handler and type into every input, breadth-first, a few steps deep, waiting for requests to settle after each step. Read the fiber tree, hook values and probes after each one.
5. **Score** each screen against the predicted states. Every state region must match, and an action must move the regions it changes to predicted states and leave the rest alone. A child component's handler may change any hook or context value the component reads.

| Check       | Counterexample when                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State       | A screen, at the first commit or once settled, matches no predicted state.                                                                                 |
| Transition  | An action led somewhere unpredicted, or a handler the analyzer didn't model changed the screen. Unchanged counts only for prop calls or async transitions. |
| Effect      | The screen changed after the first commit without a predicted effect, unless it reads hook or context data.                                                |
| Value       | A `useState` or `useReducer` value fell outside the predicted set.                                                                                         |
| Unreachable | A branch side the analyzer called unreachable ran.                                                                                                         |
| Mutation    | A warned mutation never wrote to its state or prop, or a lost update re-rendered.                                                                          |

Each counterexample says what differed, like `expected <p> "Saved", found <p> "Error"`. A component whose states were truncated can't be refuted by a screen it doesn't predict. A component that **couldn't mount** isn't a counterexample; its failure is classified (`provider`, `env`, `module`, `missing-data`, `server-component`, `too-large`, `unresponsive` and so on) so the next harness fix is obvious.

Planting 14 realistic bugs in the analyzer, the verifier catches 13. The one it misses flips the async flag on an effect transition, which a page can't observe.
