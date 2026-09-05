import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  earlyReactVersionFixtures,
  type ReactBuildMode,
  type ReactVersionFixture,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { describeRuntimeFailure, runNodeScript } from "./run-node-script.js";
import type { UseFiberAttackReport } from "./use-fiber-attack-scenarios.js";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const scenariosUrl = pathToFileURL(resolve(testsDirectory, "use-fiber-attack-scenarios.ts")).href;
const buildModes: ReactBuildMode[] = ["development", "production", "profiling"];

const runAttackScenarios = (
  fixture: ReactVersionFixture,
  mode: ReactBuildMode,
): UseFiberAttackReport => {
  const runtime = createIsolatedReactRuntime(fixture);
  const script = `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode)}
    const { runUseFiberAttackScenarios } = await import(${JSON.stringify(scenariosUrl)});
    const report = await runUseFiberAttackScenarios({
      React,
      ReactDOM,
      ReactDOMClient,
      ReactDOMServer,
      isDevelopment: ${JSON.stringify(mode === "development")},
      useFiber: Bippy.useFiber,
    });
    console.log("__REPORT__" + JSON.stringify({ ...report, reactVersion: React.version }));
    process.exit(0);
  `;
  const result = runNodeScript(script, {
    environment: { NODE_ENV: mode === "development" ? "development" : "production" },
    timeout: 120_000,
  });
  const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
  if (result.status !== 0 || !reportLine) {
    throw new Error(describeRuntimeFailure("attack runtime failed", result));
  }
  return JSON.parse(reportLine.slice("__REPORT__".length));
};

afterAll(removeIsolatedReactRuntimes);

describe.each([...earlyReactVersionFixtures, ...reactVersionFixtures])(
  "React $label useFiber attack matrix",
  (fixture) => {
    it.each(buildModes)(
      "returns the exact rendering fiber in %s",
      (mode) => {
        const report = runAttackScenarios(fixture, mode);
        expect(report.scenarioNames.length).toBeGreaterThan(10);
        expect(report.failures).toEqual([]);
      },
      150_000,
    );
  },
);
