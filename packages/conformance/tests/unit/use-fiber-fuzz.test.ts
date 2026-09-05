import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  type ReactBuildMode,
  type ReactVersionFixture,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { describeRuntimeFailure, runNodeScript } from "./run-node-script.js";
import type { UseFiberFuzzReport } from "./use-fiber-fuzz-scenario.js";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const fuzzUrl = pathToFileURL(resolve(testsDirectory, "use-fiber-fuzz-scenario.ts")).href;
const buildModes: ReactBuildMode[] = ["development", "production"];
const seeds = [1, 2, 3];
const operationCount = 1_000;

const runFuzz = (
  fixture: ReactVersionFixture,
  mode: ReactBuildMode,
  seed: number,
): UseFiberFuzzReport => {
  const runtime = createIsolatedReactRuntime(fixture);
  const script = `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode)}
    const { runUseFiberFuzz } = await import(${JSON.stringify(fuzzUrl)});
    const report = await runUseFiberFuzz({
      React,
      ReactDOM,
      ReactDOMClient,
      ReactDOMServer,
      isDevelopment: ${JSON.stringify(mode === "development")},
      operationCount: ${operationCount},
      seed: ${seed},
      useFiber: Bippy.useFiber,
    });
    console.log("__REPORT__" + JSON.stringify(report));
    process.exit(0);
  `;
  const result = runNodeScript(script, {
    environment: { NODE_ENV: mode },
    timeout: 240_000,
  });
  const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
  if (result.status !== 0 || !reportLine) {
    throw new Error(describeRuntimeFailure("fuzz runtime failed", result));
  }
  return JSON.parse(reportLine.slice("__REPORT__".length));
};

afterAll(removeIsolatedReactRuntimes);

describe.each(reactVersionFixtures)("React $label useFiber fuzz", (fixture) => {
  describe.each(buildModes)("%s", (mode) => {
    it.each(seeds)(
      `survives ${operationCount} randomized operations with seed %i`,
      (seed) => {
        const report = runFuzz(fixture, mode, seed);
        expect(report.operationCount).toBe(operationCount);
        expect(report.renderCount).toBeGreaterThan(operationCount);
        expect(report.failures.slice(0, 5)).toEqual([]);
      },
      250_000,
    );
  });
});
