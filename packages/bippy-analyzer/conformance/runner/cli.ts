import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import type { CollectSummary } from "./collect.js";
import { runLocal } from "./local-environment.js";
import { CONFORMANCE_DIRECTORY, loadRepos } from "./repos.js";
import type { RepoConfig } from "./repos.js";
import { runVercel } from "./vercel-environment.js";

type Environment = "local" | "vercel";

interface RunOptions {
  env: Environment;
  out: string;
  concurrency: number;
  verify: boolean;
}

interface RepoResult {
  id: string;
  revision: string;
  summary: CollectSummary | null;
  error: string | null;
}

const ENVIRONMENTS: Environment[] = ["local", "vercel"];

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

const UNRESOLVED_TYPE_LIMIT = 0.2;

const isSetupSuspect = (summary: CollectSummary): boolean =>
  summary.bindings > 0 && summary.unresolvedTypeBindings / summary.bindings > UNRESOLVED_TYPE_LIMIT;

const formatTable = (results: RepoResult[]): string => {
  const header = [
    "repo",
    "files",
    "components",
    "states",
    "transitions",
    "dead",
    "untyped",
    "bailouts",
    "verified",
    "unmountable",
    "wrong",
    "witnessed",
    "time",
  ];
  const rows = results.map(({ id, summary }) => {
    if (!summary) return [id, "failed"];
    const bailoutCount = Object.values(summary.bailouts).reduce((total, count) => total + count, 0);
    return [
      id,
      String(summary.files),
      String(summary.components),
      String(summary.states),
      String(summary.transitions),
      String(summary.deadBranches),
      String(summary.untypedBindings),
      String(bailoutCount),
      summary.verification ? String(summary.verification.verified) : "-",
      summary.verification ? String(summary.verification.couldNotMount) : "-",
      summary.verification ? String(summary.verification.wrong) : "-",
      summary.verification
        ? `${summary.verification.witnessedStates}/${summary.verification.predictedStates}`
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
    error ? [picocolors.red(`${id}: ${error.split("\n").slice(0, 6).join("\n  ")}`)] : [],
  );
  for (const { id, summary } of results) {
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

new Command()
  .name("conformance")
  .description("Run the analyzer against pinned real-world repos and collect the results.")
  .command("run")
  .argument("[ids...]", "repos to run (default: all)")
  .option("-e, --env <env>", `where to run: ${ENVIRONMENTS.join(", ")}`, parseEnvironment, "local")
  .option("-o, --out <dir>", "results directory", join(CONFORMANCE_DIRECTORY, "results"))
  .option("-n, --concurrency <n>", "repos to run at once", parseConcurrency, 1)
  .option("--no-verify", "skip mounting components in a browser to check the analyzer's claims")
  .action(run)
  .parent?.parseAsync();
