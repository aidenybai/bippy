import assert from "node:assert/strict";
import type { BenchmarkResult } from "./harness.js";
import { getBenchmarkVariant, type BenchmarkVariant } from "./configuration.js";
import { getSampleStatistics } from "./statistics.js";

export interface ExportInventory {
  entry: string;
  callable: string[];
  data: string[];
}

export interface WorkerReport extends BenchmarkVariant {
  group: string;
  reactVersion: string;
  exports: ExportInventory[];
  results: BenchmarkResult[];
  maxRssBytes: number;
}

export interface UseFiberResult {
  react: string;
  reactVersion: string;
  components: number;
  precedingHooks: number;
  baselineMountMs: number;
  useFiberMountMs: number;
  baselineUpdateMs: number;
  useFiberUpdateMs: number;
  mountCaptureMicroseconds: number;
  updateCaptureMicroseconds: number;
}

export interface UseFiberReport {
  format: BenchmarkVariant["format"];
  results: UseFiberResult[];
}

export interface ImportResult extends BenchmarkVariant {
  entry: string;
  sampleUs: number[];
  medianUs: number;
}

export interface BundleInfo {
  name: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
}

export interface RunMetadata {
  timestamp: string;
  isQuickMode: boolean;
  node: string;
  platform: string;
  arch: string;
  cpu?: string;
  gitRevision: string;
  lockfileSha256: string;
  bundles: BundleInfo[];
}

export interface BenchmarkRunReport {
  schemaVersion: number;
  metadata: RunMetadata;
  scope: {
    callableExports: string[];
    nonCallableExports: string[];
    useFiberReactBuild: "production";
    syntheticSourceFetch: boolean;
  };
  imports: ImportResult[];
  reports: WorkerReport[];
  useFiber: UseFiberReport[];
}

interface UnknownRecord {
  [name: string]: unknown;
}

export const verifyRecord: (value: unknown) => asserts value is UnknownRecord = (value) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Expected an object");
};
const verifyStrings: (value: unknown) => asserts value is string[] = (value) => {
  assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === "string"));
};
const verifyNumbers: (value: unknown) => asserts value is number[] = (value) => {
  assert.ok(
    Array.isArray(value) &&
      value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0),
  );
};
const verifyInteger = (value: unknown, minimum: number): void => {
  assert.ok(typeof value === "number" && Number.isInteger(value) && value >= minimum);
};

export const verifyBenchmarkCoverage = (
  exports: ExportInventory[],
  measured: Set<string>,
): void => {
  const callable = exports.flatMap(({ entry, callable }) =>
    callable.map((name) => `${entry}#${name}`),
  );
  assert.deepEqual(
    [...measured].sort(),
    callable.sort(),
    "Every callable export must be benchmarked; aliases must be verified",
  );
};

export const verifyWorkerReport: (value: unknown) => asserts value is WorkerReport = (value) => {
  verifyRecord(value);
  getBenchmarkVariant(value.format, value.reactBuild);
  assert.ok(typeof value.group === "string" && typeof value.reactVersion === "string");
  verifyInteger(value.maxRssBytes, 0);
  assert.ok(Array.isArray(value.exports));
  const exports: unknown[] = value.exports;
  for (const entry of exports) {
    verifyRecord(entry);
    assert.ok(typeof entry.entry === "string");
    verifyStrings(entry.callable);
    verifyStrings(entry.data);
  }
  assert.ok(Array.isArray(value.results) && value.results.length > 0, "Empty benchmark group");
  const results: unknown[] = value.results;
  const identifiers = new Set<string>();
  for (const result of results) {
    verifyRecord(result);
    assert.ok(
      typeof result.id === "string" && !identifiers.has(result.id),
      "Duplicate or invalid benchmark ID",
    );
    identifiers.add(result.id);
    verifyStrings(result.apis);
    verifyInteger(result.iterations, 1);
    verifyInteger(result.units, 1);
    verifyInteger(result.samples, 1);
    verifyNumbers(result.sampleUs);
    assert.equal(result.samples, result.sampleUs.length);
    const statistics = getSampleStatistics(result.sampleUs);
    assert.equal(result.minUs, statistics.min, "Invalid minimum");
    assert.equal(result.medianUs, statistics.median, "Invalid median");
    assert.equal(result.maxUs, statistics.max, "Invalid maximum");
  }
};

export const verifyUseFiberResult: (value: unknown) => asserts value is UseFiberResult = (
  value,
) => {
  verifyRecord(value);
  assert.ok(typeof value.react === "string" && typeof value.reactVersion === "string");
  verifyInteger(value.components, 1);
  verifyInteger(value.precedingHooks, 0);
  verifyNumbers([
    value.baselineMountMs,
    value.useFiberMountMs,
    value.baselineUpdateMs,
    value.useFiberUpdateMs,
    value.mountCaptureMicroseconds,
    value.updateCaptureMicroseconds,
  ]);
};

const reportPrefix = "__REPORT__";
export const writeReport = (report: unknown): void =>
  console.log(reportPrefix + JSON.stringify(report));
export const readReport = (stdout: string): unknown => {
  const reports = stdout.split("\n").filter((line) => line.startsWith(reportPrefix));
  assert.equal(reports.length, 1, "Worker must produce exactly one report");
  return JSON.parse(reports[0].slice(reportPrefix.length));
};

export const formatBenchmarkReport = (report: BenchmarkRunReport): string => {
  const { metadata } = report;
  const markdown = [
    "# Benchmark report",
    "",
    metadata.isQuickMode
      ? "Smoke validation only; timings are not performance results."
      : `${metadata.node}; ${metadata.cpu}; ${metadata.platform}/${metadata.arch}.`,
    "",
    "Timings are per complete operation. Setup and validation are outside timing. GC is not forced; small timings include harness overhead. Worker RSS includes fixtures and runtime, not just library allocations. Source fetching uses in-memory responses, not real network latency. These are not browser/mobile guarantees.",
    "",
  ];
  for (const worker of report.reports) {
    markdown.push(
      `## ${worker.format} / ${worker.reactBuild} / ${worker.group}`,
      "",
      `React ${worker.reactVersion}; peak worker RSS ${(worker.maxRssBytes / 1024 / 1024).toFixed(1)} MiB.`,
      "",
      "| Operation | Median µs | Min µs | Max µs | Iterations/sample |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    for (const result of worker.results)
      markdown.push(
        `| ${result.id} | ${result.medianUs.toFixed(3)} | ${result.minUs.toFixed(3)} | ${result.maxUs.toFixed(3)} | ${result.iterations} |`,
      );
    markdown.push("");
  }
  markdown.push(
    "## Cold imports",
    "",
    "Native Node with cold module caches; filesystem caches are not flushed. Process startup and probe compilation are excluded.",
    "",
    "| Format | React build | Entrypoint | Median ms |",
    "| --- | --- | --- | ---: |",
  );
  for (const result of report.imports)
    markdown.push(
      `| ${result.format} | ${result.reactBuild} | ${result.entry} | ${(result.medianUs / 1000).toFixed(3)} |`,
    );
  markdown.push(
    "",
    "## useFiber",
    "",
    "Production React only. Null-rendering components with 0/32 preceding refs. Full update times include reconciliation; compare the matching without-hook baseline.",
    "",
    "| Format | React | Components | Preceding refs | Baseline mount ms | Hook mount ms | Baseline update ms | Hook update ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const worker of report.useFiber) {
    for (const result of worker.results)
      markdown.push(
        `| ${worker.format} | ${result.react} (${result.reactVersion}) | ${result.components} | ${result.precedingHooks} | ${result.baselineMountMs} | ${result.useFiberMountMs} | ${result.baselineUpdateMs} | ${result.useFiberUpdateMs} |`,
      );
  }
  return markdown.join("\n") + "\n";
};
