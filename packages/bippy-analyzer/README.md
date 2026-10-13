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

For each exported component, the verifier runs five steps.

1. **Instrument.** A Vite dev server serves the app's own code. It adds a probe on every branch the analyzer modeled and every place a mutation warning points at.
2. **Mount.** Playwright opens a page that loads bippy before React, then mounts the component. See [Mounting](#mounting).
3. **Choose props** from each prop's type. See [Props](#props).
4. **Explore.** The page clicks every enabled handler and types into every input, breadth-first, a few steps deep. It waits for requests to settle after each step, then reads the fiber tree, hook values and probes.
5. **Score** each screen against the predicted states. Every state region must match. An action must move the regions it changes to predicted states and leave the rest alone. A child component's handler may change any hook or context value the component reads.

| Check       | Counterexample when                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State       | A screen, at the first commit or once settled, matches no predicted state.                                                                                 |
| Transition  | An action led somewhere unpredicted, or a handler the analyzer didn't model changed the screen. Unchanged counts only for prop calls or async transitions. |
| Effect      | The screen changed after the first commit without a predicted effect, unless it reads hook or context data.                                                |
| Value       | A `useState` or `useReducer` value fell outside the predicted set.                                                                                         |
| Unreachable | A branch side the analyzer called unreachable ran.                                                                                                         |
| Mutation    | A warned mutation never wrote to its state or prop, or a lost update re-rendered.                                                                          |

Each counterexample says what differed, like `expected <p> "Saved", found <p> "Error"`. A component whose states were truncated can't be refuted by a screen it doesn't predict.

A component that **couldn't mount** isn't a counterexample. Its failure is classified, such as `provider`, `env`, `module`, `missing-data`, `server-component`, `too-large` or `unresponsive`, so the next harness fix is clear.

When 14 realistic bugs are planted in the analyzer, the verifier catches 13. The one it misses flips the async flag on an effect transition, which a page can't observe.

## Mounting

The component mounts inside the providers the app installs:

- React Query, react-hook-form, nuqs, next-intl and React Flow.
- A React Router data router or a TanStack Router.
- A signed-in next-auth session.
- The app's own Redux store.

A repo can add its own setup on top, such as a mock API and a logged-in user.

The harness supplies what an app expects from its real environment:

- Node globals and placeholder env variables.
- Stubs for `next/font`, `next/navigation`, `next/router`, `next/document`, `next/headers`, `next/cache`, `next-intl/server`, nuqs's server cache, t3-env and `server-only`, plus Next's router contexts.
- Server actions that do nothing, as a client bundle gets them.
- `require` calls and CommonJS modules in the app's own code, which Next's bundler allows.
- Next's browser polyfills for Node modules like `path`, in a Next app.

Some modules can't run in a browser, so they load as stand-ins that answer any access:

- Server SDKs like Prisma, Stripe and next-auth's server side.
- Modules the app imports but doesn't have, like an undeclared package or a file missing from the repo.
- Requests to other origins.

Stylesheets load empty, since fibers don't depend on them. `next/image` loads images unoptimized, and an SVG imported as a component, like `logo.svg?react`, renders an `<svg>`. Navigations a script starts are cancelled.

An async server component is awaited in the page, along with those it renders, and mounted as what it returned. An app that renders its own router, like its `App`, mounts outside the harness's router.

### Missing parents

A component may throw for want of a parent, like "`DialogTitle` must be used within `Dialog`". The verifier then tries parents in this order, one at a time:

1. The parent the error names. It comes from the project, nearest file first, or from the packages the component's file and its relative imports use.
2. The compound roots its own file exports, like `Dialog` for `DialogTitle`. When the named parent isn't in the component's own file, the outermost root comes first, since it may render that library part itself.
3. The other parts its file exports, like `TabsList` for `TabsTrigger`.
4. The providers of the contexts it reads. The first is one named after a hook the error says came up empty, like `UIAppStateContext` for `useUIAppState(...)`.

A project parent mounts with the props its own analysis samples. A context provider mounts with a sample of the value the component reads.

The new parent goes just outside whichever mounted component threw, read from React's component stack. A parent that doesn't fix the error, or doesn't render the component, gives way to the next. A parent that throws the same error itself is the right one, so it gets a parent of its own. An earlier parent that then throws for want of data is dropped, since an outer parent now provides what it stood in for.

## Props

Each prop takes samples from its type:

- Every union case, `null`, and empty and one-item arrays.
- An element for an element-typed prop, and a resolved promise for a promise.
- Every literal the render compares the prop against.
- A function that returns a sample of its return type.
- For an object with more fields than are sampled, like a TanStack table, a stand-in answers the rest.
- A DOM node, like a portal's container, is left unset.

React, DOM and built-in types are recognized by their declarations, so an alias of `Date` still gets a date.

A component that passes its props on whole, like `templateCtx(props)`, mounts with a sample of its whole props type. One that takes them as a rest spread mounts with the props that type requires.

Untyped props, as in plain JavaScript, take the literals their call sites pass. They are shaped by what the component reads from them, like `booking.guests.fullName`.

A string a component parses has no type to say so, so its name picks a valid sample. A string named like a date, such as `createdAt`, is an ISO date, and one named `currencyCode` is a currency code.
