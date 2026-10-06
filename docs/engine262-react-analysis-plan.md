# Build the interpreter first

Start from `main`. Create a fresh `packages/bippy-analyzer`, pin the published engine262 package, and measure its JavaScript conformance before adding symbolic execution or React analysis.

**Status: initial setup implemented.** The package uses engine262's public API and CLI, Vite+/Vitest, and the existing Test262 harness. There are no engine patches or imported interpreter sources. The previous branches and their uncommitted work remain references, not dependencies. See the [package README](../packages/bippy-analyzer/README.md) for commands and the initial scoped results.

## Ordinary JavaScript comes first

Consider this function:

```ts
const getTotal = (price: number) => price + 5;
```

After removing the TypeScript syntax, engine262 should evaluate `getTotal(10)` to `15`. It should also handle the less obvious rules: getters, coercion, closures, exceptions, and Promise jobs.

Before changing those rules, we need to know which ones the imported engine already implements correctly.

## Pin the published engine

Create `packages/bippy-analyzer` as a workspace package. Depend on an exact engine262 release and use its public interfaces. No source import, custom build, or patches are needed for this step.

Use the existing `test262-harness` rather than invent a runner. Keep our own code to suite setup and a public-API smoke test, using TypeScript, pnpm, and Vite+/Vitest.

Do not copy the previous branch's symbolic scaffolding, generator lowering, native-capture compiler, renderer prototypes, or custom interpreter. The old work can explain a problem or supply a regression test; it should not silently become the new foundation. Revisit source ownership only when a concrete requirement needs internal changes.

## Establish a Test262 baseline

Test262 is a suite of tests for the JavaScript specification. Our conformance harness will run a pinned version against the imported engine and preserve the results.

```text
Pinned engine + pinned tests + recorded configuration
                         ↓
                 Conformance report
```

The harness must distinguish:

| Outcome       | Meaning                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| Passed        | The test met its expected behavior, including an expected exception where applicable. |
| Failed        | The observed behavior differed from the test's expectation.                           |
| Unsupported   | The engine or harness does not implement a required feature or test protocol.         |
| Incomplete    | Execution hit a deadline or another resource limit.                                   |
| Harness error | Test setup, loading, or result collection failed.                                     |

Unexpected engine crashes must also be reported distinctly, not confused with an expected JavaScript exception.

Record source revisions, build identity, selected files, execution modes, exclusions, and limits. Respect Test262's strict/sloppy modes, negative-test phases, async completion rules, module loading, and harness includes. A file we did not execute is not a pass.

First verify the harness itself with small passing, failing, expected-error, async, and module cases. Then run reproducible selections and expand toward a full-suite report using stable shards and bounded workers.

We should not assume engine262 passes every test. The previous work found both engine failures and unsupported cases. Establish what this specific import actually supports, explain every nonpass, and keep failures visible rather than adding a passing allowlist or raising deadlines.

**First implementation milestone:** a reproducible dependency installation and a recorded Test262 baseline. A partial run must say it is partial. The existing harness has limitations documented in the package README; its output is not proof of complete conformance. Any later execution changes must be checked against this baseline.

## Then prove concrete React execution

Once the foundation is measured, try a component with no unknown inputs:

```tsx
const App = () => <span>Hello</span>;
```

Transform and bundle the application with actual React and React DOM, then execute their JavaScript inside the engine. Provide DOM APIs through an explicit host adapter, initially backed by Happy DOM.

```text
Application → actual React → actual React DOM → host DOM APIs
             all executed inside engine262       outside
```

Then test a state update and effect cleanup. Compare results with native execution, keeping the host policy explicit. This is one React integration path, not a new implementation of hooks. Happy DOM comparisons do not establish real-browser scheduling behavior.

## What unknown values would add

An ordinary JavaScript engine chooses one branch:

```tsx
const App = ({ enabled }: { enabled: boolean }) => (enabled ? <Dashboard /> : <Login />);
```

Our eventual analysis should retain:

```text
enabled = true  → Dashboard
enabled = false → Login
```

The caller must declare `enabled` as unknown. Its TypeScript annotation does not do that, and omitting the prop supplies `undefined`, not both Booleans.

This requires changes inside the engine. Objects, captured variables, exceptions, and scheduled work must stay associated with their conditions. Executing the whole application repeatedly with concrete assignments is useful for validation, but is not the symbolic implementation.

Before attempting symbolic React, prove a small JavaScript example where an unknown Boolean changes an aliased object. Both results must remain stable, and execution before the branch must not repeat. Then extend that proof to closures, exceptions, and jobs.

The previous checkpoint and ownership work is research to consult, not proof that these requirements are already satisfied.

## What React analysis would add

Symbolic execution retains conditions and values. React-aware analysis connects them to components and renders:

```text
Dashboard exists when enabled is true.
That condition came from App's return expression.
This state update caused this render.
```

We want these observations to participate in the same engine execution. We do not want a second React interpreter beside engine262.

Actual React supplies hook and reconciliation behavior. Our instrumentation supplies component identity, source provenance, conditions, and explanations. A final fiber snapshot alone cannot reconstruct all of them.

Before implementing this part, inventory the previous analyzer's useful behaviors and their tests. Decide where observations belong, how conditional React state and DOM writes are isolated, and how uncertainty is reported. Inspect React's implementation rather than guessing at its internals.

**These later stages are a direction, not an approved detailed design.** We still need to discuss the first symbolic React result and which analysis capabilities it must preserve. Do not import the whole old analyzer to answer those questions by default.

## Working boundaries

- Branch: `engine262-analysis`.
- Base: `origin/main` at `65d7336ee32c363db4ff3e27329c7f7659396f64`.
- Worktree: `/Users/aidenybai/Developer/bippy-engine262-main`.
- Reference implementation: `/Users/aidenybai/Developer/bippy`, on `devin/1788659752-parser-package`. Much of its engine work is uncommitted; a branch checkout alone does not contain it.
- Earlier plan: `/Users/aidenybai/Developer/bippy-engine262-react-analysis/docs/engine262-react-analysis-plan.md`.

Both reference worktrees remain untouched. This branch inherits no PR #115 analyzer or SSA changes.

**Current scope: a pinned dependency, the existing Test262 harness, and a small public-API test. Symbolic and React analysis require further discussion; neither is part of this setup.**
