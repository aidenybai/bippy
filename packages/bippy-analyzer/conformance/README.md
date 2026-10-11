# Conformance

Runs the analyzer and the verifier against pinned real-world repos and collects the results. Each run writes one folder per repo, so you can compare runs as the analyzer changes.

## Run

```sh
pnpm --filter bippy-analyzer conformance run                        # every repo, on this machine
pnpm --filter bippy-analyzer conformance run invoify                # one repo
pnpm --filter bippy-analyzer conformance run --env vercel -n 8      # Vercel Sandbox, 8 at a time
```

Results go to `conformance/results/<run>/`:

- `results.json`: every repo's summary, or the error if it failed.
- `<repo>/analysis.json`: the analyzer output, the same as `analyze --json`.
- `<repo>/verify.json`: the verdict for every component: covered states, counterexamples, and why a component couldn't mount.
- `<repo>/summary.json`: counts of components, states, handlers, unreachable branches, untyped bindings and bailouts, plus the verification totals.

Verification runs by default. Pass `--no-verify` to collect only the analyzer output.

## Add a repo

Create `repos/<id>/repo.json`:

```json
{
  "repository": "https://github.com/al1abb/invoify",
  "revision": "3859b3cbae28ca4ec559db5ef87e41b798740340",
  "workingDirectory": ".",
  "tsconfig": "tsconfig.json",
  "install": "npm ci --ignore-scripts --no-audit --no-fund"
}
```

- Pin `revision` to a full commit SHA.
- `install` runs from the repo root. If the app lives in a subfolder, `cd` into it first.
- Use the repo's own lockfile and `--ignore-scripts`.
- The sandbox image has `npm` but not `yarn`, so pin Yarn with `npx --yes yarn@1.22.22`.

If the repo needs changes before it installs or type-checks, add them as `repos/<id>/custom.patch`. `setup.sh` applies the patch after checkout.

## Verify setup and specs

The harness mounts most components on its own (see [How verification works](../README.md#how-verification-works)). When a repo needs more, like its mock API or a logged-in user, describe it in `repos/<id>/verify/`:

- `setup.tsx` runs in the page before any component loads. It can start the app's mock API, seed data and log in. Its default export, if any, wraps every mounted component, inside the providers the harness adds itself. Imports resolve as they would from the app, so `@/` paths work. Named functions under `scenarios` seed data for a spec.
- `harness.json` sets `env` variables, readable as `import.meta.env.X` and `process.env.X`, and `alias` modules, such as a stub for `next/font/google`.
- `*.spec.ts` are hand-written Playwright tests. They reach states the automatic exploration can't, like a list with comments in it:

```ts
import { test } from "../../../verifier/spec.js";

test.use({ repo: "bulletproof-react" });

test("pages through comments", async ({ mountComponent }) => {
  const comments = await mountComponent("CommentsList", {
    props: { discussionId: "first" },
    scenario: ["discussion", "first", 12],
  });
  comments.expectState("!commentsQuery.isLoading ∧ … ∧ commentsQuery.hasNextPage ∧ …");
  await comments.click("Load More Comments");
});
```

`expectState` takes a state's label as `analyze` prints it. When a test ends, everything it saw is scored like an automatic run, so it also fails on any counterexample. Run the specs with `pnpm --filter bippy-analyzer conformance specs`, after a `conformance run` has set the repos up.

## Environments

Both environments run the same `setup.sh`: a shallow fetch of the pinned commit, the optional patch, then the install command.

- **`local`** sets up each repo once under `.conformance/<id>` and reruns setup only when the commit, install command or patch changes.
- **`vercel`** runs setup once in a Vercel Sandbox, installs the analyzer's dependencies and Chromium, and saves it as a snapshot. Later runs start from the snapshot, upload the current analyzer source and run it. A new snapshot is made when the setup inputs or the analyzer's dependencies change. Snapshot IDs are stored in `.conformance/vercel-snapshots.json`.

The Vercel environment reads `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` from the environment or from `packages/bippy-analyzer/.env.local`, which is gitignored.

## Checking a setup

If more than 20% of bindings have unresolved types, the run prints a warning. It usually means dependencies weren't installed where the `tsconfig` looks for them.
