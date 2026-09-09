import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CorpusRevisionError, NoCommitsError, parseWithSchema } from "../errors.js";
import { renderFramework } from "../frameworks/render-framework.js";
import {
  dropInjectedFibers,
  unwrapTransparentRuntimeFiber,
} from "../frameworks/framework-profile.js";
import { getFrameworkProfile } from "../frameworks/profiles.js";
import { BrowserCapturer, type BrowserCaptureResult } from "../harness/capture-browser.js";
import {
  compareStaticToRuntime,
  enumerateStaticStates,
  summarizeStateSpace,
} from "../harness/compare-render.js";
import { rankWildcards } from "../harness/format-report.js";
import { countSnapshotFibers, formatRuntimeSnapshot, readSnapshot } from "../harness/snapshot.js";
import { formatPattern, getRenderPattern } from "../harness/static-pattern.js";
import { readObservationsJson } from "../observations.js";
import type { Diagnostic, StaticRenderResult } from "../types.js";
import { DevServer, runCommand } from "./dev-server.js";
import {
  getSettleMs,
  type CorpusEntry,
  type CorpusResult,
  type CorpusRuntimeSummary,
  type DiagnosticCount,
} from "./manifest.js";

export interface RunEntryOptions {
  corpusDirectory: string;
  /** Helper scripts manifest commands may call through `$BIPPY_CORPUS_SCRIPTS`. */
  scriptsDirectory: string;
  capturer: BrowserCapturer;
  skipInstall?: boolean;
  staticOnly?: boolean;
  log?: (message: string) => void;
}

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const SETUP_TIMEOUT_MS = 20 * 60_000;
const SERVICE_TIMEOUT_MS = 5 * 60_000;

const getCommandEnv = (entry: CorpusEntry, scriptsDirectory: string): Record<string, string> => ({
  ...entry.env,
  BIPPY_CORPUS_SCRIPTS: scriptsDirectory,
});
const DEFAULT_READY_TIMEOUT_MS = 5 * 60_000;
const CAPTURE_TIMEOUT_MS = 120_000;
const MAX_RECORDED_WILDCARDS = 10;

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const ensureClone = (
  entry: CorpusEntry,
  corpusDirectory: string,
  log: (message: string) => void,
): string => {
  const cloneDirectory = path.join(corpusDirectory, entry.id);
  if (!existsSync(path.join(cloneDirectory, ".git"))) {
    log(`cloning ${entry.repository} @ ${entry.revision.slice(0, 10)}`);
    mkdirSync(cloneDirectory, { recursive: true });
    git(cloneDirectory, ["init", "--quiet"]);
    git(cloneDirectory, ["remote", "add", "origin", entry.repository]);
    git(cloneDirectory, ["fetch", "--quiet", "--depth", "1", "origin", entry.revision]);
    git(cloneDirectory, ["checkout", "--quiet", "FETCH_HEAD"]);
  }
  const head = git(cloneDirectory, ["rev-parse", "HEAD"]);
  if (head !== entry.revision) throw new CorpusRevisionError(cloneDirectory, head, entry.revision);
  return cloneDirectory;
};

const installMarker = (cloneDirectory: string, entry: CorpusEntry): string =>
  path.join(cloneDirectory, `.bippy-parser-installed-${entry.revision.slice(0, 10)}`);

export const ensureInstalled = async (
  entry: CorpusEntry,
  cloneDirectory: string,
  scriptsDirectory: string,
  logPath: string,
  log: (message: string) => void,
): Promise<void> => {
  const marker = installMarker(cloneDirectory, entry);
  if (existsSync(marker)) return;
  mkdirSync(path.dirname(logPath), { recursive: true });
  const env = getCommandEnv(entry, scriptsDirectory);
  log(`install: ${entry.install}`);
  await runCommand({
    command: entry.install,
    cwd: cloneDirectory,
    env,
    logPath,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  await startServices(entry, cloneDirectory, scriptsDirectory, logPath, log);
  for (const command of entry.setup ?? []) {
    log(`setup: ${command}`);
    await runCommand({
      command,
      cwd: path.join(cloneDirectory, entry.workingDirectory),
      env,
      logPath,
      timeoutMs: SETUP_TIMEOUT_MS,
    });
  }
  writeFileSync(marker, new Date().toISOString());
};

const startServices = async (
  entry: CorpusEntry,
  cloneDirectory: string,
  scriptsDirectory: string,
  logPath: string,
  log: (message: string) => void,
): Promise<void> => {
  for (const command of entry.services ?? []) {
    log(`service: ${command}`);
    await runCommand({
      command,
      cwd: cloneDirectory,
      env: getCommandEnv(entry, scriptsDirectory),
      logPath,
      timeoutMs: SERVICE_TIMEOUT_MS,
    });
  }
};

export const installLogPath = (corpusDirectory: string, entry: CorpusEntry): string =>
  path.join(corpusDirectory, ".logs", `${entry.id}.log`);

const summarizeDiagnostics = (diagnostics: Diagnostic[]): DiagnosticCount[] => {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count);
};

const summarizeRuntime = (capture: BrowserCaptureResult): CorpusRuntimeSummary => ({
  reactVersion: capture.snapshot.reactVersion,
  rendererName: capture.snapshot.rendererName,
  buildType: capture.snapshot.buildType,
  roots: capture.snapshot.roots.length,
  fibers: capture.snapshot.roots.reduce((sum, root) => sum + countSnapshotFibers(root), 0),
  commits: capture.commits,
  pageErrors: capture.pageErrors,
  title: capture.title,
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const capturePath = (outputDirectory: string, entry: CorpusEntry): string =>
  path.join(outputDirectory, `${entry.id}.capture.json`);

// Captures written before observations were grouped kept `globals` at the top level.
const savedCaptureSchema = z.object({
  revision: z.string(),
  snapshot: z.unknown(),
  commits: z.number(),
  pageErrors: z.array(z.string()),
  title: z.string(),
  observations: z.unknown().optional(),
  globals: z.unknown().optional(),
});

// A browser capture saved by an earlier live run; static-only passes replay it so
// evaluator changes are re-verified against the same runtime tree without a dev server.
const readSavedCapture = (
  outputDirectory: string,
  entry: CorpusEntry,
): BrowserCaptureResult | null => {
  const filePath = capturePath(outputDirectory, entry);
  if (!existsSync(filePath)) return null;
  const saved = parseWithSchema(
    savedCaptureSchema,
    JSON.parse(readFileSync(filePath, "utf8")),
    filePath,
  );
  if (saved.revision !== entry.revision) return null;
  return {
    snapshot: readSnapshot(saved.snapshot),
    commits: saved.commits,
    pageErrors: saved.pageErrors,
    title: saved.title,
    observations: readObservationsJson(
      saved.observations ?? { globals: saved.globals },
      `${filePath} observations`,
    ),
  };
};

const captureLive = async (
  entry: CorpusEntry,
  cloneDirectory: string,
  options: RunEntryOptions,
  logPath: string,
  log: (message: string) => void,
): Promise<BrowserCaptureResult> => {
  if (options.skipInstall) {
    await startServices(entry, cloneDirectory, options.scriptsDirectory, logPath, log);
  } else {
    await ensureInstalled(entry, cloneDirectory, options.scriptsDirectory, logPath, log);
  }
  log(`dev server: ${entry.dev}`);
  const server = new DevServer({
    command: entry.dev,
    cwd: path.join(cloneDirectory, entry.workingDirectory),
    env: getCommandEnv(entry, options.scriptsDirectory),
    logPath,
  });
  server.start();
  try {
    await server.waitUntilReady(entry.url, entry.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    log(`capture ${entry.url}`);
    return await options.capturer.capture({
      url: entry.url,
      waitForSelector: entry.waitForSelector,
      settleMs: getSettleMs(entry),
      timeoutMs: CAPTURE_TIMEOUT_MS,
      globals: entry.capturedGlobals,
    });
  } finally {
    await server.stop();
  }
};

const compareEntry = (
  entry: CorpusEntry,
  staticResult: StaticRenderResult,
  capture: BrowserCaptureResult,
  result: CorpusResult,
): void => {
  const profile = getFrameworkProfile(entry.framework);
  const stateSpace = enumerateStaticStates(staticResult, {
    anchor: entry.static.anchor ?? profile.defaultAnchor ?? undefined,
    transparentStaticFibers: profile.transparentStaticFibers,
    runtimeReactVersion: capture.snapshot.reactVersion,
  });
  const comparison = compareStaticToRuntime(
    stateSpace,
    dropInjectedFibers(capture.snapshot, profile),
    {
      ...entry.compare,
      unwrapTransparentRuntimeFiber: (fiber) => unwrapTransparentRuntimeFiber(fiber, profile),
    },
  );
  result.runtime = summarizeRuntime(capture);
  result.report = {
    ...comparison.report,
    wildcards: rankWildcards(comparison.report.wildcards, MAX_RECORDED_WILDCARDS),
  };
  result.stateSpace = summarizeStateSpace(comparison);
  result.anchor = stateSpace.anchor;
  result.note = comparison.note;
};

const writeArtifacts = (
  outputDirectory: string,
  entry: CorpusEntry,
  staticResult: StaticRenderResult | null,
  capture: BrowserCaptureResult | null,
): void => {
  mkdirSync(outputDirectory, { recursive: true });
  if (staticResult) {
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.static.txt`),
      formatPattern(getRenderPattern(staticResult)),
    );
    if (process.env.BIPPY_DEBUG_STATIC_JSON)
      writeFileSync(
        path.join(outputDirectory, `${entry.id}.static.json`),
        JSON.stringify(staticResult.snapshot),
      );
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.diagnostics.json`),
      JSON.stringify(staticResult.diagnostics, null, 2),
    );
  }
  if (capture && capture.commits > 0) {
    writeFileSync(
      capturePath(outputDirectory, entry),
      JSON.stringify({ revision: entry.revision, ...capture }, null, 2),
    );
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.runtime.txt`),
      capture.snapshot.roots.map((root) => formatRuntimeSnapshot(root)).join("\n\n"),
    );
  }
};

export const runCorpusEntry = async (
  entry: CorpusEntry,
  options: RunEntryOptions,
): Promise<CorpusResult> => {
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  const result: CorpusResult = {
    id: entry.id,
    revision: entry.revision,
    framework: entry.framework,
    capturedAt: new Date().toISOString(),
    durationMs: 0,
    runtime: null,
    static: null,
    report: null,
    stateSpace: null,
    anchor: null,
    note: null,
    failure: null,
  };
  const outputDirectory = path.join(options.corpusDirectory, ".out");
  const logPath = installLogPath(options.corpusDirectory, entry);
  mkdirSync(path.dirname(logPath), { recursive: true });

  let staticResult: StaticRenderResult | null = null;
  let capture: BrowserCaptureResult | null = null;
  let cloneDirectory: string | null = null;
  // The runtime is captured first so what the page fetched (bootstrap payloads,
  // query caches) can be handed to the static render as observed inputs.
  const renderStatic = async (
    directory: string,
    runtime: BrowserCaptureResult | null,
  ): Promise<StaticRenderResult> => {
    log("static render");
    staticResult = await renderFramework(entry, directory, runtime?.observations);
    result.static = {
      stats: staticResult.stats,
      diagnostics: summarizeDiagnostics(staticResult.diagnostics),
    };
    return staticResult;
  };
  try {
    cloneDirectory = ensureClone(entry, options.corpusDirectory, log);
    if (options.staticOnly) {
      const saved = readSavedCapture(outputDirectory, entry);
      if (!saved) {
        await renderStatic(cloneDirectory, null);
        result.note = "static only";
        return result;
      }
      log(`replaying capture from ${saved.snapshot.capturedAt}`);
      compareEntry(entry, await renderStatic(cloneDirectory, saved), saved, result);
      result.note = [result.note, `runtime replayed from ${saved.snapshot.capturedAt}`]
        .filter((part) => part !== null)
        .join("; ");
      return result;
    }
    try {
      capture = await captureLive(entry, cloneDirectory, options, logPath, log);
    } catch (error) {
      await renderStatic(cloneDirectory, null);
      throw error;
    }
    if (capture.commits === 0) {
      await renderStatic(cloneDirectory, null);
      throw new NoCommitsError(entry.url, capture.title, capture.pageErrors);
    }
    compareEntry(entry, await renderStatic(cloneDirectory, capture), capture, result);
    return result;
  } catch (error) {
    result.failure = describeError(error);
    log(`failed: ${result.failure}`);
    return result;
  } finally {
    result.durationMs = Date.now() - startedAt;
    if (cloneDirectory) writeArtifacts(outputDirectory, entry, staticResult, capture);
  }
};
