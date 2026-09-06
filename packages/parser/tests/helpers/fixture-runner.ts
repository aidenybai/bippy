import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatFiber, createStaticRenderer, type StaticRenderResult } from "../../src/index.js";
import {
  compareStaticToRuntime,
  createCommitRecorder,
  formatComparisonReport,
  formatRuntimeSnapshot,
  getRootContainer,
  type CompareRenderResult,
  type ComparisonStatus,
  type RuntimeSnapshot,
} from "../../src/harness/index.js";

export interface FixtureManifest {
  entry: string;
  expectedStatus: ComparisonStatus;
  minCoverage: number;
  anchor?: string;
  externalPackages?: string[];
  skipRuntime?: boolean;
  notes?: string;
}

export interface FixtureCase {
  name: string;
  directory: string;
  manifest: FixtureManifest;
}

export interface FixtureRunResult {
  staticResult: StaticRenderResult;
  runtime: RuntimeSnapshot | null;
  comparison: CompareRenderResult | null;
}

const FIXTURES_DIRECTORY = resolve(import.meta.dirname, "../fixtures");
const DEFAULT_MANIFEST: FixtureManifest = {
  entry: "src/main.tsx",
  expectedStatus: "exact",
  minCoverage: 1,
};
const SETTLE_ROUNDS = 5;

const readManifest = (directory: string): FixtureManifest => {
  const manifestPath = join(directory, "fixture.json");
  if (!existsSync(manifestPath)) return DEFAULT_MANIFEST;
  const parsed: Partial<FixtureManifest> = JSON.parse(readFileSync(manifestPath, "utf8"));
  return { ...DEFAULT_MANIFEST, ...parsed };
};

export const listFixtures = (): FixtureCase[] =>
  readdirSync(FIXTURES_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(FIXTURES_DIRECTORY, entry.name);
      return { name: entry.name, directory, manifest: readManifest(directory) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

const flushMacrotasks = async (rounds: number): Promise<void> => {
  for (let round = 0; round < rounds; round++) {
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
  }
};

const mountFixture = async (fixture: FixtureCase): Promise<RuntimeSnapshot> => {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  try {
    const commit = recorder.waitForCommit();
    await import(/* @vite-ignore */ join(fixture.directory, fixture.manifest.entry));
    await commit;
    await flushMacrotasks(SETTLE_ROUNDS);
    return recorder.snapshot();
  } finally {
    recorder.dispose();
  }
};

export const runFixture = async (fixture: FixtureCase): Promise<FixtureRunResult> => {
  const renderer = createStaticRenderer({
    rootDirectory: fixture.directory,
    tsconfigPath: existsSync(join(fixture.directory, "tsconfig.json"))
      ? join(fixture.directory, "tsconfig.json")
      : undefined,
    externalPackageAllowList: fixture.manifest.externalPackages,
  });
  const staticResult = renderer.renderEntry(join(fixture.directory, fixture.manifest.entry));
  if (fixture.manifest.skipRuntime) return { staticResult, runtime: null, comparison: null };
  const runtime = await mountFixture(fixture);
  const comparison = compareStaticToRuntime(staticResult, runtime, {
    anchor: fixture.manifest.anchor,
  });
  return { staticResult, runtime, comparison };
};

export const describeFixtureRun = (fixture: FixtureCase, run: FixtureRunResult): string => {
  const sections = [
    `fixture: ${fixture.name}`,
    `static:\n${formatFiber(run.staticResult.root, { rootDirectory: fixture.directory })}`,
  ];
  if (run.runtime) {
    sections.push(
      `runtime:\n${run.runtime.roots.map((root) => formatRuntimeSnapshot(root)).join("\n")}`,
    );
  }
  if (run.comparison) {
    sections.push(`comparison:\n${formatComparisonReport(run.comparison.report)}`);
    if (run.comparison.note) sections.push(`note: ${run.comparison.note}`);
  }
  if (run.staticResult.diagnostics.length > 0) {
    sections.push(
      `diagnostics:\n${run.staticResult.diagnostics
        .map((diagnostic) => `  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
};
