#!/usr/bin/env node

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { CLI_REPORTS, DEFAULT_TOP_COUNT } from "./constants.js";
import { formatCoverageTable, formatSurvivors, formatWorklistDelta } from "./format.js";
import { buildMutationPlan } from "./mutation-plan.js";
import { matchSurvivors, parseStrykerSurvivors } from "./mutation-survivors.js";
import { generateCoverageReport } from "./report.js";
import type { WorklistItem } from "./report.js";
import { diffWorklist } from "./worklist.js";

interface CliOptions {
  filter?: string;
  top?: number | boolean;
  out?: string;
  reports?: string;
  name?: string;
  json?: boolean;
  depth?: boolean;
  interactions?: boolean;
  pruneInfeasible?: boolean;
  mutations?: boolean;
  mutationPlan?: string;
  baseline?: string;
  strykerReport?: string;
  debug?: boolean;
}

const readBaselineWorklist = (path: string): WorklistItem[] => {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.worklist) ? parsed.worklist : [];
};

const run = async (rawDirs: string[], options: CliOptions): Promise<void> => {
  const { filter } = options;
  const top =
    options.top === undefined
      ? undefined
      : typeof options.top === "number"
        ? options.top
        : DEFAULT_TOP_COUNT;

  const reports = options.reports
    ? options.reports.split(",").map((name) => name.trim())
    : options.out
      ? undefined
      : CLI_REPORTS;

  const summary = await generateCoverageReport({
    rawDir: rawDirs.map((rawDir) => resolve(rawDir)),
    outputDir: options.out ? resolve(options.out) : mkdtempSync(join(tmpdir(), "coverage-")),
    name: options.name,
    reports,
    urlFilter: filter ? (servedUrl) => servedUrl.split("?")[0]!.includes(filter) : undefined,
    depth: options.depth,
    interactions: options.interactions,
    pruneInfeasibleInteractions: options.pruneInfeasible,
    debug: options.debug,
  });

  if (!summary) {
    console.error(
      "No remappable coverage found (need V8 dumps with source maps or original sources).",
    );
    process.exitCode = 1;
    return;
  }

  if (options.mutationPlan) {
    const plan = buildMutationPlan(summary);
    writeFileSync(resolve(options.mutationPlan), JSON.stringify(plan, null, 2));
    console.error(
      `Wrote mutation plan (${plan.targets.length} targets, ${plan.mutate.length} lines) to ${options.mutationPlan}`,
    );
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const sections = [
    formatCoverageTable(summary, { top, filterLabel: filter, mutations: options.mutations }),
  ];
  if (options.baseline) {
    const delta = diffWorklist(readBaselineWorklist(options.baseline), summary.worklist ?? []);
    sections.push(formatWorklistDelta(delta));
  }
  if (options.strykerReport) {
    const report = JSON.parse(readFileSync(resolve(options.strykerReport), "utf8"));
    sections.push(formatSurvivors(matchSurvivors(summary, parseStrykerSurvivors(report))));
  }
  console.log(`\n${sections.join("\n\n")}\n`);
};

const program = new Command();

program
  .name("playwright-coverage")
  .description(
    "Remap V8 coverage dumps (Playwright and/or Vitest) onto original sources and report",
  )
  .argument("<raw-dirs...>", "directories of per-test raw V8 JSON dumps (merged when multiple)")
  .option("--filter <substr>", "keep only entries whose served URL contains <substr>")
  .option("--top [n]", "show only the n least-covered files", (value) => Number(value))
  .option("--out <dir>", "persist reports here (default: a temp dir, v8 only)")
  .option(
    "--reports <list>",
    "comma-separated report formats (e.g. text,text-summary,html,lcovonly)",
  )
  .option("--name <name>", "report name shown in the html report")
  .option("--json", "print machine-readable JSON instead of the table")
  .option("--no-depth", "skip control-flow depth analysis (on by default)")
  .option("--no-interactions", "skip combinatorial interaction analysis (on by default)")
  .option(
    "--no-prune-infeasible",
    "keep interaction combos even when proven impossible (prune is on by default)",
  )
  .option(
    "--no-mutations",
    "hide the targeted operator-mutation manifest (on by default; always in --json)",
  )
  .option(
    "--mutation-plan <file>",
    "write a mutation-testing plan (Stryker mutationRange + mutators) to <file>",
  )
  .option(
    "--baseline <file>",
    "diff the worklist against a prior --json output and show closed/opened/carried",
  )
  .option(
    "--stryker-report <file>",
    "match a Stryker JSON report's survivors back to the manifest (proven gaps)",
  )
  .option("--debug", "verbose logging + dump merged script URLs")
  .addHelpText(
    "after",
    `
Examples:
  $ playwright-coverage /tmp/cov
  $ playwright-coverage .coverage-pw .coverage-vitest --filter packages/ui/src/ --top
  $ playwright-coverage /tmp/cov --out ./coverage --json`,
  )
  .action(run);

program.parseAsync().catch((error: unknown) => {
  console.error("playwright-coverage error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
