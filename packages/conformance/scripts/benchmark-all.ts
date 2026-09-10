import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { benchmarkBuilds, benchmarkFormats } from "../benchmarks/configuration.js";
import { benchmarkGroups } from "../benchmarks/groups.js";
import { createBenchmarkJournal } from "../benchmarks/journal.js";
import { runBenchmarkProcess } from "../benchmarks/process.js";
import {
  readReport,
  verifyBenchmarkCoverage,
  verifyWorkerReport,
  type BenchmarkRunReport,
  type RunMetadata,
} from "../benchmarks/report.js";
import { getSampleStatistics } from "../benchmarks/statistics.js";
import { runUseFiberBenchmarks } from "../benchmarks/use-fiber.js";
import { getExpectedExports, repositoryDirectory } from "./test-inventory.js";

const isQuickMode = process.argv.includes("--quick");
const builtDirectory = new URL("../../bippy/dist/", import.meta.url);
const gitRevision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryDirectory,
  encoding: "utf8",
});
assert.equal(gitRevision.status, 0, gitRevision.stderr);
const metadata: RunMetadata = {
  timestamp: new Date().toISOString(),
  isQuickMode,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  gitRevision: gitRevision.stdout.trim(),
  lockfileSha256: createHash("sha256")
    .update(readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url)))
    .digest("hex"),
  bundles: readdirSync(builtDirectory)
    .filter((name) => /\.(js|cjs)$/.test(name))
    .sort()
    .map((name) => {
      const content = readFileSync(new URL(name, builtDirectory));
      return {
        name,
        bytes: content.byteLength,
        gzipBytes: gzipSync(content).byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }),
};
const journal = createBenchmarkJournal(
  new URL("../benchmarks/results/", import.meta.url),
  metadata,
);
console.log(
  isQuickMode
    ? "Smoke validation only; timings are not performance results."
    : "Benchmarking built output sequentially; no real network requests.",
);
console.log(`Progress journal: ${fileURLToPath(journal.progress)}`);
const nativeProbe = new URL("import-worker.mjs", journal.directory);
writeFileSync(
  nativeProbe,
  ts.transpileModule(
    readFileSync(new URL("../benchmarks/import-worker.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
);
const report: BenchmarkRunReport = {
  schemaVersion: 2,
  metadata,
  imports: [],
  reports: [],
  useFiber: [],
  scope: {
    callableExports: [],
    nonCallableExports: [],
    useFiberReactBuild: "production",
    syntheticSourceFetch: true,
  },
};
for (const format of benchmarkFormats) {
  for (const reactBuild of benchmarkBuilds) {
    for (const group of benchmarkGroups) {
      const result = readReport(
        runBenchmarkProcess(
          new URL("./benchmark-worker.ts", import.meta.url),
          [format, group.name, ...(isQuickMode ? ["--quick"] : [])],
          reactBuild,
        ),
      );
      verifyWorkerReport(result);
      assert.equal(result.format, format);
      assert.equal(result.reactBuild, reactBuild);
      assert.equal(result.group, group.name);
      for (const inventory of result.exports)
        assert.deepEqual(
          [...inventory.callable, ...inventory.data].sort(),
          getExpectedExports(inventory.entry),
        );
      journal.append({ kind: "worker", data: result });
      report.reports.push(result);
      console.log(`${format}/${reactBuild}/${group.name}: ${result.results.length} cases verified`);
    }
    for (const entry of ["index", "source", "install-hook-only"]) {
      const entryUrl = new URL(`${entry}.${format === "esm" ? "js" : "cjs"}`, builtDirectory);
      const sampleUs = Array.from({ length: isQuickMode ? 1 : 7 }, () =>
        Number(runBenchmarkProcess(nativeProbe, [format, entryUrl.href], reactBuild, true).trim()),
      );
      const result = {
        entry,
        format,
        reactBuild,
        sampleUs,
        medianUs: getSampleStatistics(sampleUs).median,
      };
      journal.append({ kind: "import", data: result });
      report.imports.push(result);
    }
  }
  report.useFiber.push(
    runUseFiberBenchmarks(format, isQuickMode, (result) => {
      journal.append({ kind: "useFiber", data: { format, result } });
      console.log(
        `${format}/production/useFiber/${result.react}: ${result.components} components, ${result.precedingHooks} preceding refs verified`,
      );
    }),
  );
}
const inventory = report.reports[0].exports;
for (const format of benchmarkFormats) {
  for (const reactBuild of benchmarkBuilds) {
    const measured = new Set(
      report.reports
        .filter((result) => result.format === format && result.reactBuild === reactBuild)
        .flatMap((result) => result.results.flatMap(({ apis }) => apis)),
    );
    verifyBenchmarkCoverage(
      inventory.map((entry) => ({
        ...entry,
        callable: entry.callable.filter((name) => name !== "useFiber"),
      })),
      measured,
    );
  }
}
const allMeasured = new Set(
  report.reports.flatMap((result) => result.results.flatMap(({ apis }) => apis)),
);
assert.ok(report.useFiber.every((result) => result.results.length > 0));
allMeasured.add("bippy#useFiber");
verifyBenchmarkCoverage(inventory, allMeasured);
report.scope.callableExports = inventory.flatMap(({ entry, callable }) =>
  callable.map((name) => `${entry}#${name}`),
);
report.scope.nonCallableExports = inventory.flatMap(({ entry, data }) =>
  data.map((name) => `${entry}#${name}`),
);
journal.complete(report);
console.log(
  `Verified ${allMeasured.size} callable exports; reports: ${fileURLToPath(journal.directory)}`,
);
