# Coverage

Turn a test run into a reward signal for writing high-quality tests. This tool scores how thoroughly your tests exercise the code, then hands back a ranked worklist of the next tests to write. An agent optimizes against it: write the top item, re-run, watch the score rise, and repeat until the worklist is empty and the suite is a faithful cast of the app's behavior.

Flat line coverage can't be that reward. It goes green while whole regions of behavior stay untested, so an agent that optimizes it stops early and ships a suite full of holes. This tool rewards depth and rigor instead: it counts the branches taken, the guard-nesting reached, the input boundaries, and the decision combinations a thorough test must cover, and it counts a branch as done only when a test would catch a bug there.

## Use it as a reward signal

The loop is: run the analysis, write the top worklist item, re-run, repeat. Each item is one concrete test to write, highest value first, so an agent never has to guess what to do next.

Run against your saved V8 dumps and read the JSON:

```bash
pnpm coverage .coverage-v8 --filter packages/your_package/src/ --json > coverage.json
```

```jsonc
{
  "lines": { "pct": 92.9, "covered": 25670, "total": 27628 },
  "branches": { "pct": 73.6, "covered": 4969, "total": 6754 },
  "worklist": [
    {
      "id": "branch:src/core.ts:88:true",
      "file": "src/core.ts",
      "line": 88,
      "priority": 44,
      "action": "drive `count > 100` to true",
    },
  ],
}
```

Each item is self-contained: `action` is the instruction, `file` and `line` are where, `priority` is the reward weight (higher first), and `id` is stable across runs. Write the test for `worklist[0]`, then work down.

After each test, re-run with the previous result as the baseline. The delta is your progress signal:

```bash
pnpm coverage .coverage-v8 --json > next.json
pnpm coverage .coverage-v8 --baseline coverage.json
# Progress since baseline: closed 3 · opened 0 · 41 carried
```

Keep going until the worklist is empty. Then run [mutation testing](#mutation-testing): it flips operators in your covered code and checks your tests catch the change, so it rewards real assertions over tests that merely run the line.

## The signals you maximize

Every signal is on by default and feeds the worklist. Pushing each one up is what makes the suite thorough:

- **Branch coverage**: every decision taken both ways, not only every line run once
- **Control-flow depth**: how deep into nested guards the tests reach, weighted so a deeply nested branch is worth more than a top-level one
- **Interaction coverage**: independent decisions exercised in combination, not one at a time
- **Edge cases**: the boundary and null/undefined inputs each condition implies (a `count > 10` asks for a test at `count = 10`)
- **Mutation manifest**: the operator flips (`>` to `>=`, `===` to `!==`, `&&` to `||`) a real test should catch, the bar for assertion quality

## Install

The module lives in `bippy-analyzer/src/branch-coverage`. It was ported from `packages/playwright-coverage` in millionco/alchemist (commit `6489a8ec`). Run its CLI with `pnpm --filter bippy-analyzer coverage`.

Optional peers: `@playwright/test` (>=1.40) for browser capture and Vitest for the Vitest setup helper. Playwright V8 precise coverage exists only on Chromium, so capture self-guards and no-ops on other browsers.

## Getting started

Coverage runs in three pieces: a per-test capture helper, a one-time cleanup before the suite, and a report after it. Capture writes one raw V8 dump per test to a directory you choose. The report merges those dumps (from one or many dirs) and prints the table.

### 1a. Capture with Playwright

Compose `capturePlaywrightCoverage` into an auto fixture. It starts JS coverage, runs the test body, then flushes the dump in a `finally` so a failing test still records what it exercised:

```typescript
import { test as base } from "@playwright/test";
import { capturePlaywrightCoverage } from "bippy-analyzer/src/branch-coverage/index.ts";

const RAW_DIR = ".coverage-v8";
const coverageEnabled = Boolean(process.env.COVERAGE);

export const test = base.extend<{ coverageCapture: void }>({
  coverageCapture: [
    async ({ page }, use) => {
      if (!coverageEnabled) {
        await use();
        return;
      }
      await capturePlaywrightCoverage(page, RAW_DIR, use);
    },
    { auto: true },
  ],
});
```

Gate the whole thing on a `COVERAGE` flag so normal runs never load the coverage code or pay its cost.

### 1b. Capture with Vitest

Add a Vitest setup file that calls `setupVitestCoverage`. It starts Node V8 precise coverage in the worker, flushes one dump after each test, and tears down when the file finishes:

```typescript
// vitest.setup.ts
import { setupVitestCoverage } from "bippy-analyzer/src/branch-coverage/vitest-fixture.ts";

if (process.env.COVERAGE) {
  setupVitestCoverage(".coverage-v8");
}
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Do not enable Vitest's built-in `@vitest/coverage-v8` for this path — this helper writes the same raw dumps the reporter already understands.

### 2. Clear stale dumps before the run

Wipe the raw directory once so the merged report reflects only this run:

```typescript
import { cleanRawCoverage } from "bippy-analyzer/src/branch-coverage/index.ts";

export default async function globalSetup() {
  cleanRawCoverage(".coverage-v8");
}
```

### 3. Report after the run

Merge the dumps and generate the report. Pass one dir or several (Playwright + Vitest). The call returns a structured summary you can log or assert on, and writes HTML and lcov reports to `outputDir`:

```typescript
import { generateCoverageReport } from "bippy-analyzer/src/branch-coverage/index.ts";

export default async function globalTeardown() {
  const summary = await generateCoverageReport({
    rawDir: [".coverage-pw", ".coverage-vitest"],
    outputDir: "coverage-report",
    baseDir: process.cwd(),
    name: "my app coverage",
  });
  if (!summary) return;
  const { covered, total, pct } = summary.lines;
  console.log(`lines: ${pct}% (${covered}/${total})`);
}
```

Keep dump dirs outside `outputDir`. The report step cleans `outputDir`, and you don't want it wiping the dumps mid-run.

### Build requirement: source maps on, minification off

Remapping V8 byte ranges back to `src` needs the served bundle to ship a sibling `.map` and stay unminified. Configure your coverage build accordingly. In react-grab this is a dedicated script:

```jsonc
// package.json
{
  "scripts": {
    "build:coverage": "REACT_GRAB_NO_MINIFY=true REACT_GRAB_SOURCEMAP=true vp pack",
  },
}
```

A minified bundle with no `.map` sibling yields empty or misleading coverage, so never let a coverage run reuse a server that might be serving a production build.

## How to run it

There are two ways to run, depending on whether you want it inside the suite or as a standalone pass over saved dumps.

### In the suite (continuous)

Wire capture + cleanup + report from [Getting started](#getting-started), then run with your coverage flag set and a sourcemapped, unminified build:

```bash
COVERAGE=1 playwright test
COVERAGE=1 vitest run
```

The teardown prints the report (or logs the summary) once, after the whole suite. This is the mode CI uses.

### Standalone (fast iteration)

This is the fastest loop and the one an agent uses. Run the suite once with capture on, then point the CLI at the saved dump directory (or directories) and re-analyze as often as you like, with no re-run:

```bash
# scope a monorepo package, show the 15 files with the most uncovered lines
pnpm coverage .coverage-v8 --filter packages/ui/src/ --top

# merge Playwright + Vitest dumps into one report
pnpm coverage .coverage-pw .coverage-vitest --json > coverage.json

# standard istanbul text table + lcov + an HTML report
pnpm coverage .coverage-v8 --out ./coverage-report --reports text,lcovonly,html
```

The first run prints, top to bottom: the per-file table (with the high-fidelity **Signals** column), the ranked **Next tests to write** queue, then the detailed depth, branch-gap, edge-case, interaction, and mutation sections.

### Options

- `--filter <substr>`: keep only entries whose served URL contains the substring. This is the reliable way to scope a monorepo to one package, because served URLs carry the full path while remapped source paths are often bare basenames
- `--top [n]`: show only the `n` files with the most uncovered lines (default 15) instead of the full path-sorted table
- `--out <dir>`: persist reports here. The default writes a temporary directory with the v8 report only
- `--reports <list>`: comma-separated report formats, passed to the report engine, which wraps istanbul's reporters. Use `text` and `text-summary` for the classic istanbul console tables, `lcovonly` for `lcov.info`, `html` for the istanbul HTML report, plus the engine's own `v8` and `console-details`
- `--name <name>`: report name shown in the HTML report
- `--json`: print the machine-readable `CoverageSummary` (including `worklist`) instead of the table
- `--no-depth`: skip control-flow depth analysis (on by default)
- `--no-interactions`: skip combinatorial interaction analysis (on by default)
- `--no-prune-infeasible`: keep interaction combinations even when proven impossible. Pruning (on by default) drops combinations where two decisions over the same value contradict, like `s === 1` with `s === 2`; it builds SSA per script, and disabling it only ever keeps extra sound targets
- `--no-mutations`: hide the mutation-manifest section from the table. The manifest is on by default and always present in `--json`
- `--mutation-plan <file>`: write a mutation-testing plan to `<file>` (see [Mutation testing](#mutation-testing))
- `--baseline <file>`: diff the worklist against a prior `--json` output and print closed / opened / carried (see [The agent loop](#the-agent-loop))
- `--stryker-report <file>`: match a Stryker JSON report's survivors back to the manifest and print the proven assertion gaps
- `--debug`: verbose logging plus a dump of every merged script URL

## Reading the report

The report leads with two views and then breaks them down. First, a per-file table: istanbul-style line/branch/function coverage plus a **Signals** column that rolls up the high-fidelity findings for each file as `d{maxDepth} {n}b {n}e {n}m` (deepest guard reached, then counts of branch gaps, edge cases, and mutants). Second, the **Next tests to write** queue: every signal merged into one priority-ranked list of concrete actions, deepest and highest-value first. Then the detailed sections below carry the same items grouped by signal.

### Next tests to write

```text
Next tests to write  (ranked across all signals)
 #  Location          Kind    Do this
 1  src/core.ts:312   depth   add a spec that reaches this depth-4 block
 2  src/core.ts:88    mutant  add an assertion that fails when `>` becomes `>=`
 3  src/core.ts:88    branch  drive `count > 100` to true
```

This is the agent-facing view: read the top row, write that test, re-run, repeat. Each item carries a stable `id` in `--json`, so a caller can diff two runs to see what a new test closed or opened. The detailed sections that follow explain each kind.

### Control-flow depth

```text
Control-flow depth  (depth-weighted branch coverage: 64%)
Script        Weighted%  Branch%  Depth  Deep blocks  Deepest gap
core.js       58         71       2/4    12/20        src/core.ts:312 (depth 4)
```

`Depth` reads as `depthReached/maxDepth`: tests got two guard-levels deep into a structure that nests four. `Deep blocks` counts executed blocks at guard-depth one or more. `Weighted%` is branch coverage with each arm weighted `1 + guardDepth`, so `Weighted% < Branch%` means the arms you're missing are the deeply nested ones. `Deepest gap` is the deepest unreached block, your "add a spec that gets here" target.

### Half-covered branches

```text
Half-covered branches  (reached, but one arm never taken)
Location          Condition              Never =
src/core.ts:88    user.role === "admin"  true
```

Each row is a decision that executed but only ever went one way. The fix reads directly off the row: drive `condition` so the `Never =` arm is taken. The list is ranked deepest-first, because a deeply guarded untaken arm is the harder gap to hit by accident.

### Edge cases

```text
Edge cases  (boundary + null/undefined inputs the conditions imply)
Location          Condition                  Try
src/core.ts:2726  items.length > 1           vary `items.length` around the boundary 1 (>)
src/core.ts:2098  next ?? fallback           drive `next` to null/undefined
```

Each row is an input a reached decision's condition implies you should test. A `>` comparison names its boundary value; an optional chain or `??` names the null/undefined case. These are suggestions read off the condition's structure, not measured from a hit count, so treat them as a checklist of values to confirm rather than a coverage percentage.

### Mutation manifest

```text
Mutation manifest  (operator mutants a faithful test should kill)
Location          Condition           Mutate      Covered
src/core.ts:88    count > 100         > → >=      ~one
src/core.ts:91    role === "admin"    === → !==   both
```

Each row is an operator mutant a faithful test should fail against. `Mutate` shows the flip (`>` to `>=`); `Covered` is `both` when the decision was exercised both ways (so a surviving mutant means a missing assertion) or `~one` when an arm is still untaken (cover it first). It's a targeted, coverage-filtered plan a mutation tester such as Stryker can consume instead of mutating the whole file. The manifest is in `--json` on every run; pass `--no-mutations` to drop the table section.

### Interaction coverage

```text
Interaction coverage  (independent decision combos: 75% — 6/8)
Script    Untested combination                                  Depth
core.js   src/core.ts:40 isOpen =true × src/core.ts:88 admin =false   2
```

Each target is two independent decisions, each already tested both ways, whose given outcome-combination no single test reached. The row reads as a test to write: drive the left arm while driving the right arm.

## Mutation testing

Coverage proves a branch ran; it never proves a test would catch a bug there. The mutation manifest names the operator mutants a faithful suite should kill, and `--mutation-plan <file>` exports them as a plan a mutation tester can run:

```bash
pnpm coverage .coverage-v8 --mutation-plan mutation-plan.json
```

The plan is scoped to the reached, depth-ranked decisions, so a tool like [Stryker](https://stryker-mutator.io/) mutates only the lines that matter instead of the whole file (the difference between feasible and not on a browser suite):

```jsonc
{
  "mutate": ["packages/ui/src/core.ts:88", "packages/ui/src/core.ts:91"],
  "mutators": ["EqualityOperator", "LogicalOperator"],
  "targets": [/* the ranked manifest the run is expected to kill */],
}
```

Feed `mutate` into Stryker's `mutationRange` and enable `mutators`. A mutant that survives a `both`-covered target is a proven assertion gap: the branch runs, but nothing notices the operator flip. Paths are relative to `baseDir`, so set `baseDir` to your Stryker project root.

When a Stryker run finishes, feed its report back in to turn predicted gaps into proven ones:

```bash
pnpm coverage .coverage-v8 --stryker-report reports/mutation/mutation.json
```

The survivors are matched to the manifest and printed as **Proven assertion gaps**, the sharpest "add an assertion here" targets.

### Runtime mutation (experimental)

Source-mutation tools rebuild the bundle per mutant, which is impractical for a browser suite. `instrumentForMutation` applies the same substrate at runtime instead: it wraps each tracked decision's test in a gate, so one instrumented build can run every mutant by toggling a global.

```ts
import { instrumentForMutation, MUTATION_GATE } from "bippy-analyzer/src/branch-coverage/index.ts";

const { code, mutants } = instrumentForMutation("app.ts", source);
// `if (n > 0)` becomes `if (__mutCond(0, (n > 0)))`; prepend MUTATION_GATE to the bundle.
```

The gate is a no-op until a mutant is selected. In a Playwright fixture, set it per worker and run the specs that cover the decision:

```ts
await page.addInitScript("globalThis.__MUTANT = 'f0'"); // force decision 0 false
```

If the covering specs still pass, that mutant survived: the decision ran, but no assertion noticed the forced outcome. This is the verification axis without the rebuild cost. It's a spike today (statement `if`/`while`/`do-while` tests, force-true/false); see [TODOS.md](./TODOS.md).

## Programmatic API

The package exports the capture primitive, the report generator, the formatters, and the depth analyzer:

```typescript
import {
  capturePlaywrightCoverage,
  captureNodeCoverage,
  cleanRawCoverage,
  generateCoverageReport,
  formatCoverageTable,
  analyzeScriptDepth,
} from "bippy-analyzer/src/branch-coverage/index.ts";
import { setupVitestCoverage } from "bippy-analyzer/src/branch-coverage/vitest-fixture.ts";
```

`generateCoverageReport(options)` returns a `CoverageSummary` or `null` when nothing remappable was captured. The summary carries `lines`, `branches`, and `functions` as `{ pct, covered, total }` metrics, a `files` array, and the optional `depth`, `weighted`, and `interactions` blocks when those passes ran. See `src/report.ts` for the full types.

`GenerateCoverageOptions.rawDir` accepts a string or string array (multiple dump dirs are merged). Also accepts `urlFilter` / `sourceFilter` predicates for scoping, plus `depth` and `interactions` booleans (both default on) to skip a pass:

```typescript
const summary = await generateCoverageReport({
  rawDir: [".coverage-pw", ".coverage-vitest"],
  outputDir: "coverage",
  urlFilter: (servedUrl) => servedUrl.includes("/my-pkg/src/"),
  interactions: false,
});
```

## Caveats

- **Chromium only**: V8 precise coverage is a Chromium feature. Capture no-ops on Firefox and WebKit, so run the coverage project against Chromium
- **Source maps required**: a script with no readable sibling `.map` is dropped before remapping. The per-file table only ever shows code that mapped back to source
- **Bundled dependencies**: a bundle inlines its `node_modules`, so a source-mapped location can land inside a third-party package. Depth and interaction worklists drop third-party locations, because they aren't yours to test
- **Best-effort by design**: capture and reporting are wrapped so coverage never fails a real test or an otherwise-green suite. A parse failure, a missing map, or a monocart error degrades to less coverage, never a red run
- **Memory**: every test repeats the full source of every script it loaded, so the report merges each dump into a running accumulator immediately rather than holding all of them. Memory stays bounded by the number of unique remappable scripts, not the number of tests
- **Constant guards don't count**: a compile-time-constant branch (`if (false)`, `while (true)`, `false && x`) has an arm that can never be taken. That arm is dead code, not an untested branch, so it's excluded from branch and depth coverage and never appears in a worklist
- **Branchless files read as 100% branch**: a file with no branches has nothing to cover, so its branch percentage is 100, not 0. This keeps icons, constant tables, and barrel re-exports out of the least-covered list

## Architecture

For how the pipeline works end to end (the V8 capture, the merge-and-remap, the vendored control-flow-graph engine, and how depth and interaction coverage are computed from post-dominance), see [ARCHITECTURE.md](./ARCHITECTURE.md).
