import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Window } from "happy-dom";
import { createCoreBenchmarks } from "../benchmarks/core.js";
import { createHookBenchmarks } from "../benchmarks/hooks.js";
import { createInstrumentationBenchmarks } from "../benchmarks/instrumentation.js";
import { createSourceBenchmarks } from "../benchmarks/source.js";
import {
  runBenchmark,
  type BenchmarkContext,
  type BenchmarkResult,
} from "../benchmarks/harness.js";

const [format, group, quick] = process.argv.slice(2);
assert.ok(format === "esm" || format === "cjs");
const browser = new Window({ url: "https://bench.example" });
Reflect.set(globalThis, "window", browser);
Reflect.set(globalThis, "document", browser.document);
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("Benchmark attempted a real network request");
};
const require = createRequire(import.meta.url);
for (const entry of ["bippy", "bippy/source"]) {
  const resolved = format === "esm" ? import.meta.resolve(entry) : require.resolve(entry);
  assert.match(resolved, /[/\\]dist[/\\]/, `${entry} must resolve to built output`);
}
const Bippy: BenchmarkContext["Bippy"] =
  format === "esm" ? await import("bippy") : require("bippy");
const Source: BenchmarkContext["Source"] =
  format === "esm" ? await import("bippy/source") : require("bippy/source");
const React: BenchmarkContext["React"] = require("react");
const ReactDOM: BenchmarkContext["ReactDOM"] = require("react-dom");
const ReactDOMClient: BenchmarkContext["ReactDOMClient"] = require("react-dom/client");
const context: BenchmarkContext = { Bippy, Source, React, ReactDOM, ReactDOMClient };
assert.equal(Bippy.getFiber, Bippy.getFiberFromHostInstance);
for (const name of Object.keys(Source).filter((name) => name.startsWith("Bippy"))) {
  assert.equal(Reflect.get(Source, name), Reflect.get(Bippy, name));
}
const factories = {
  core: createCoreBenchmarks,
  instrumentation: createInstrumentationBenchmarks,
  source: createSourceBenchmarks,
  hooks: createHookBenchmarks,
};
assert.ok(
  group === "core" || group === "instrumentation" || group === "source" || group === "hooks",
);
const results: BenchmarkResult[] = [];
try {
  const cases = factories[group](context);
  assert.equal(
    new Set(cases.map(({ id: benchmarkId }) => benchmarkId)).size,
    cases.length,
    "Duplicate benchmark IDs",
  );
  for (const benchmark of cases) {
    try {
      results.push(
        await runBenchmark(benchmark, {
          samples: quick ? 1 : 7,
          targetMs: quick ? 0 : 8,
          maxIterations: quick ? 1 : 262144,
        }),
      );
    } catch (error) {
      throw new Error(`Benchmark failed: ${benchmark.id}`, { cause: error });
    }
  }
  assert.equal(networkAttempts, 0, "Benchmarks must use fixture fetches only");
  const exports = [
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
  }));
  console.log(
    "__REPORT__" +
      JSON.stringify({
        group,
        format,
        reactBuild: process.env.NODE_ENV,
        reactVersion: React.version,
        exports,
        results,
        maxRssBytes: process.resourceUsage().maxRSS * 1024,
      }),
  );
} finally {
  await browser.happyDOM.close();
}
