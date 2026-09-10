import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createIsolatedReactRuntime,
  removeIsolatedReactRuntimes,
} from "../tests/unit/isolated-react-runtime.js";
import {
  getUseFiberConfigurations,
  getUseFiberFixtures,
  type UseFiberWorkerConfiguration,
} from "./use-fiber-fixtures.js";
import {
  readReport,
  verifyUseFiberResult,
  type UseFiberReport,
  type UseFiberResult,
} from "./report.js";
import { runBenchmarkProcess } from "./process.js";
import type { BenchmarkVariant } from "./configuration.js";

export const runUseFiberBenchmarks = (
  format: BenchmarkVariant["format"],
  isQuickMode: boolean,
  onResult: (result: UseFiberResult) => void,
): UseFiberReport => {
  const results: UseFiberResult[] = [];
  try {
    for (const fixture of getUseFiberFixtures(isQuickMode)) {
      const runtime = createIsolatedReactRuntime(fixture);
      const builtEntry = new URL(
        `../dist/index.${format === "esm" ? "js" : "cjs"}`,
        runtime.bippyEntryUrl,
      );
      cpSync(
        fileURLToPath(new URL("../../bippy/dist/", import.meta.url)),
        fileURLToPath(new URL("./", builtEntry)),
        { recursive: true },
      );
      for (const configuration of getUseFiberConfigurations(isQuickMode)) {
        const request: UseFiberWorkerConfiguration = {
          ...configuration,
          react: fixture.label,
          builtEntryUrl: builtEntry.href,
          reactUrl: runtime.reactUrl,
          reactDOMUrl: runtime.reactDOMUrl,
          reactDOMClientUrl: fixture.major >= 18 ? runtime.reactDOMClientUrl : undefined,
          sampleCount: isQuickMode ? 1 : 5,
          updateCount: isQuickMode ? 2 : 5,
        };
        const result = readReport(
          runBenchmarkProcess(
            new URL("./use-fiber-worker.ts", import.meta.url),
            [JSON.stringify(request)],
            "production",
          ),
        );
        verifyUseFiberResult(result);
        assert.equal(result.react, fixture.label);
        assert.equal(result.components, configuration.components);
        assert.equal(result.precedingHooks, configuration.precedingHooks);
        results.push(result);
        onResult(result);
      }
    }
    return { format, results };
  } finally {
    removeIsolatedReactRuntimes();
  }
};
