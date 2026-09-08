import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { NODE_TIMER_UNDERRUN_MS } from "../../src/evaluate/timers.js";
import { createStaticRenderer, type StaticRenderResult } from "../../src/index.js";
import {
  compareStaticToRuntime,
  createCommitRecorder,
  formatComparisonReport,
  formatPattern,
  formatRuntimeSnapshot,
  getRenderPattern,
  getRootContainer,
  type CompareRenderResult,
  type RuntimeSnapshot,
} from "../../src/harness/index.js";

export interface ComponentFixture {
  name: string;
  filePath: string;
}

export interface ComponentFixtureModule {
  default: ComponentType;
  minCoverage?: number;
}

export interface ComponentRunResult {
  staticResult: StaticRenderResult;
  runtime: RuntimeSnapshot;
  comparison: CompareRenderResult;
  minCoverage: number;
}

export const COMPONENTS_DIRECTORY = resolve(import.meta.dirname, "../components");
const FIXTURE_EXTENSIONS = [".tsx", ".jsx", ".js"];
/** Like the browser capture, the snapshot is taken once commits have been quiet for a while. */
const QUIET_COMMIT_MS = 100;
const MAX_SETTLE_MS = 3_000;

export const listComponentFixtures = (): ComponentFixture[] =>
  readdirSync(COMPONENTS_DIRECTORY, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && FIXTURE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)),
    )
    .map((entry) => ({ name: entry.name, filePath: join(COMPONENTS_DIRECTORY, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));

/** A dev server runs from the project root, which is what the static side takes `process.cwd()` to be. */
const runFromProjectRoot = async <T>(run: () => Promise<T>): Promise<T> => {
  const previousDirectory = process.cwd();
  process.chdir(COMPONENTS_DIRECTORY);
  try {
    return await run();
  } finally {
    process.chdir(previousDirectory);
  }
};

const isComponentModule = (value: unknown): value is ComponentFixtureModule =>
  typeof value === "object" &&
  value !== null &&
  "default" in value &&
  (typeof value.default === "function" ||
    (typeof value.default === "object" && value.default !== null));

const mountComponent = async (Component: ComponentType): Promise<RuntimeSnapshot> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    const startedAt = Date.now();
    let quietCommits = -1;
    while (quietCommits !== recorder.commitCount() && Date.now() - startedAt < MAX_SETTLE_MS) {
      quietCommits = recorder.commitCount();
      await act(async () => {
        await new Promise<void>((resolveQuiet) => setTimeout(resolveQuiet, QUIET_COMMIT_MS));
      });
    }
    return recorder.snapshot();
  } finally {
    await act(async () => root.unmount());
    recorder.dispose();
    container.remove();
  }
};

export const runComponentFixture = async (
  fixture: ComponentFixture,
): Promise<ComponentRunResult> => {
  const loaded: unknown = await runFromProjectRoot(
    () => import(/* @vite-ignore */ pathToFileURL(fixture.filePath).href),
  );
  if (!isComponentModule(loaded)) {
    throw new Error(`${fixture.name} has no default export component`);
  }
  const renderer = createStaticRenderer({
    rootDirectory: COMPONENTS_DIRECTORY,
    tsconfigPath: join(COMPONENTS_DIRECTORY, "tsconfig.json"),
    settleMs: QUIET_COMMIT_MS,
    timerUnderrunMs: NODE_TIMER_UNDERRUN_MS,
  });
  const staticResult = await renderer.renderComponent(fixture.filePath);
  const runtime = await runFromProjectRoot(() => mountComponent(loaded.default));
  const comparison = compareStaticToRuntime(staticResult, runtime);
  return { staticResult, runtime, comparison, minCoverage: loaded.minCoverage ?? 1 };
};

export const describeComponentRun = (fixture: ComponentFixture, run: ComponentRunResult): string =>
  [
    `fixture: ${fixture.name}`,
    `static:\n${formatPattern(getRenderPattern(run.staticResult))}`,
    `runtime:\n${run.runtime.roots.map((root) => formatRuntimeSnapshot(root)).join("\n")}`,
    `comparison:\n${formatComparisonReport(run.comparison.report)}`,
    ...(run.staticResult.diagnostics.length > 0
      ? [
          `diagnostics:\n${run.staticResult.diagnostics
            .map(
              (diagnostic) =>
                `  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
            )
            .join("\n")}`,
        ]
      : []),
  ].join("\n\n");
