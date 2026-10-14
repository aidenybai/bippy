import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { packageDirectory } from "../../scripts/test-inventory";
import { it } from "vitest";
import { readReport, verifyUseFiberResult } from "../../benchmarks/report";
import type { UseFiberWorkerConfiguration } from "../../benchmarks/use-fiber-fixtures";
import {
  createIsolatedReactRuntime,
  earlyReactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime";

it("flushes the typed worker report and exits despite early React scheduler ports", () => {
  const fixture = earlyReactVersionFixtures[0];
  const runtime = createIsolatedReactRuntime(fixture);
  const configuration: UseFiberWorkerConfiguration = {
    react: fixture.label,
    builtEntryUrl: runtime.bippyEntryUrl,
    reactUrl: runtime.reactUrl,
    reactDOMUrl: runtime.reactDOMUrl,
    components: 2,
    precedingHooks: 0,
    sampleCount: 1,
    updateCount: 1,
  };
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(packageDirectory, "benchmarks/use-fiber-worker.ts"),
        JSON.stringify(configuration),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          TSX_TSCONFIG_PATH: join(packageDirectory, "tsconfig-built.json"),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    const report = readReport(result.stdout);
    verifyUseFiberResult(report);
    assert.equal(report.reactVersion, fixture.label);
    assert.equal(report.components, 2);
  } finally {
    removeIsolatedReactRuntimes();
  }
}, 15000);
