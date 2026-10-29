# Conformance

Runs the analyzer and the verifier against pinned real-world repos and collects the results. Each run writes one folder per repo, so you can compare runs as the analyzer changes.

## Run

```sh
pnpm --filter realize conformance run                        # every repo
pnpm --filter realize conformance run invoify                # one repo
pnpm --filter realize conformance run -n 4                   # four at a time
pnpm --filter realize conformance run -e vercel -n 16        # Vercel Sandbox, 16 at a time
```

Each repo is set up once under `.conformance/<id>`, or under `BIPPY_CONFORMANCE_CACHE` when that is set: a shallow fetch of the pinned commit, the optional patch, then the install command. Setup runs again only when the commit, install command or patch changes. It runs without the `npm_` and `COREPACK_` variables pnpm sets for scripts, so the app's own package manager sees a clean environment. Set `BIPPY_CONFORMANCE_CACHE` to a folder outside this repository when an app's package manager walks up and finds bippy's root `package.json`, as Yarn 1 does. Each component gets 60 seconds of exploration.

Results go to `conformance/results/<run>/`, where `<run>` is the start time unless `--run-name` sets it:

- `results.json`: every repo's summary, or the error if it failed.
- `<repo>/error.txt`: why the repo failed, if it did.
- `<repo>/analysis.json`: the analyzer output, the same as `analyze --json`.
- `<repo>/verify.json`: the verdict for every component: covered states, counterexamples, and why a component couldn't mount.
- `<repo>/summary.json`: counts of components, states, handlers, unreachable branches, untyped bindings and bailouts, plus the verification totals.

Verification runs by default. Pass `--no-verify` to collect only the analyzer output. The command exits with 1 when a repo failed or any component has a counterexample.

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
- Pin Yarn with `npx --yes yarn@1.22.22`, so the install doesn't depend on the machine's Yarn.
- npm doesn't run `bun`'s install script, so for a Bun lockfile, run the binary its platform package ships, as `repos/next-shadcn-dashboard-starter/repo.json` does.
- Build the workspace packages the app imports, like `npx --yes pnpm@9.5.0 --filter novel build`.

If the repo needs changes before it installs or type-checks, add them as `repos/<id>/custom.patch`. Setup applies the patch after checkout.

## Verify setup and specs

The harness mounts most components on its own (see [How verification works](../../README.md#how-verification-works)). When a repo needs more, like its mock API or a logged-in user, describe it in `repos/<id>/verify/`:

- `setup.tsx` runs in the page before any component loads. It can start the app's mock API, seed data and log in. Its default export, if any, wraps every mounted component, inside the providers the harness adds itself. Imports resolve as they would from the app, so `@/` paths and root paths like `/src/constants/theme` work, and relative imports reach other files in `verify/`. Named functions under `scenarios` seed data for a spec.
- `harness.json` sets `env` variables, readable as `import.meta.env.X` and `process.env.X`, and `alias` modules, such as a stub for `next/font/google`.
- `*.spec.ts` are hand-written Playwright tests. They reach states the automatic exploration can't, like a list with comments in it:

```ts
import { test } from "../../../verifier/spec";

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

`expectState` takes a state's label as `analyze` prints it. When a test ends, everything it saw is scored like an automatic run, so it also fails on any counterexample. Run the specs with `pnpm --filter realize conformance specs`, after a `conformance run` has set the repos up.

## Vercel Sandbox

`-e vercel` runs each repo in its own Vercel Sandbox with 8 vCPUs and 16 GB of memory, so a full corpus run takes about as long as its slowest repo.

- The first run of a repo checks it out, installs it, installs the analyzer dependencies and Chromium, and saves a snapshot. Later runs start from that snapshot. A new snapshot is made when the commit, install command, patch or analyzer dependency versions change. Snapshot ids are kept in `vercel-snapshots.json` under the cache folder.
- Each run uploads the current analyzer, runner, verifier and repo setup source, plus bippy's source, then runs `collect.ts` in the sandbox. The results are gzipped there and written to the same run folder as a local run. The sandbox output goes to `<repo>/sandbox.log`.
- The runner signs in with the OIDC token from `vercel link` and `vercel env pull .env.local` in `packages/realize`. It also accepts `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`, from the environment or from `.env.local`, which is gitignored.

The corpus does not run on GitHub Actions. `conformance report` merges a folder of per-repo results:

```sh
pnpm --filter realize conformance report tests/conformance/results/<run>
```

## Checking a setup

If more than 20% of bindings have unresolved types, the run prints a warning. It usually means dependencies weren't installed where the `tsconfig` looks for them.
