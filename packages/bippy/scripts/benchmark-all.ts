import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { benchmarkBuilds, benchmarkFormats } from "../benchmarks/configuration";
import { benchmarkGroups } from "../benchmarks/groups";
import { createBenchmarkJournal } from "../benchmarks/journal";
import { runBenchmarkProcess } from "../benchmarks/process";
import {
  readReport,
  verifyBenchmarkCoverage,
  verifyWorkerReport,
  type BenchmarkRunReport,
  type RunMetadata,
} from "../benchmarks/report";
import { getSampleStatistics } from "../benchmarks/statistics";
import { runUseFiberBenchmarks } from "../benchmarks/use-fiber";
import { getExpectedExports, repositoryDirectory } from "./test-inventory";

const isQuickMode = process.argv.includes("--quick");
const builtDirectory = new URL("../dist/", import.meta.url);
const metadata: RunMetadata = {
  timestamp: new Date().toISOString(),
  isQuickMode,
  runtime: `Bun ${Bun.version}`,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  gitRevision: (await $`git rev-parse HEAD`.cwd(repositoryDirectory).text()).trim(),
  lockfileSha256: new Bun.CryptoHasher("sha256")
    .update(await Bun.file(new URL("../../../bun.lock", import.meta.url)).bytes())
    .digest("hex"),
  bundles: await Promise.all(
    readdirSync(builtDirectory)
      .filter((name) => /\.(js|cjs)$/.test(name))
      .sort()
      .map(async (name) => {
        const content = await Bun.file(new URL(name, builtDirectory)).bytes();
        return {
          name,
          bytes: content.byteLength,
          gzipBytes: Bun.gzipSync(content).byteLength,
          sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
        };
      }),
  ),
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
const importProbe = new URL("../benchmarks/import-worker.ts", import.meta.url);
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
        Number(runBenchmarkProcess(importProbe, [format, entryUrl.href], reactBuild).trim()),
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
