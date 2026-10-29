import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import picocolors from "picocolors";
import { parseCollectSummary } from "./collect-summary";
import type { CollectSummary } from "./collect-summary";
import type { RepoConfig } from "./repos";
import { formatMountFailures, sum } from "../verifier/verdict-report";

export interface RepoResult {
  id: string;
  revision: string;
  summary: CollectSummary | null;
  error: string | null;
}

const UNRESOLVED_TYPE_LIMIT = 0.2;
const ERROR_PREVIEW_LINES = 6;
const TABLE_HEADER = [
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

export const readRepoResult = (repo: RepoConfig, outputDirectory: string): RepoResult => {
  const summaryPath = join(outputDirectory, "summary.json");
  const errorPath = join(outputDirectory, "error.txt");
  const summary = existsSync(summaryPath)
    ? parseCollectSummary(readFileSync(summaryPath, "utf8"))
    : null;
  const error = existsSync(errorPath)
    ? readFileSync(errorPath, "utf8")
    : summary
      ? null
      : `no results in ${outputDirectory}`;
  return { id: repo.id, revision: repo.revision, summary, error };
};

export const hasFailure = ({ summary, error }: RepoResult): boolean =>
  error !== null || (summary?.verification?.counterexampleCount ?? 0) > 0;

const isSetupSuspect = (summary: CollectSummary): boolean =>
  summary.bindingCount > 0 &&
  summary.unresolvedTypeBindingCount / summary.bindingCount > UNRESOLVED_TYPE_LIMIT;

const formatResultRow = ({ id, summary }: RepoResult): string[] => {
  if (!summary) return [id, "failed"];
  const { verification } = summary;
  const bailoutCount = sum(Object.values(summary.bailoutCountsByReason), (count) => count);
  return [
    id,
    String(summary.fileCount),
    String(summary.componentCount),
    String(summary.stateCount),
    String(summary.handlerCount),
    String(summary.unreachableBranchCount),
    String(summary.untypedBindingCount),
    String(bailoutCount),
    verification ? String(verification.verifiedCount) : "-",
    verification ? String(verification.unmountableCount) : "-",
    verification ? String(verification.counterexampleCount) : "-",
    verification ? `${verification.coveredStateCount}/${verification.predictedStateCount}` : "-",
    `${summary.durationMs + (verification?.durationMs ?? 0)} ms`,
  ];
};

const formatResultNotes = (results: RepoResult[]): string[] => {
  const notes = results.flatMap(({ id, error }) =>
    error
      ? [picocolors.red(`${id}: ${error.split("\n").slice(0, ERROR_PREVIEW_LINES).join("\n  ")}`)]
      : [],
  );
  for (const { id, summary } of results) {
    if (summary?.verification && summary.verification.unmountableCount > 0)
      notes.push(
        picocolors.dim(
          `${id}: couldn't mount ${formatMountFailures(summary.verification.mountFailureCounts)}`,
        ),
      );
    if (summary && isSetupSuspect(summary)) {
      notes.push(
        picocolors.yellow(
          `${id}: ${summary.unresolvedTypeBindingCount} of ${summary.bindingCount} bindings have unresolved types. Check that the install ran in the right directory.`,
        ),
      );
    }
  }
  return notes;
};

export const formatTable = (results: RepoResult[]): string => {
  const rows = results.map(formatResultRow);
  const widths = TABLE_HEADER.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ");
  const notes = formatResultNotes(results);
  return [
    picocolors.dim(formatRow(TABLE_HEADER)),
    ...rows.map(formatRow),
    ...(notes.length > 0 ? ["", ...notes] : []),
  ].join("\n");
};
