import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createBrowser } from "../benchmarks/browser.js";
import { getBenchmarkVariant } from "../benchmarks/configuration.js";
import { benchmarkGroups } from "../benchmarks/groups.js";
import {
  runBenchmark,
  type BenchmarkContext,
  type BenchmarkResult,
} from "../benchmarks/harness.js";
import { verifyWorkerReport, writeReport, type WorkerReport } from "../benchmarks/report.js";

const [formatArgument, groupName] = process.argv.slice(2);
const variant = getBenchmarkVariant(formatArgument, process.env.NODE_ENV);
const isQuickMode = process.argv.includes("--quick");
const group = benchmarkGroups.find((candidate) => candidate.name === groupName);
assert.ok(group, "Unknown benchmark group");
const browser = createBrowser();
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("Benchmark attempted a real network request");
};
const require = createRequire(import.meta.url);
try {
  for (const entry of ["bippy", "bippy/source"]) {
    const resolved = variant.format === "esm" ? import.meta.resolve(entry) : require.resolve(entry);
    assert.match(resolved, /[/\\]dist[/\\]/, `${entry} must resolve to built output`);
  }
  const Bippy: BenchmarkContext["Bippy"] =
    variant.format === "esm" ? await import("bippy") : require("bippy");
  const Source: BenchmarkContext["Source"] =
    variant.format === "esm" ? await import("bippy/source") : require("bippy/source");
  const context: BenchmarkContext = {
    Bippy,
    Source,
    React: require("react"),
    ReactDOM: require("react-dom"),
    ReactDOMClient: require("react-dom/client"),
  };
  assert.equal(Bippy.getFiber, Bippy.getFiberFromHostInstance);
  for (const name of Object.keys(Source).filter((name) => name.startsWith("Bippy")))
    assert.equal(Reflect.get(Source, name), Reflect.get(Bippy, name));
  const cases = group.create(context);
  const results: BenchmarkResult[] = [];
  for (const benchmark of cases) {
    try {
      results.push(
        await runBenchmark(benchmark, {
          samples: isQuickMode ? 1 : 7,
          targetMs: isQuickMode ? 0 : 8,
          maxIterations: isQuickMode ? 1 : 262144,
        }),
      );
    } catch (error) {
      throw new Error(`Benchmark failed: ${benchmark.id}`, { cause: error });
    }
  }
  assert.equal(networkAttempts, 0, "Benchmarks must use fixture fetches only");
  const report: WorkerReport = {
    ...variant,
    group: group.name,
    reactVersion: context.React.version,
    results,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    exports: [
      { entry: "bippy", module: Bippy },
      { entry: "bippy/source", module: Source },
    ].map(({ entry, module }) => ({
      entry,
      callable: Object.entries(module)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
        .sort(),
      data: Object.entries(module)
        .filter(([, value]) => typeof value !== "function")
        .map(([name]) => name)
        .sort(),
    })),
  };
  verifyWorkerReport(report);
  writeReport(report);
} finally {
  await browser.happyDOM.close();
}
