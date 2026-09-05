import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  verifyBenchmarkCoverage,
  verifyWorkerReport,
  type UseFiberReport,
  type UseFiberResult,
  type WorkerReport,
} from "../benchmarks/report.js";
import {
  getUseFiberConfigurations,
  getUseFiberFixtures,
} from "../benchmarks/use-fiber-fixtures.js";
import { conformanceDirectory, getExpectedExports, repositoryDirectory } from "./test-inventory.js";

interface ImportResult {
  entry: string;
  format: string;
  reactBuild: string;
  sampleUs: number[];
  medianUs: number;
}

const quick = process.argv.includes("--quick");
const formats = ["esm", "cjs"];
const environments = ["development", "production"];
const groups = ["core", "instrumentation", "source", "hooks"];
const reports: WorkerReport[] = [];
const useFiber: UseFiberReport[] = [];
const imports: ImportResult[] = [];
const builtDirectory = new URL("../../bippy/dist/", import.meta.url);
const run = (arguments_: string[], environment: string): string => {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: conformanceDirectory,
    env: {
      ...process.env,
      NODE_ENV: environment,
      TSX_TSCONFIG_PATH: fileURLToPath(new URL("../tsconfig-built.json", import.meta.url)),
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${arguments_.join(" ")}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
};

console.log(
  quick
    ? "Benchmark smoke validation only; timings are not performance results."
    : "Benchmarking built output sequentially; no real network requests.",
);
for (const format of formats) {
  for (const environment of environments) {
    for (const group of groups) {
      const stdout = run(
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("./benchmark-worker.ts", import.meta.url)),
          format,
          group,
          ...(quick ? ["quick"] : []),
        ],
        environment,
      );
      const reportLine = stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
      assert.ok(reportLine, "Worker did not produce a report");
      const report: WorkerReport = JSON.parse(reportLine.slice("__REPORT__".length));
      verifyWorkerReport(report);
      assert.equal(report.group, group);
      assert.equal(report.format, format);
      assert.equal(report.reactBuild, environment);
      for (const inventory of report.exports) {
        assert.deepEqual(
          [...inventory.callable, ...inventory.data].sort(),
          getExpectedExports(inventory.entry),
        );
      }
      reports.push(report);
      console.log(`${format}/${environment}/${group}: ${report.results.length} cases verified`);
    }
    for (const entry of ["index", "source", "install-hook-only"]) {
      const entryUrl = new URL(`${entry}.${format === "esm" ? "js" : "cjs"}`, builtDirectory);
      const sampleUs: number[] = [];
      for (let sample = 0; sample < (quick ? 1 : 7); sample++) {
        const stdout = run(
          [
            "--input-type=module",
            "--eval",
            `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const start = performance.now();
          ${format === "esm" ? `await import(${JSON.stringify(entryUrl.href)});` : `require(${JSON.stringify(fileURLToPath(entryUrl))});`}
          console.log((performance.now() - start) * 1000);
        `,
          ],
          environment,
        );
        const duration = Number(stdout.trim());
        assert.ok(Number.isFinite(duration) && duration >= 0);
        sampleUs.push(duration);
      }
      imports.push({
        entry,
        format,
        reactBuild: environment,
        sampleUs,
        medianUs: sampleUs.toSorted((first, second) => first - second)[
          Math.floor(sampleUs.length / 2)
        ],
      });
    }
  }
  const stdout = run(
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./benchmark-use-fiber.ts", import.meta.url)),
      ...(quick ? ["--quick"] : []),
      ...(format === "cjs" ? ["--cjs"] : []),
    ],
    "production",
  );
  const results: UseFiberResult[] = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const expectedConfigurations = getUseFiberFixtures(quick).flatMap(({ label }) =>
    getUseFiberConfigurations(quick).map(
      ({ components, precedingHooks }) => `${label}/${components}/${precedingHooks}`,
    ),
  );
  assert.deepEqual(
    results
      .map(({ react, components, precedingHooks }) => `${react}/${components}/${precedingHooks}`)
      .sort(),
    expectedConfigurations.sort(),
  );
  for (const result of results) {
    assert.ok(result.components > 0 && result.react && result.reactVersion);
    assert.ok(
      [
        result.useFiberMountMs,
        result.useFiberUpdateMs,
        result.baselineMountMs,
        result.baselineUpdateMs,
      ].every((duration) => Number.isFinite(duration) && duration >= 0),
    );
  }
  useFiber.push({ format, results });
  console.log(`${format}/production/useFiber: ${results.length} configurations verified`);
}

const inventory = reports[0].exports;
for (const format of formats) {
  for (const environment of environments) {
    const measured = new Set(
      reports
        .filter((report) => report.format === format && report.reactBuild === environment)
        .flatMap((report) => report.results.flatMap(({ apis }) => apis)),
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
  reports.flatMap((report) => report.results.flatMap(({ apis }) => apis)),
);
assert.ok(useFiber.every((report) => report.results.length > 0));
allMeasured.add("bippy#useFiber");
verifyBenchmarkCoverage(inventory, allMeasured);
const bundles = readdirSync(builtDirectory)
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
  });
const gitRevision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryDirectory,
  encoding: "utf8",
});
const output = new URL(`../benchmarks/results/${quick ? "smoke" : "latest"}.json`, import.meta.url);
mkdirSync(new URL("./", output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        quick,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        gitRevision: gitRevision.stdout.trim(),
        lockfileSha256: createHash("sha256")
          .update(readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url)))
          .digest("hex"),
        bundles,
      },
      scope: {
        callableExports: inventory.flatMap(({ entry, callable }) =>
          callable.map((name) => `${entry}#${name}`),
        ),
        nonCallableExports: inventory.flatMap(({ entry, data }) =>
          data.map((name) => `${entry}#${name}`),
        ),
        useFiberReactBuild: "production",
        syntheticSourceFetch: true,
      },
      imports,
      reports,
      useFiber,
    },
    null,
    2,
  ) + "\n",
);
const markdown: string[] = [
  "# Benchmark report",
  "",
  quick
    ? "Smoke validation only. These timings are not performance results."
    : `Node ${process.version}; ${cpus()[0]?.model}; ${process.platform}/${process.arch}.`,
  "",
  "All timings are per complete operation, not per node/hook. Fixture setup and verification are outside the timer. Batches run sequentially; GC is not forced. Small measurements include harness overhead.",
  "",
  "Core/source/inspection/listener cases use installed React in development and production. useFiber uses nine React fixtures in production only (one small fixture in smoke mode). Source fetching uses in-memory responses, not network latency. Peak worker RSS includes the harness, fixtures, and runtime; it is not a library allocation or leak measurement.",
  "",
];
for (const report of reports) {
  markdown.push(
    `## ${report.format} / ${report.reactBuild} / ${report.group}`,
    "",
    `React ${report.reactVersion}; peak worker RSS ${(report.maxRssBytes / 1024 / 1024).toFixed(1)} MiB.`,
    "",
    "| Operation | Median µs | Min µs | Max µs | Iterations/sample |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const result of report.results) {
    markdown.push(
      `| ${result.id} | ${result.medianUs.toFixed(3)} | ${result.minUs.toFixed(3)} | ${result.maxUs.toFixed(3)} | ${result.iterations} |`,
    );
  }
  markdown.push("");
}
markdown.push(
  "## Cold entrypoint imports",
  "",
  "Fresh native Node processes; filesystem and dependency loading included, process startup excluded. Filesystem caches are not flushed. These are not browser download times.",
  "",
  "| Format | React build | Entrypoint | Median ms |",
  "| --- | --- | --- | ---: |",
);
for (const result of imports)
  markdown.push(
    `| ${result.format} | ${result.reactBuild} | ${result.entry} | ${(result.medianUs / 1000).toFixed(3)} |`,
  );
markdown.push(
  "",
  "## useFiber",
  "",
  "Null-rendering component workloads. Update times include React reconciliation; compare with the corresponding without-hook baseline. Custom 32-preceding-hook cases use 32 refs before useFiber.",
  "",
  "| Format | React | Components | Preceding hooks | Baseline mount ms | Hook mount ms | Baseline update ms | Hook update ms |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
);
for (const report of useFiber) {
  for (const result of report.results)
    markdown.push(
      `| ${report.format} | ${result.react} (${result.reactVersion}) | ${result.components} | ${result.precedingHooks} | ${result.baselineMountMs} | ${result.useFiberMountMs} | ${result.baselineUpdateMs} | ${result.useFiberUpdateMs} |`,
    );
}
const markdownOutput = new URL(`./${quick ? "smoke" : "latest"}.md`, output);
writeFileSync(markdownOutput, markdown.join("\n") + "\n");
console.log(
  `Verified ${inventory.reduce((count, entry) => count + entry.callable.length, 0)} callable exports; results: ${fileURLToPath(output)}`,
);
console.log(`Readable report: ${fileURLToPath(markdownOutput)}`);
