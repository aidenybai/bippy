import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runConcolicEntry, type ConcolicEntryResult } from "../src/concolic/run-entry.js";
import { readCorpusManifest, type CorpusResult } from "../src/corpus/manifest.js";
import { runCorpusEntry } from "../src/corpus/run-entry.js";
import { BrowserCapturer } from "../src/harness/capture-browser.js";
import { formatComparisonReport } from "../src/harness/format-report.js";
import { summarizeStateSpace } from "../src/harness/compare-render.js";

const USAGE = `usage: tsx scripts/concolic.ts [options] <entry-id ...>

Replays saved corpus captures through the concolic prototype (real code in a
fresh vm realm per path, symbolic unknowns, decision replay) or through the
production interpreter, and prints one evidence row per entry.

  --engine <e>      concolic (default) or interpreter
  --max-paths <n>   concolic path budget for this run (default MAX_PATHS)
  --manifest <p>    corpus manifest (default corpus/manifest.json)
  --corpus-dir <p>  where repositories are cloned (default .corpus)
  --json <p>        write the full result records to this file
  --verbose         print per-path progress and the comparison report`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    engine: { type: "string", default: "concolic" },
    "max-paths": { type: "string" },
    manifest: { type: "string", default: "corpus/manifest.json" },
    "corpus-dir": { type: "string", default: ".corpus" },
    json: { type: "string" },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const packageDirectory = path.resolve(import.meta.dirname, "..");
const manifest = readCorpusManifest(path.resolve(packageDirectory, values.manifest));
const corpusDirectory = path.resolve(packageDirectory, values["corpus-dir"]);
const selected = manifest.entries.filter((entry) => positionals.includes(entry.id));
const unknown = positionals.filter((id) => !manifest.entries.some((entry) => entry.id === id));
if (unknown.length > 0) {
  console.error(`unknown corpus entries: ${unknown.join(", ")}`);
  process.exit(1);
}
if (values.engine !== "concolic" && values.engine !== "interpreter") {
  console.error(`unknown engine ${values.engine}`);
  process.exit(1);
}

interface EvidenceRow {
  entry: string;
  engine: string;
  status: string;
  strictCoverage: string;
  matchedFibers: string;
  states: string;
  leaks: string;
  wallMs: number;
  peakRssMb: number;
}

const COLUMNS: (keyof EvidenceRow)[] = [
  "entry",
  "engine",
  "status",
  "strictCoverage",
  "matchedFibers",
  "states",
  "leaks",
  "wallMs",
  "peakRssMb",
];

const peakRssMb = (): number => Math.round(process.resourceUsage().maxRSS / 1024);

const percent = (value: number | undefined): string =>
  value === undefined ? "-" : `${(value * 100).toFixed(2)}%`;

const formatRows = (rows: EvidenceRow[]): string => {
  const widths = COLUMNS.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column]).length)),
  );
  const line = (cells: string[]): string =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    line([...COLUMNS]),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(COLUMNS.map((column) => String(row[column])))),
  ].join("\n");
};

const rows: EvidenceRow[] = [];
const records: (ConcolicEntryResult | CorpusResult)[] = [];
const log = (id: string) => (message: string) => {
  if (values.verbose) console.log(`[${id}] ${message}`);
};

for (const entry of selected) {
  const startedAt = Date.now();
  if (values.engine === "concolic") {
    const maxPaths =
      values["max-paths"] === undefined ? undefined : Number.parseInt(values["max-paths"], 10);
    const run = await runConcolicEntry(entry, { corpusDirectory, maxPaths, log: log(entry.id) });
    const { result } = run;
    records.push(result);
    if (values.verbose && result.report && run.comparison) {
      console.log(formatComparisonReport(result.report, summarizeStateSpace(run.comparison)));
      if (result.matchedDecisions.length > 0) {
        console.log(`matched path decisions:\n  ${result.matchedDecisions.join("\n  ")}`);
      }
    }
    if (result.failure) console.error(`[${entry.id}] failed: ${result.failure}`);
    const leakCount = result.leaks.reduce((sum, leak) => sum + leak.count, 0);
    rows.push({
      entry: entry.id,
      engine: "concolic",
      status: result.status,
      strictCoverage: percent(result.report?.strictCoverage),
      matchedFibers: result.report ? `${result.report.matchedFibers}/${result.runtimeFibers}` : "-",
      states: `${result.states} (${result.pathsExplored} paths, ${result.pathsOmitted} omitted, ${result.pathsFailed} failed)`,
      leaks: `${leakCount} (${result.symbolics} symbolics)`,
      wallMs: Date.now() - startedAt,
      peakRssMb: peakRssMb(),
    });
  } else {
    const capturer = new BrowserCapturer({ headless: true });
    try {
      const result = await runCorpusEntry(entry, {
        corpusDirectory,
        scriptsDirectory: path.join(
          path.dirname(path.resolve(packageDirectory, values.manifest)),
          "scripts",
        ),
        capturer,
        skipInstall: true,
        staticOnly: true,
        log: log(entry.id),
      });
      records.push(result);
      if (values.verbose && result.report)
        console.log(formatComparisonReport(result.report, result.stateSpace));
      if (result.failure) console.error(`[${entry.id}] failed: ${result.failure}`);
      rows.push({
        entry: entry.id,
        engine: "interpreter",
        status: result.report?.status ?? (result.failure ? "failed" : "skipped"),
        strictCoverage: percent(result.report?.strictCoverage),
        matchedFibers: result.report
          ? `${result.report.matchedFibers}/${result.runtime?.fibers ?? "?"}`
          : "-",
        states: `${result.stateSpace?.states ?? "-"}${result.stateSpace?.omitted ? " (omitted)" : ""}`,
        leaks: `${result.static?.stats.unknownCount ?? "-"} unknowns`,
        wallMs: Date.now() - startedAt,
        peakRssMb: peakRssMb(),
      });
    } finally {
      await capturer.close();
    }
  }
}

console.log(formatRows(rows));
if (values.json) {
  const target = path.resolve(packageDirectory, values.json);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ rows, records }, null, 2)}\n`);
}
// HACK: uninstrumented libraries (Monaco workers, pollers) leave realm timers armed after their window is closed.
process.exit(0);
