import type { CorpusResult } from "./manifest.js";

// Results are persisted per entry so partial corpus runs (one repository at a
// time, static-only passes, browser passes days apart) accumulate into one
// table instead of overwriting each other.

export interface CorpusResultsFile {
  results: CorpusResult[];
}

export const mergeCorpusResults = (
  previous: CorpusResult[],
  fresh: CorpusResult[],
): CorpusResult[] => {
  const byId = new Map(previous.map((result) => [result.id, result]));
  for (const result of fresh) byId.set(result.id, result);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const outcome = (result: CorpusResult): string => {
  if (result.failure) return `failed: ${result.failure}`;
  if (result.report) return result.report.status;
  if (result.static) return result.note ?? "static only";
  return "no result";
};

const describeStatic = (result: CorpusResult): string => {
  if (!result.static) return "-";
  const { stats } = result.static;
  const parts = [`${stats.fiberCount} fibers`];
  if (stats.branchCount) parts.push(`${stats.branchCount} branches`);
  if (stats.repeatCount) parts.push(`${stats.repeatCount} repeats`);
  if (stats.opaqueCount) parts.push(`${stats.opaqueCount} opaque`);
  if (stats.unknownCount) parts.push(`${stats.unknownCount} unknown`);
  return parts.join(", ");
};

const describeRuntime = (result: CorpusResult): string => {
  if (!result.runtime) return "-";
  const { runtime } = result;
  const version = runtime.reactVersion ?? "react ?";
  return `${runtime.fibers} fibers (react ${version}, ${runtime.commits} commits)`;
};

const describeComparison = (result: CorpusResult): string => {
  if (!result.report) return "-";
  const { report } = result;
  const parts = [
    `coverage ${percent(report.coverage)} (strict ${percent(report.strictCoverage)})`,
    `${report.matchedFibers} matched`,
  ];
  if (report.opaqueSubtrees) {
    parts.push(
      `${report.opaqueSubtrees} opaque (${report.opaqueSkippedFibers} skipped, slots ${report.slotsMatched}/${report.slotsMatched + report.slotsUnmatched})`,
    );
  }
  if (report.divergence) {
    parts.push(
      `diverged at ${report.divergence.path}: expected ${report.divergence.expected}, saw ${report.divergence.actual}`,
    );
  }
  return parts.join("; ");
};

export const formatCorpusTable = (results: CorpusResult[]): string => {
  const rows = results.map((result) => [
    result.id,
    result.framework,
    outcome(result),
    describeStatic(result),
    describeRuntime(result),
    describeComparison(result),
  ]);
  const header = ["entry", "framework", "outcome", "static", "runtime", "comparison"];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column])).join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
};

export const formatCorpusMarkdown = (results: CorpusResult[]): string => {
  const header = "| entry | framework | outcome | static | runtime | comparison |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const escape = (cell: string): string => cell.replace(/\|/g, "\\|");
  const rows = results.map(
    (result) =>
      `| ${[
        result.id,
        result.framework,
        outcome(result),
        describeStatic(result),
        describeRuntime(result),
        describeComparison(result),
      ]
        .map(escape)
        .join(" | ")} |`,
  );
  return [header, divider, ...rows].join("\n");
};
