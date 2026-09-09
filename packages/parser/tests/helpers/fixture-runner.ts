import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  RootObservations,
  RuntimeObservations,
  StaticRenderResult,
  StaticRenderStats,
} from "../../src/index.js";
import {
  dropInjectedFibers,
  getFrameworkProfile,
  unwrapTransparentRuntimeFiber,
  renderFrameworkTarget,
  type FrameworkKind,
} from "../../src/frameworks/index.js";
import {
  compareStaticToRuntime,
  createCommitRecorder,
  enumerateStaticStates,
  formatCompareRenderResult,
  formatPattern,
  formatRuntimeSnapshot,
  getRenderPattern,
  getRootContainer,
  type CommitRecorder,
  type CompareRenderResult,
  type ComparisonStatus,
  type RuntimeFiberSnapshot,
  type RuntimeSnapshot,
  type StateSpaceBudget,
} from "../../src/harness/index.js";
import { NODE_TIMER_UNDERRUN_MS } from "../../src/evaluate/timers.js";
import { installReduxStoreHook } from "../../src/harness/redux-store.js";

export interface FixtureManifest {
  entry: string;
  expectedStatus: ComparisonStatus;
  minCoverage: number;
  /** Runtime fibers that must match without wildcards or skipped opaque subtrees. */
  minStrictCoverage?: number;
  framework: FrameworkKind;
  /** URL pathname for routed frameworks; the runtime side navigates here before mounting. */
  route?: string;
  anchor?: string;
  externalPackages?: string[];
  /** Runtime state replayed into the static render, as a live capture would record it. */
  observations?: RuntimeObservations;
  /** Uncertainty the static tree must report exactly, e.g. `{ "branchCount": 1 }`. */
  expectedStats?: Partial<StaticRenderStats>;
  skipRuntime?: boolean;
  /** Bounds on the enumerated state space; defaults are generous enough for every fixture but the budget one. */
  stateSpaceBudget?: Partial<StateSpaceBudget>;
  /** How many concrete states the static render must enumerate. */
  expectedStates?: number;
  /** Whether the enumeration must (true) or must not (false) report omitted states. */
  expectOmitted?: boolean;
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
  /** What the harness read off the fixture's own runtime render. */
  observed: RootObservations;
  comparison: CompareRenderResult | null;
}

interface MountResult {
  snapshot: RuntimeSnapshot;
  observed: RootObservations;
}

const FIXTURES_DIRECTORY = resolve(import.meta.dirname, "../fixtures");
const DEFAULT_MANIFEST: FixtureManifest = {
  entry: "src/main.tsx",
  expectedStatus: "exact",
  minCoverage: 1,
  framework: "spa",
};
const SETTLE_QUIET_MS = 50;
const SETTLE_TIMEOUT_MS = 2_000;

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

/** A Suspense boundary showing its fallback keeps the hidden primary Offscreen next to the fallback fragment. */
const hasSuspendedBoundary = (fiber: RuntimeFiberSnapshot): boolean =>
  (fiber.tag === "SuspenseComponent" && fiber.children.length > 1) ||
  fiber.children.some(hasSuspendedBoundary);

/** Yields until React has been quiet with nothing suspended (lazy imports and data resolve across several macrotasks). */
const settleCommits = async (recorder: CommitRecorder): Promise<void> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let commits = recorder.commitCount();
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
    if (recorder.commitCount() !== commits) {
      commits = recorder.commitCount();
      quietSince = Date.now();
    }
    if (
      Date.now() - quietSince >= SETTLE_QUIET_MS &&
      !recorder.snapshot().roots.some(hasSuspendedBoundary)
    ) {
      return;
    }
  }
};

const mountFixture = async (fixture: FixtureCase): Promise<MountResult> => {
  if (fixture.manifest.route) window.history.replaceState(null, "", fixture.manifest.route);
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
    reduxStores: installReduxStoreHook(window),
  });
  try {
    const commit = recorder.waitForCommit();
    await import(/* @vite-ignore */ join(fixture.directory, fixture.manifest.entry));
    await commit;
    await settleCommits(recorder);
    return { snapshot: recorder.snapshot(), observed: await recorder.observations() };
  } finally {
    recorder.dispose();
  }
};

export const runFixture = async (fixture: FixtureCase): Promise<FixtureRunResult> => {
  const profile = getFrameworkProfile(fixture.manifest.framework);
  const staticResult = await renderFrameworkTarget(
    {
      framework: fixture.manifest.framework,
      entry: join(fixture.directory, fixture.manifest.entry),
      route: fixture.manifest.route,
    },
    {
      rootDirectory: fixture.directory,
      tsconfigPath: join(fixture.directory, "tsconfig.json"),
      externalPackageAllowList: fixture.manifest.externalPackages,
      observations: fixture.manifest.observations,
      settleMs: SETTLE_QUIET_MS,
      timerUnderrunMs: NODE_TIMER_UNDERRUN_MS,
    },
  );
  if (fixture.manifest.skipRuntime) {
    return {
      staticResult,
      runtime: null,
      observed: { queries: [], mutations: [] },
      comparison: null,
    };
  }
  const { snapshot: runtime, observed } = await mountFixture(fixture);
  const stateSpace = enumerateStaticStates(staticResult, {
    anchor: fixture.manifest.anchor ?? profile.defaultAnchor ?? undefined,
    transparentStaticFibers: profile.transparentStaticFibers,
    budget: fixture.manifest.stateSpaceBudget,
  });
  const comparison = compareStaticToRuntime(stateSpace, dropInjectedFibers(runtime, profile), {
    unwrapTransparentRuntimeFiber: (fiber) => unwrapTransparentRuntimeFiber(fiber, profile),
  });
  return { staticResult, runtime, observed, comparison };
};

export const describeFixtureRun = (fixture: FixtureCase, run: FixtureRunResult): string => {
  const sections = [
    `fixture: ${fixture.name}`,
    `static:\n${formatPattern(getRenderPattern(run.staticResult))}`,
  ];
  if (run.runtime) {
    sections.push(
      `runtime:\n${run.runtime.roots.map((root) => formatRuntimeSnapshot(root)).join("\n")}`,
    );
  }
  if (run.comparison) {
    sections.push(`comparison:\n${formatCompareRenderResult(run.comparison)}`);
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
