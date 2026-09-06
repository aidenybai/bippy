import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatCoverage } from "../harness/verify.js";
import { formatMismatches } from "../snapshot/match.js";
import type { LiveVerification } from "./live.js";
import type { ReasonCount, RepositoryScan } from "./scan.js";

export interface CorpusEntryResult {
  name: string;
  scan: RepositoryScan | null;
  live: LiveVerification | null;
  /** Checkout or scan failure that prevented any result. */
  error: string | null;
}

export interface CorpusReport {
  generatedAt: string;
  entries: CorpusEntryResult[];
}

const percent = (numerator: number, denominator: number): string =>
  denominator === 0 ? "–" : `${((numerator / denominator) * 100).toFixed(1)}%`;

const toFileName = (name: string): string => name.replace(/[^a-zA-Z0-9._-]+/g, "__");

const formatReasons = (title: string, reasons: ReasonCount[], limit = 15): string[] => {
  if (reasons.length === 0) return [];
  return [
    `### ${title}`,
    "",
    ...reasons.slice(0, limit).map((entry) => `- ${entry.count} × \`${entry.reason}\``),
    "",
  ];
};

const formatScan = (scan: RepositoryScan): string[] => {
  const known = scan.components.fibers;
  const total = known + scan.components.unknowns + scan.components.opaque;
  return [
    `- commit: ${scan.commit ?? "workspace"}; ${scan.framework}, react ${scan.reactVersion}`,
    `- files: ${scan.files.parsed}/${scan.files.total} parsed, ${scan.files.withErrors} with syntax errors (client ${scan.files.byEnvironment.client}, server ${scan.files.byEnvironment.server}, shared ${scan.files.byEnvironment.shared})`,
    `- imports: ${scan.imports.internal} internal, ${scan.imports.external} external, ${scan.imports.unresolved} unresolved of ${scan.imports.total}`,
    `- components: ${scan.components.found} found, ${scan.components.rendered} rendered, ${scan.components.crashed} crashed, ${scan.components.timedOut} timed out, ${scan.components.fullyKnown} fully known (${percent(scan.components.fullyKnown, scan.components.rendered)})`,
    `- nodes: ${known} fibers, ${scan.components.unknowns} unknown, ${scan.components.opaque} opaque → ${percent(known, total)} known`,
    `- diagnostics: ${
      Object.entries(scan.diagnostics)
        .map(([code, total]) => `${code} ${total}`)
        .join(", ") || "none"
    }`,
    `- scan time: ${(scan.durationMs / 1000).toFixed(1)}s`,
    "",
    ...formatReasons("Crashes", scan.crashes),
    ...formatReasons("Unknown children", scan.unknownReasons),
    ...formatReasons("Opaque packages", scan.opaquePackages),
    ...formatReasons("Unresolved imports", scan.imports.unresolvedSpecifiers),
    ...formatReasons("Diagnostics", scan.diagnosticMessages),
  ];
};

const formatLive = (live: LiveVerification): string[] => {
  const lines = [`- url: ${live.url || "not started"}; entry ${live.entryFile}`];
  if (live.error) lines.push(`- error: ${live.error}`);
  if (live.report) {
    const report = live.report;
    lines.push(
      `- runtime: ${live.runtimeRootCount} root(s), ${live.commitCount} commit(s), ${report.runtimeFiberCount} fibers`,
      `- static: ${report.staticFiberCount} fibers, ${report.staticUnknownCount} unknown, ${live.diagnosticCount} diagnostics`,
      `- result: ${report.isMatch ? "match" : "MISMATCH"}; coverage ${formatCoverage(report.coverage)} (${report.explainedFiberCount}/${report.runtimeFiberCount} explained)`,
    );
    if (!report.isMatch) lines.push("", "```", formatMismatches(report.mismatches), "```");
  }
  if (live.pageErrors.length > 0) {
    lines.push(`- page errors: ${live.pageErrors.length}`);
    for (const pageError of live.pageErrors.slice(0, 5)) lines.push(`  - ${pageError}`);
  }
  lines.push("");
  return lines;
};

const formatSummaryTable = (entries: CorpusEntryResult[]): string[] => {
  const header =
    "| repository | files | components | crashed | timed out | fully known | known nodes | live match | live coverage |";
  const divider = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: |";
  const rows = entries.map((entry) => {
    const scan = entry.scan;
    const live = entry.live;
    const known = scan ? scan.components.fibers : 0;
    const total = scan ? known + scan.components.unknowns + scan.components.opaque : 0;
    const liveMatch = live?.report
      ? live.report.isMatch
        ? "yes"
        : "no"
      : live?.error
        ? "error"
        : "–";
    const liveCoverage = live?.report ? formatCoverage(live.report.coverage) : "–";
    const scanCells = scan
      ? [
          scan.files.parsed,
          scan.components.rendered,
          scan.components.crashed,
          scan.components.timedOut,
          percent(scan.components.fullyKnown, scan.components.rendered),
          percent(known, total),
        ]
      : ["–", "–", "–", "–", "–", "–"];
    return `| ${[entry.name, ...scanCells, liveMatch, liveCoverage].join(" | ")} |`;
  });
  return [header, divider, ...rows];
};

const mergeReasons = (lists: ReasonCount[][]): ReasonCount[] => {
  const totals = new Map<string, number>();
  for (const reasons of lists) {
    for (const entry of reasons)
      totals.set(entry.reason, (totals.get(entry.reason) ?? 0) + entry.count);
  }
  return [...totals]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, total]) => ({ reason, count: total }));
};

export const formatCorpusReport = (report: CorpusReport): string => {
  const scans = report.entries
    .map((entry) => entry.scan)
    .filter((scan): scan is RepositoryScan => scan !== null);
  const lines = [
    "# Corpus report",
    "",
    `Generated ${report.generatedAt} for ${report.entries.length} entries.`,
    "",
    ...formatSummaryTable(report.entries),
    "",
    ...formatReasons(
      "Crashes across the corpus",
      mergeReasons(scans.map((scan) => scan.crashes)),
      25,
    ),
    ...formatReasons(
      "Unknown children across the corpus",
      mergeReasons(scans.map((scan) => scan.unknownReasons)),
      25,
    ),
    ...formatReasons(
      "Opaque packages across the corpus",
      mergeReasons(scans.map((scan) => scan.opaquePackages)),
      25,
    ),
  ];
  for (const entry of report.entries) {
    lines.push(`## ${entry.name}`, "");
    if (entry.error) lines.push(`- error: ${entry.error}`, "");
    if (entry.scan) lines.push(...formatScan(entry.scan));
    if (entry.live) lines.push("### Live", "", ...formatLive(entry.live));
  }
  return lines.join("\n");
};

/**
 * Writes the machine-readable report, the markdown summary and, per entry,
 * the rendered entry trees and live comparison trees for reading by hand.
 */
export const writeCorpusReport = (report: CorpusReport, outputDirectory: string): void => {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outputDirectory, "report.md"), formatCorpusReport(report));
  for (const entry of report.entries) {
    const entryDirectory = join(outputDirectory, toFileName(entry.name));
    mkdirSync(entryDirectory, { recursive: true });
    for (const entryTree of entry.scan?.entries ?? []) {
      writeFileSync(join(entryDirectory, `${toFileName(entryTree.filePath)}.txt`), entryTree.tree);
    }
    if (entry.live?.report) {
      writeFileSync(join(entryDirectory, "live-static.txt"), entry.live.report.staticTree);
      writeFileSync(join(entryDirectory, "live-runtime.txt"), entry.live.report.runtimeTree);
    }
  }
};
