import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import { runLocal } from "./local-environment";
import { CONFORMANCE_DIRECTORY, loadRepos } from "./repos";
import { formatTable, hasFailure, readRepoResult } from "./results";
import type { RepoResult } from "./results";
import { execFileSync } from "node:child_process";
import {
  countCounterexamples,
  formatCounterexamples,
  formatMountFailures,
  summarizeVerdicts,
} from "../verifier/verdict-report";
import type { ComponentVerdict } from "../verifier/verdicts";
import { verifyProject } from "../verifier/verify";
import { getErrorChain } from "../verifier/reasons";

interface RunOptions {
  out: string;
  runName: string;
  concurrency: number;
  verify: boolean;
}

interface VerifyCommandOptions {
  component?: string[];
  json: boolean;
  setup?: string;
}

const parsePositiveInteger = (value: string): number => {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1)
    throw new InvalidArgumentError("Expected a positive integer.");
  return integer;
};

const getRunName = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const mapWithConcurrency = async <Item, Result>(
  items: Item[],
  concurrency: number,
  mapItem: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = Array.from({ length: items.length });
  const entries = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of entries) results[index] = await mapItem(item);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

const writeResults = (runDirectory: string, results: RepoResult[]): void => {
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(join(runDirectory, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(formatTable(results));
  console.log(picocolors.dim(`\nresults in ${runDirectory}`));
  if (results.some(hasFailure)) process.exitCode = 1;
};

const run = async (ids: string[], options: RunOptions): Promise<void> => {
  const runDirectory = join(options.out, options.runName);
  const log = (line: string): void => console.error(picocolors.dim(line));
  const results = await mapWithConcurrency(
    loadRepos(ids),
    options.concurrency,
    async (repo): Promise<RepoResult> => {
      const outputDirectory = join(runDirectory, repo.id);
      try {
        log(`running ${repo.id}`);
        return {
          id: repo.id,
          revision: repo.revision,
          summary: await runLocal(repo, outputDirectory, options.verify, log),
          error: null,
        };
      } catch (error) {
        const message = getErrorChain(error);
        mkdirSync(outputDirectory, { recursive: true });
        writeFileSync(join(outputDirectory, "error.txt"), message);
        return { id: repo.id, revision: repo.revision, summary: null, error: message };
      }
    },
  );
  writeResults(runDirectory, results);
};

const report = (directory: string, ids: string[]): void => {
  const presentIds = readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isDirectory())
    .sort();
  const results = loadRepos(ids.length > 0 ? ids : presentIds).map((repo) =>
    readRepoResult(repo, join(directory, repo.id)),
  );
  writeResults(directory, results);
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
        `states ${verdict.coveredStateIndices.length}/${verdict.predictedStateCount} covered · transitions ${verdict.coveredTransitionCount} · branch sides ${verdict.coveredBranchSideCount}/${verdict.branchSideCount} · ${verdict.warningCount > 0 ? `warnings ${verdict.coveredWarningCount}/${verdict.warningCount} covered · ` : ""}${verdict.observationCount} observations`,
      ),
  ];
  for (const claim of formatCounterexamples(verdict)) lines.push(picocolors.red(`  ✗ ${claim}`));
  for (const unwarned of verdict.unwarnedMutations)
    lines.push(picocolors.dim(`  · unwarned mutation: ${unwarned}`));
  if (verdict.renderErrorCount > 0)
    lines.push(
      picocolors.yellow(`  ${verdict.renderErrorCount} observations threw while rendering`),
    );
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
  .option("-o, --out <dir>", "results directory", join(CONFORMANCE_DIRECTORY, "results"))
  .option(
    "--run-name <name>",
    "name of this run's folder (default: the current time)",
    getRunName(),
  )
  .option("-n, --concurrency <n>", "repos to run at once", parsePositiveInteger, 1)
  .option("--no-verify", "skip mounting components in a browser to check the analyzer's claims")
  .action(run);

program
  .command("report")
  .description("Collect a run folder's per-repo results into results.json and print the table.")
  .argument("<directory>", "a run folder with one subfolder per repo")
  .argument("[ids...]", "repos to report (default: every subfolder)")
  .action(report);

program
  .command("verify")
  .description(
    "Mount each exported component of one project in a real browser, explore it, and check the analyzer's claims against what renders.",
  )
  .argument("<tsconfig>", "path to the project's tsconfig.json")
  .option("-c, --component <names...>", "only verify these components")
  .option("--json", "print the verdicts as JSON", false)
  .option("-s, --setup <directory>", "a verify directory with setup.tsx and harness.json")
  .action(async (tsconfig: string, options: VerifyCommandOptions) => {
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
    const summary = summarizeVerdicts(report.verdicts, report.durationMs);
    console.log(
      picocolors.dim(
        `\n${summary.verifiedCount} verified · ${summary.unmountableCount} couldn't mount${summary.unmountableCount > 0 ? ` (${formatMountFailures(summary.mountFailureCounts)})` : ""} · ${summary.notExportedCount} not exported · ${summary.counterexampleCount} counterexamples · states ${summary.coveredStateCount}/${summary.predictedStateCount} covered · warnings ${summary.coveredWarningCount}/${summary.warningCount} covered · ${summary.unwarnedMutationCount} unwarned mutations · ${summary.durationMs} ms`,
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
