# bippy-analyzer

Finds every state a React app can be in by reading its source, and checks that answer against real renders.

The package has two parts:

- **Symbolic tree** (`src/symbolic-tree`) reads a project with the TypeScript 7 checker. For each component it prints the data the component depends on, its render tree with each branch condition, and its states with the buttons that move between them. It never runs the code. See [docs/symbolic-tree.md](docs/symbolic-tree.md).
- **Branch coverage** (`tests/branch-coverage`) collects V8 coverage from Playwright and Vitest runs, maps it back to source, and ranks the branches no test has reached yet. It was ported from `packages/playwright-coverage` in millionco/alchemist. See [docs/branch-coverage/README.md](docs/branch-coverage/README.md).

## Run

```sh
pnpm --filter bippy-analyzer symbolic-tree fixtures/symbolic-tree/tsconfig.json -c Wizard
pnpm --filter bippy-analyzer coverage .coverage-v8 --json
pnpm --filter bippy-analyzer test
pnpm --filter bippy-analyzer typecheck
```

## How the two parts fit

The symbolic tree makes claims, such as "clicking Next on the details step shows the card input" or "the error alert is never shown." The plan is to turn each claim into a Playwright component test and run the tests with coverage on:

- A failing assertion means a claim was wrong.
- A branch the tests never reach means the analysis missed a state, or couldn't produce a test to reach it.

Both numbers come from real renders in a real browser, with no app server. That makes them a score an agent can improve one failure at a time.
