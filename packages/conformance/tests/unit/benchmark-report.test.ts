import { expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as Source from "../../../bippy/src/source/index.js";
import { createSourceBenchmarks } from "../../benchmarks/source.js";
import { createBenchmarkJournal } from "../../benchmarks/journal.js";
import {
  readReport,
  verifyWorkerReport,
  verifyUseFiberResult,
  type WorkerReport,
  type RunMetadata,
  type BenchmarkRunReport,
} from "../../benchmarks/report.js";
import { getSampleStatistics } from "../../benchmarks/statistics.js";

const createReport = (): WorkerReport => ({
  format: "esm",
  reactBuild: "production",
  group: "core",
  reactVersion: "19",
  exports: [],
  maxRssBytes: 1,
  results: [
    {
      id: "test",
      apis: [],
      units: 1,
      iterations: 1,
      samples: 3,
      sampleUs: [1, 2, 3],
      minUs: 1,
      medianUs: 2,
      maxUs: 3,
    },
  ],
});

it("verifies summary statistics against samples, not JavaScript coercion", () => {
  const report = createReport();
  expect(() => verifyWorkerReport(report)).not.toThrow();
  for (const field of ["minUs", "medianUs", "maxUs"]) {
    for (const value of [null, undefined, NaN, Infinity, -1, "2", 999]) {
      expect(() =>
        verifyWorkerReport({ ...report, results: [{ ...report.results[0], [field]: value }] }),
      ).toThrow();
    }
  }
});

it("rejects invalid report structure, samples and duplicate identifiers", () => {
  for (const value of [
    null,
    [],
    {},
    { ...createReport(), exports: [null] },
    { ...createReport(), format: "typo" },
  ])
    expect(() => verifyWorkerReport(value)).toThrow();
  for (const sampleUs of [[], [NaN], [Infinity], [null], ["1"], [-1]]) {
    expect(() =>
      verifyWorkerReport({
        ...createReport(),
        results: [{ ...createReport().results[0], sampleUs }],
      }),
    ).toThrow();
  }
  expect(() =>
    verifyWorkerReport({
      ...createReport(),
      results: [createReport().results[0], createReport().results[0]],
    }),
  ).toThrow();
  expect(() =>
    verifyUseFiberResult({
      react: "19",
      reactVersion: "19",
      components: 1,
      precedingHooks: 0,
      baselineMountMs: null,
    }),
  ).toThrow();
});

it("uses one report envelope and one statistics implementation", () => {
  expect(readReport('progress\n__REPORT__{"value":1}\n')).toEqual({ value: 1 });
  expect(() => readReport("progress")).toThrow();
  expect(() => readReport("__REPORT__{}\n__REPORT__{}")).toThrow();
  expect(getSampleStatistics([3, 1, 2])).toEqual({ min: 1, median: 2, max: 3 });
  expect(getSampleStatistics([4, 1])).toEqual({ min: 1, median: 2.5, max: 4 });
});

it("cannot pass a tail source-content benchmark by returning the first source", () => {
  const benchmark = createSourceBenchmarks({ Source }).find(
    ({ id: benchmarkId }) => benchmarkId === "getSourceContentFromSourceMap/tail-10000",
  );
  expect(benchmark).toBeDefined();
  if (!benchmark) throw new Error("Missing content benchmark");
  expect(() => benchmark.verify("export const value = 0;")).toThrow();
  expect(() => benchmark.verify(benchmark.run(0))).not.toThrow();
});

it("keeps completed groups after failure and only replaces latest output on completion", () => {
  const directory = pathToFileURL(mkdtempSync(join(tmpdir(), "bippy-benchmark-journal-")) + "/");
  const metadata: RunMetadata = {
    timestamp: "test",
    isQuickMode: false,
    node: "test",
    platform: "test",
    arch: "test",
    gitRevision: "test",
    lockfileSha256: "test",
    bundles: [],
  };
  try {
    const journal = createBenchmarkJournal(directory, metadata);
    journal.append({ kind: "worker", data: createReport() });
    expect(readFileSync(journal.progress, "utf8").trim().split("\n")).toHaveLength(2);
    expect(existsSync(new URL("latest.json", directory))).toBe(false);
    const report: BenchmarkRunReport = {
      schemaVersion: 2,
      metadata,
      reports: [createReport()],
      imports: [],
      useFiber: [],
      scope: {
        callableExports: [],
        nonCallableExports: [],
        useFiberReactBuild: "production",
        syntheticSourceFetch: true,
      },
    };
    journal.complete(report);
    const successful = readFileSync(new URL("latest.json", directory), "utf8");
    const interrupted = createBenchmarkJournal(directory, metadata);
    interrupted.append({ kind: "worker", data: createReport() });
    expect(readFileSync(new URL("latest.json", directory), "utf8")).toBe(successful);
    expect(readFileSync(interrupted.progress, "utf8")).toContain('"kind":"worker"');
    expect(readFileSync(interrupted.progress, "utf8")).not.toContain('"kind":"complete"');
    expect(readFileSync(journal.progress, "utf8")).toContain('"kind":"complete"');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
