import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import type { CollectSummary } from "./collect.js";
import { runLocal } from "./local-environment.js";
import { CONFORMANCE_DIRECTORY, loadRepos } from "./repos.js";
import type { RepoConfig } from "./repos.js";
import { runVercel } from "./vercel-environment.js";
import { execFileSync } from "node:child_process";
import {
  countCounterexamples,
  formatCounterexamples,
  formatMountFailures,
  sum,
  summarizeVerdicts,
} from "../verifier/score.js";
import type { ComponentVerdict } from "../verifier/score.js";
import { verifyProject } from "../verifier/verify.js";

type Environment = "local" | "vercel";

interface RunOptions {
  env: Environment;
  out: string;
  concurrency: number;
  verify: boolean;
}

interface VerifyOptions {
  component?: string[];
  json: boolean;
  setup?: string;
}

interface RepoResult {
  id: string;
  revision: string;
  summary: CollectSummary | null;
  error: string | null;
}

const ENVIRONMENTS: Environment[] = ["local", "vercel"];
const UNRESOLVED_TYPE_LIMIT = 0.2;
const ERROR_PREVIEW_LINES = 6;

const parseEnvironment = (value: string): Environment => {
  const environment = ENVIRONMENTS.find((candidate) => candidate === value);
  if (!environment)
    throw new InvalidArgumentError(
      `Unknown environment: ${value}. Use ${ENVIRONMENTS.join(", ")}.`,
    );
  return environment;
};

const parseConcurrency = (value: string): number => {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new InvalidArgumentError("Concurrency must be a positive integer.");
  return concurrency;
};

const runRepo = (
  repo: RepoConfig,
  options: RunOptions,
  outputDirectory: string,
  log: (line: string) => void,
): Promise<CollectSummary> =>
  options.env === "vercel"
    ? runVercel(repo, outputDirectory, options.verify, log)
    : runLocal(repo, outputDirectory, options.verify, log);

const mapWithConcurrency = async <Item, Result>(
  items: Item[],
  concurrency: number,
  mapItem: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) results[index] = await mapItem(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

const isSetupSuspect = (summary: CollectSummary): boolean =>
  summary.bindings > 0 && summary.unresolvedTypeBindings / summary.bindings > UNRESOLVED_TYPE_LIMIT;

const formatTable = (results: RepoResult[]): string => {
  const header = [
    "repo",
    "files",
    "components",
    "states",
    "handlers",
    "unreachable",
    "untyped",
    "bailouts",
    "verified",
    "unmountable",
    "counterexamples",
    "covered",
    "time",
  ];
  const rows = results.map(({ id, summary }) => {
    if (!summary) return [id, "failed"];
    const bailoutCount = sum(Object.values(summary.bailouts), (count) => count);
    return [
      id,
      String(summary.files),
      String(summary.components),
      String(summary.states),
      String(summary.handlers),
      String(summary.unreachableBranches),
      String(summary.untypedBindings),
      String(bailoutCount),
      summary.verification ? String(summary.verification.verified) : "-",
      summary.verification ? String(summary.verification.couldNotMount) : "-",
      summary.verification ? String(summary.verification.counterexamples) : "-",
      summary.verification
        ? `${summary.verification.coveredStates}/${summary.verification.predictedStates}`
        : "-",
      `${summary.durationMs + (summary.verification?.durationMs ?? 0)} ms`,
    ];
  });
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ");
  const failures = results.flatMap(({ id, error }) =>
    error
      ? [picocolors.red(`${id}: ${error.split("\n").slice(0, ERROR_PREVIEW_LINES).join("\n  ")}`)]
      : [],
  );
  for (const { id, summary } of results) {
    if (summary?.verification && summary.verification.couldNotMount > 0)
      failures.push(
        picocolors.dim(
          `${id}: couldn't mount ${formatMountFailures(summary.verification.mountFailures)}`,
        ),
      );
    if (summary && isSetupSuspect(summary)) {
      failures.push(
        picocolors.yellow(
          `${id}: ${summary.unresolvedTypeBindings} of ${summary.bindings} bindings have unresolved types. Check that the install ran in the right directory.`,
        ),
      );
    }
  }
  return [
    picocolors.dim(formatRow(header)),
    ...rows.map(formatRow),
    ...(failures.length > 0 ? ["", ...failures] : []),
  ].join("\n");
};

const run = async (ids: string[], options: RunOptions): Promise<void> => {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = join(options.out, runId);
  const log = (line: string): void => console.error(picocolors.dim(line));
  const results = await mapWithConcurrency(
    loadRepos(ids),
    options.concurrency,
    async (repo): Promise<RepoResult> => {
      const outputDirectory = join(runDirectory, repo.id);
      try {
        log(`running ${repo.id} (${options.env})`);
        return {
          id: repo.id,
          revision: repo.revision,
          summary: await runRepo(repo, options, outputDirectory, log),
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        mkdirSync(outputDirectory, { recursive: true });
        writeFileSync(join(outputDirectory, "error.txt"), message);
        return { id: repo.id, revision: repo.revision, summary: null, error: message };
      }
    },
  );
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(join(runDirectory, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(formatTable(results));
  console.log(picocolors.dim(`\nresults in ${runDirectory}`));
};

const formatVerdict = (verdict: ComponentVerdict): string => {
  if (verdict.status === "not-exported")
    return picocolors.dim(`${verdict.name}  not exported, skipped`);
  if (verdict.status === "mount-failed")
    return `${verdict.name}  ${picocolors.yellow(`couldn't mount (${verdict.mountFailure ?? "other"})`)} ${picocolors.dim(verdict.error ?? "")}`;
  const counterexampleCount = countCounterexamples(verdict);
  const lines = [
    `${picocolors.bold(verdict.name)}  ${
      counterexampleCount > 0
        ? picocolors.red(`${counterexampleCount} counterexamples`)
        : picocolors.green("0 counterexamples")
    }  ` +
      picocolors.dim(
        `states ${verdict.coveredStates.length}/${verdict.predictedStates} covered · transitions ${verdict.coveredTransitions} · branch sides ${verdict.coveredBranchSides}/${verdict.branchSides} · ${verdict.warnings > 0 ? `warnings ${verdict.coveredWarnings}/${verdict.warnings} covered · ` : ""}${verdict.observations} observations`,
      ),
  ];
  for (const claim of formatCounterexamples(verdict)) lines.push(picocolors.red(`  ✗ ${claim}`));
  for (const unwarned of verdict.unwarnedMutations)
    lines.push(picocolors.dim(`  · unwarned mutation: ${unwarned}`));
  if (verdict.renderErrors > 0)
    lines.push(picocolors.yellow(`  ${verdict.renderErrors} observations threw while rendering`));
  return lines.join("\n");
};

const program = new Command()
  .name("conformance")
  .description(
    "Run the analyzer against pinned real-world repos and check its claims in a browser.",
  );

program
  .command("run")
  .description("Analyze and verify the pinned repos, and collect the results.")
  .argument("[ids...]", "repos to run (default: all)")
  .option("-e, --env <env>", `where to run: ${ENVIRONMENTS.join(", ")}`, parseEnvironment, "local")
  .option("-o, --out <dir>", "results directory", join(CONFORMANCE_DIRECTORY, "results"))
  .option("-n, --concurrency <n>", "repos to run at once", parseConcurrency, 1)
  .option("--no-verify", "skip mounting components in a browser to check the analyzer's claims")
  .action(run);

program
  .command("verify")
  .description(
    "Mount each exported component of one project in a real browser, explore it, and check the analyzer's claims against what renders.",
  )
  .argument("<tsconfig>", "path to the project's tsconfig.json")
  .option("-c, --component <names...>", "only verify these components")
  .option("--json", "print the verdicts as JSON", false)
  .option("-s, --setup <directory>", "a verify directory with setup.tsx and harness.json")
  .action(async (tsconfig: string, options: VerifyOptions) => {
    const report = await verifyProject(tsconfig, {
      componentNames: options.component,
      setupDirectory: options.setup ?? null,
      onComponent: options.json ? undefined : (verdict) => console.log(formatVerdict(verdict)),
      onStart: process.env.VERIFY_DEBUG
        ? (componentName) => console.error(picocolors.dim(`→ ${componentName}`))
        : undefined,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const summary = summarizeVerdicts(report.components, report.durationMs);
    console.log(
      picocolors.dim(
        `\n${summary.verified} verified · ${summary.couldNotMount} couldn't mount${summary.couldNotMount > 0 ? ` (${formatMountFailures(summary.mountFailures)})` : ""} · ${summary.notExported} not exported · ${summary.counterexamples} counterexamples · states ${summary.coveredStates}/${summary.predictedStates} covered · warnings ${summary.coveredWarnings}/${summary.warnings} covered · ${summary.unwarnedMutations} unwarned mutations · ${summary.durationMs} ms`,
      ),
    );
  });

program
  .command("specs")
  .description("Run each repo's Playwright specs in conformance/repos/<id>/verify.")
  .action(() => {
    execFileSync(
      "playwright",
      ["test", "-c", join(CONFORMANCE_DIRECTORY, "playwright.config.ts")],
      {
        stdio: "inherit",
      },
    );
  });

await program.parseAsync();
