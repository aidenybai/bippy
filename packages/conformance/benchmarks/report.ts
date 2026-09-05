import assert from "node:assert/strict";
import type { BenchmarkResult } from "./harness.js";

export interface ExportInventory {
  entry: string;
  callable: string[];
  data: string[];
}

export interface WorkerReport {
  group: string;
  format: string;
  reactBuild: string;
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
  format: string;
  results: UseFiberResult[];
}

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

export const verifyWorkerReport = (report: WorkerReport): void => {
  assert.ok(report.results.length > 0, "Empty benchmark group");
  assert.equal(
    new Set(report.results.map(({ id: benchmarkId }) => benchmarkId)).size,
    report.results.length,
  );
  for (const result of report.results) {
    assert.ok(result.iterations > 0 && Number.isInteger(result.iterations));
    assert.equal(result.samples, result.sampleUs.length);
    assert.ok(result.samples > 0);
    assert.ok(result.sampleUs.every((duration) => Number.isFinite(duration) && duration >= 0));
    assert.ok(result.minUs <= result.medianUs && result.medianUs <= result.maxUs);
  }
};
