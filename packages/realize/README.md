# realize

Builds a model of every state a React component can be in by reading its source, checks invariants against it with TLA+, and checks the model against real renders. See [GOAL.md](GOAL.md) for why.

- **Analyzer** (`src/core`, on the React Compiler's own source in `src/react-compiler`) reads a project with the TypeScript 7 checker, without running it. For each component it builds a model of variables, views and actions, then prints Mermaid, JSON or a TLA+ module. It checks invariants with [tla-ts](https://www.npmjs.com/package/tla-ts). See [docs/architecture.md](docs/architecture.md).
- **Viewer** (`viewer`) shows a component's source with the analysis over it. It still reads the old state report and needs porting to the model. See [viewer/README.md](viewer/README.md).
- **Verifier** (`tests/conformance/verifier`) checks in a real browser that the model covers every render and transition.
- **Conformance** (`tests/conformance`) runs both on pinned open-source repos. See [tests/conformance/README.md](tests/conformance/README.md).

`tests/unit` holds the unit tests, and `tests/fixtures` the projects they analyze.

```sh
pnpm --filter realize analyze tests/fixtures/state-charts/tsconfig.json -c Wizard
pnpm --filter realize analyze tests/fixtures/state-charts/tsconfig.json -c Wizard --tla
pnpm --filter realize conformance verify tests/fixtures/state-charts/tsconfig.json
pnpm --filter realize conformance run -n 4
```

## How verification works

The model over-approximates: every render a component can produce should be one of its reachable states. For each exported component, the verifier checks this in five steps.

1. **Instrument.** A Vite dev server serves the app's own code. It adds a coverage counter on every branch the analyzer modeled, every place a mutation warning points at, and every handler passed as a JSX prop, including the callbacks inside an object a component receives, so the page reports which handlers each action ran.
2. **Mount.** Playwright opens a page that loads bippy before React, then mounts the component. See [Mounting](#mounting).
3. **Choose props** from each prop's type. See [Props](#props).
4. **Explore.** The page clicks every enabled handler, submits every form that has an `onSubmit` or an `action` function, clicks every button with a `formAction`, types into every input, presses Enter and Escape on elements with `onKeyDown`, focuses and blurs elements with `onFocus` or `onBlur`, and hovers in and out of elements with enter or leave handlers, breadth-first, a few steps deep. A submit goes through `requestSubmit`, so React runs the form's action and the harness only cancels the navigation afterwards. It waits for requests and React's pending updates to settle after each step, then reads the fiber tree, hook values and counters.
5. **Check coverage.** Each capture becomes a condition on the model: the edge each branch took, and the abstract value each `useState` or `useReducer` value falls in. A branch whose counter hit both edges during one action is left out, since it rendered more than once.

| Check       | Counterexample when                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Render      | No reachable model state agrees with the branch edges and state values the page showed.             |
| Transition  | No path of at most three model actions leads from the state before an action to the state after it. |
| Domain      | A `useState` or `useReducer` value falls outside the domain of its variable.                        |
| Unreachable | A branch edge the model calls unreachable ran.                                                      |
| Mutation    | A warned mutation never wrote to its state or prop, or a lost update re-rendered.                   |

A transition path may use each handler the action ran once, plus effects, async results and changes to inputs other than props. When none of the handlers that ran has a model action, the path may take no step, since the model says those handlers change no variable. A truncated model is not checked for renders or transitions.

A component that **couldn't mount** isn't a counterexample. Its failure is classified, such as `provider`, `env`, `module`, `missing-data`, `server-component`, `too-large` or `unresponsive`, so the next harness fix is clear.

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

Stylesheets load empty, since fibers don't depend on them. `next/image` loads images unoptimized, and an SVG imported as a component, like `logo.svg?react`, renders an `<svg>`. Navigations a script starts are cancelled. Vite looks for `new URL(..., import.meta.url)` in every module with a pattern that overflows V8 on a dependency chunk of a few megabytes, like monaco-editor's, so the harness runs that search only on modules that mention `import.meta.url`.

An async server component is awaited in the page, along with those it renders, and mounted as what it returned. An app that renders its own router, like its `App`, mounts outside the harness's router.

A component in an import cycle loads the way the app loads it, after the files in that cycle that import it. A route table that renders `RootLayout` then finds it initialized, whichever component the page loaded before.

### Missing parents

A component may throw for want of a parent, like "`DialogTitle` must be used within `Dialog`". The verifier then tries parents in this order, one at a time:

1. The parent the error names. It comes from the project, nearest file first, or from the packages the component's file and its relative imports use.
2. The compound roots its own file exports, like `Dialog` for `DialogTitle`. When the named parent isn't in the component's own file, the outermost root comes first, since it may render that library part itself.
3. The other parts its file exports, like `TabsList` for `TabsTrigger`.
4. The providers of the contexts it reads. The first is one named after a hook the error says came up empty, like `UIAppStateContext` for `useUIAppState(...)`.

A project parent mounts with the props its own analysis samples. A context provider mounts with a sample of the value the component reads.

The new parent goes just outside whichever mounted component threw, read from React's component stack. A parent that doesn't fix the error, or doesn't render the component, gives way to the next. A parent that throws the same error itself is the right one, so it gets a parent of its own. A parent that throws a different error naming a parent the stack lacks, like a toast root needing its provider, gets that parent outside it. An earlier parent that then throws for want of data is dropped, since an outer parent now provides what it stood in for.

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

Up to 12 combinations of these samples are mounted. A state that needs several props at once, or a field of an object prop, may go unseen. That shows as a view the run didn't cover, not as a counterexample.
