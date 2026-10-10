# Conformance

Runs the analyzer against pinned real-world repos and collects the results. Each run writes one folder per repo, so you can compare runs as the analyzer changes.

## Run

```sh
pnpm --filter bippy-analyzer conformance run                        # every repo, on this machine
pnpm --filter bippy-analyzer conformance run invoify                # one repo
pnpm --filter bippy-analyzer conformance run --env vercel -n 8      # Vercel Sandbox, 8 at a time
```

Results go to `conformance/results/<run>/`:

- `results.json`: every repo's summary, or the error if it failed.
- `<repo>/model.json`: the analyzer output, the same as `symbolic-tree --json`.
- `<repo>/summary.json`: counts of components, states, transitions, dead branches, untyped slots and bailouts.

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

## Environments

Both environments run the same `setup.sh`: a shallow fetch of the pinned commit, the optional patch, then the install command.

- **`local`** sets up each repo once under `.conformance/<id>` and reruns setup only when the commit, install command or patch changes.
- **`vercel`** runs setup once in a Vercel Sandbox and saves it as a snapshot. Later runs start from the snapshot, upload the current analyzer source and run it. A new snapshot is made when the setup inputs or the analyzer's dependencies change. Snapshot IDs are stored in `.conformance/vercel-snapshots.json`.

The Vercel environment reads `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` from the environment or from `packages/bippy-analyzer/.env.local`, which is gitignored.

## Checking a setup

If more than 20% of slots have unresolved types, the run prints a warning. It usually means dependencies weren't installed where the `tsconfig` looks for them.
