import { realpathSync } from "node:fs";
import path from "node:path";
import { getSettleMs, type CorpusEntry } from "../corpus/manifest.js";
import { readProcessEnvironment } from "../corpus/process-environment.js";
import { ensureClone, readSavedCapture } from "../corpus/run-entry.js";
import { FrameworkTargetError } from "../errors.js";
import {
  dropInjectedFibers,
  unwrapTransparentRuntimeFiber,
} from "../frameworks/framework-profile.js";
import { getFrameworkProfile } from "../frameworks/profiles.js";
import type { BrowserCaptureResult } from "../harness/capture-browser.js";
import type { ComparisonReport } from "../harness/compare.js";
import { compareStaticToRuntime, type CompareRenderResult } from "../harness/compare-render.js";
import { ModuleGraph } from "../graph/module-graph.js";
import { ModuleResolver } from "../graph/module-resolver.js";
import { countSnapshotFibers } from "../harness/snapshot.js";
import { findRootRenderCalls } from "../render/find-root-elements.js";
import {
  explorePaths,
  type ConcolicExploration,
  type ConcolicPath,
  type EntryRunner,
} from "./explore.js";
import { createNextAppRunner } from "./next-app-runner.js";
import { createReactRouterRunner } from "./react-router-runner.js";
import { TransformCache } from "./realm.js";
import { assembleStateSpace, type AssembledStateSpace } from "./state-space.js";
import { createSpaRunner } from "./spa-runner.js";
import type { SymbolicLeak } from "./symbolic.js";

export interface ConcolicEntryOptions {
  corpusDirectory: string;
  maxPaths?: number;
  log?: (message: string) => void;
}

export interface LeakSummary {
  kind: SymbolicLeak["kind"];
  count: number;
  examples: string[];
}

export interface ConcolicEntryResult {
  id: string;
  framework: CorpusEntry["framework"];
  status: ComparisonReport["status"] | "failed";
  report: ComparisonReport | null;
  matchedState: number | null;
  runtimeFibers: number;
  states: number;
  pathsExplored: number;
  pathsOmitted: number;
  pathsFailed: number;
  duplicatePaths: number;
  decisions: number;
  forkSites: number;
  symbolics: number;
  leaks: LeakSummary[];
  instrumentedFiles: number;
  externalFiles: number;
  skippedOperations: number;
  hookSites: number;
  failure: string | null;
  note: string | null;
  durationMs: number;
  paths: ConcolicPathSummary[];
}

export interface ConcolicPathSummary {
  index: number;
  pinned: string[];
  decisions: string[];
  fibers: number;
  commits: number;
  leaks: number;
  error: string | null;
  durationMs: number;
}

const MAX_LEAK_EXAMPLES = 5;
/** The dev server resolves the `development` export condition, so the realm executes the same builds it serves. */
const DEV_CONDITION_NAMES = ["browser", "development", "import", "module", "default"];
const DEV_REQUIRE_CONDITION_NAMES = ["browser", "development", "require", "module", "default"];

const summarizeLeaks = (paths: ConcolicPath[]): LeakSummary[] => {
  const byKind = new Map<SymbolicLeak["kind"], LeakSummary>();
  for (const leak of paths.flatMap((pathResult) => pathResult.leaks)) {
    const summary = byKind.get(leak.kind) ?? { kind: leak.kind, count: 0, examples: [] };
    summary.count++;
    const example = `${leak.symbolic} -> ${leak.detail}${leak.site ? ` @ ${leak.site}` : ""}`;
    if (summary.examples.length < MAX_LEAK_EXAMPLES && !summary.examples.includes(example)) {
      summary.examples.push(example);
    }
    byKind.set(leak.kind, summary);
  }
  return [...byKind.values()].sort((left, right) => right.count - left.count);
};

const summarizePath = (pathResult: ConcolicPath): ConcolicPathSummary => ({
  index: pathResult.index,
  pinned: pathResult.pinned.map(({ key, choice }) => `${key}=${choice}`),
  decisions: pathResult.decisions.map(
    (decision) =>
      `${decision.key}=${decision.choice}/${decision.alternatives}${decision.isFresh ? "*" : ""}`,
  ),
  fibers: pathResult.snapshot.roots.reduce((sum, root) => sum + countSnapshotFibers(root), 0),
  commits: pathResult.commits.length,
  leaks: pathResult.leaks.length,
  error: pathResult.error,
  durationMs: pathResult.durationMs,
});

const hasRootRenderCall = (graph: ModuleGraph, rootDirectory: string, entry: string): boolean => {
  const module = graph.getModule(path.resolve(rootDirectory, entry));
  return module !== null && findRootRenderCalls(module).length > 0;
};

const createRunner = (
  entry: CorpusEntry,
  resolver: ModuleResolver,
  rootDirectory: string,
  servedDirectory: string,
): EntryRunner => {
  const graph = new ModuleGraph({ resolver });
  const spaTarget = {
    servedDirectory,
    entry: entry.static.entry ?? null,
    rootComponent: entry.static.rootComponent ?? null,
    bootstrap: entry.static.bootstrap ?? [],
  };
  switch (entry.framework) {
    case "spa":
      return createSpaRunner(spaTarget, rootDirectory);
    case "react-router":
      if (spaTarget.entry !== null && hasRootRenderCall(graph, rootDirectory, spaTarget.entry)) {
        return createSpaRunner(spaTarget, rootDirectory);
      }
      return createReactRouterRunner(
        {
          rootDirectory,
          appDirectory: entry.static.appDirectory ?? null,
          routesModule: spaTarget.entry,
        },
        resolver,
      );
    case "next-app":
      return createNextAppRunner(
        {
          rootDirectory,
          route: entry.static.route ?? "/",
          appDirectory: entry.static.appDirectory ?? null,
        },
        graph,
      );
    case "next-pages":
      throw new FrameworkTargetError("next-pages targets have no concolic route composition yet");
  }
};

export interface ConcolicRun {
  result: ConcolicEntryResult;
  exploration: ConcolicExploration | null;
  stateSpace: AssembledStateSpace | null;
  comparison: CompareRenderResult | null;
  capture: BrowserCaptureResult | null;
}

export const runConcolicEntry = async (
  entry: CorpusEntry,
  options: ConcolicEntryOptions,
): Promise<ConcolicRun> => {
  const startedAt = Date.now();
  const log = options.log ?? (() => {});
  const outputDirectory = path.join(options.corpusDirectory, ".out");
  const result: ConcolicEntryResult = {
    id: entry.id,
    framework: entry.framework,
    status: "failed",
    report: null,
    matchedState: null,
    runtimeFibers: 0,
    states: 0,
    pathsExplored: 0,
    pathsOmitted: 0,
    pathsFailed: 0,
    duplicatePaths: 0,
    decisions: 0,
    forkSites: 0,
    symbolics: 0,
    leaks: [],
    instrumentedFiles: 0,
    externalFiles: 0,
    skippedOperations: 0,
    hookSites: 0,
    failure: null,
    note: null,
    durationMs: 0,
    paths: [],
  };
  const run: ConcolicRun = {
    result,
    exploration: null,
    stateSpace: null,
    comparison: null,
    capture: null,
  };
  try {
    const cloneDirectory = ensureClone(entry, options.corpusDirectory, log);
    const rootDirectory = realpathSync(path.join(cloneDirectory, entry.static.rootDirectory));
    const servedDirectory = entry.static.servedDirectory
      ? path.resolve(rootDirectory, entry.static.servedDirectory)
      : rootDirectory;
    const capture = readSavedCapture(outputDirectory, entry);
    run.capture = capture;
    if (capture) {
      result.runtimeFibers = capture.snapshot.roots.reduce(
        (sum, root) => sum + countSnapshotFibers(root),
        0,
      );
    }
    const resolver = new ModuleResolver({
      tsconfigPath: path.join(rootDirectory, entry.static.tsconfig ?? "tsconfig.json"),
      aliases: Object.fromEntries(
        Object.entries(entry.static.aliases ?? {}).map(([specifier, target]) => [
          specifier,
          path.resolve(rootDirectory, target),
        ]),
      ),
      rootDirectory,
      conditionNames: DEV_CONDITION_NAMES,
      requireConditionNames: DEV_REQUIRE_CONDITION_NAMES,
    });
    const cache = new TransformCache();
    const runner = createRunner(entry, resolver, rootDirectory, servedDirectory);
    const exploration = await explorePaths({
      realm: {
        rootDirectory,
        servedDirectory,
        url: entry.url,
        resolver,
        isApplicationFile: () => true,
        environment: {
          declared: readProcessEnvironment(entry, rootDirectory) ?? null,
          defines: entry.static.defines ?? {},
        },
        cache,
        globals: { ...entry.static.globals, ...capture?.observations.globals },
      },
      runner,
      settleMs: getSettleMs(entry),
      maxPaths: options.maxPaths,
      onPath: (pathResult) => {
        const summary = summarizePath(pathResult);
        log(
          `path ${summary.index}: ${summary.fibers} fibers, ${summary.decisions.length} decisions, ${summary.leaks} leaks, ${summary.durationMs}ms${summary.error ? `, error: ${summary.error.split("\n")[0]}` : ""}`,
        );
      },
    });
    run.exploration = exploration;
    const profile = getFrameworkProfile(entry.framework);
    const anchor = entry.static.anchor ?? profile.defaultAnchor ?? null;
    const stateSpace = assembleStateSpace(exploration, profile, anchor);
    run.stateSpace = stateSpace;
    result.paths = exploration.paths.map(summarizePath);
    result.pathsExplored = exploration.paths.length;
    result.pathsOmitted = exploration.omitted.length;
    result.pathsFailed = exploration.paths.filter((pathResult) => pathResult.error !== null).length;
    result.duplicatePaths = stateSpace.duplicatePaths;
    result.states = stateSpace.states.length;
    result.decisions = exploration.paths.reduce(
      (sum, pathResult) => sum + pathResult.decisions.length,
      0,
    );
    result.forkSites = new Set(
      exploration.paths.flatMap((pathResult) =>
        pathResult.decisions.map((decision) => decision.key),
      ),
    ).size;
    result.symbolics = new Set(
      exploration.paths.flatMap((pathResult) =>
        pathResult.symbolics.map((symbolic) => symbolic.key),
      ),
    ).size;
    result.leaks = summarizeLeaks(exploration.paths);
    result.instrumentedFiles = cache.instrumentedFiles;
    result.externalFiles = cache.externalFiles;
    result.skippedOperations = cache.skippedOperations;
    result.hookSites = cache.sites.locations.length;
    const rejections = [...exploration.rejections.values()].flat();
    if (rejections.length > 0) {
      result.note = `${rejections.length} unhandled rejection(s): ${rejections[0].split("\n")[0]}`;
    }
    if (!capture) {
      result.status = "skipped";
      result.note = [result.note, "no saved capture"].filter((part) => part !== null).join("; ");
      return run;
    }
    const comparison = compareStaticToRuntime(
      stateSpace,
      dropInjectedFibers(capture.snapshot, profile),
      {
        ...entry.compare,
        unwrapTransparentRuntimeFiber: (fiber) => unwrapTransparentRuntimeFiber(fiber, profile),
      },
    );
    run.comparison = comparison;
    result.report = comparison.report;
    result.status = comparison.report.status;
    result.matchedState = comparison.matchedState?.index ?? null;
    if (comparison.note)
      result.note = [result.note, comparison.note].filter((part) => part !== null).join("; ");
    return run;
  } catch (error) {
    result.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return run;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
};
