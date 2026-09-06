import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatFiber } from "../fiber/serialize.js";
import { renderFramework } from "../frameworks/render-framework.js";
import { flattenTransparentFibers } from "../frameworks/framework-profile.js";
import { getFrameworkProfile } from "../frameworks/profiles.js";
import { BrowserCapturer, type BrowserCaptureResult } from "../harness/capture-browser.js";
import { compareStaticToRuntime } from "../harness/compare-render.js";
import { countSnapshotFibers, formatRuntimeSnapshot } from "../harness/snapshot.js";
import type { Diagnostic, StaticRenderResult } from "../types.js";
import { DevServer, runCommand } from "./dev-server.js";
import type { CorpusEntry, CorpusResult, CorpusRuntimeSummary } from "./manifest.js";

export interface RunEntryOptions {
  corpusDirectory: string;
  capturer: BrowserCapturer;
  skipInstall?: boolean;
  staticOnly?: boolean;
  log?: (message: string) => void;
}

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const SETUP_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_READY_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SETTLE_MS = 3_000;
const CAPTURE_TIMEOUT_MS = 120_000;

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
  if (head !== entry.revision) {
    throw new Error(
      `${cloneDirectory} is at ${head.slice(0, 10)} but the manifest pins ${entry.revision.slice(0, 10)}`,
    );
  }
  return cloneDirectory;
};

const installMarker = (cloneDirectory: string, entry: CorpusEntry): string =>
  path.join(cloneDirectory, `.bippy-parser-installed-${entry.revision.slice(0, 10)}`);

const summarizeDiagnostics = (diagnostics: Diagnostic[]): { code: string; count: number }[] => {
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

const writeArtifacts = (
  outputDirectory: string,
  entry: CorpusEntry,
  staticResult: StaticRenderResult | null,
  capture: BrowserCaptureResult | null,
  cloneDirectory: string,
): void => {
  mkdirSync(outputDirectory, { recursive: true });
  if (staticResult) {
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.static.txt`),
      formatFiber(staticResult.root, {
        showProps: true,
        showLocations: true,
        showNotes: true,
        rootDirectory: cloneDirectory,
      }),
    );
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.diagnostics.json`),
      JSON.stringify(staticResult.diagnostics, null, 2),
    );
  }
  if (capture) {
    writeFileSync(
      path.join(outputDirectory, `${entry.id}.runtime.json`),
      JSON.stringify(capture.snapshot, null, 2),
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
    anchor: null,
    note: null,
    failure: null,
  };
  const outputDirectory = path.join(options.corpusDirectory, ".out");
  const logPath = path.join(options.corpusDirectory, ".logs", `${entry.id}.log`);
  mkdirSync(path.dirname(logPath), { recursive: true });

  let staticResult: StaticRenderResult | null = null;
  let capture: BrowserCaptureResult | null = null;
  let cloneDirectory: string | null = null;
  try {
    cloneDirectory = ensureClone(entry, options.corpusDirectory, log);
    const workingDirectory = path.join(cloneDirectory, entry.workingDirectory);

    log("static render");
    staticResult = renderFramework(entry, cloneDirectory);
    result.static = {
      stats: staticResult.stats,
      diagnostics: summarizeDiagnostics(staticResult.diagnostics),
    };
    if (options.staticOnly) {
      result.note = "static only";
      return result;
    }

    const marker = installMarker(cloneDirectory, entry);
    if (!options.skipInstall && !existsSync(marker)) {
      log(`install: ${entry.install}`);
      await runCommand({
        command: entry.install,
        cwd: cloneDirectory,
        env: entry.env,
        logPath,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      for (const command of entry.setup ?? []) {
        log(`setup: ${command}`);
        await runCommand({
          command,
          cwd: workingDirectory,
          env: entry.env,
          logPath,
          timeoutMs: SETUP_TIMEOUT_MS,
        });
      }
      writeFileSync(marker, new Date().toISOString());
    }

    log(`dev server: ${entry.dev}`);
    const server = new DevServer({
      command: entry.dev,
      cwd: workingDirectory,
      env: entry.env,
      logPath,
    });
    server.start();
    try {
      await server.waitUntilReady(entry.url, entry.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
      log(`capture ${entry.url}`);
      capture = await options.capturer.capture({
        url: entry.url,
        waitForSelector: entry.waitForSelector,
        settleMs: entry.settleMs ?? DEFAULT_SETTLE_MS,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      });
    } finally {
      await server.stop();
    }
    result.runtime = summarizeRuntime(capture);

    const profile = getFrameworkProfile(entry.framework);
    const comparison = compareStaticToRuntime(
      staticResult,
      flattenTransparentFibers(capture.snapshot, profile),
      {
        ...entry.compare,
        anchor: entry.static.anchor ?? profile.defaultAnchor ?? undefined,
        transparentStaticFibers: profile.transparentStaticFibers,
      },
    );
    result.report = comparison.report;
    result.anchor = comparison.anchor;
    result.note = comparison.note;
    return result;
  } catch (error) {
    result.failure = describeError(error);
    log(`failed: ${result.failure}`);
    return result;
  } finally {
    result.durationMs = Date.now() - startedAt;
    if (cloneDirectory) writeArtifacts(outputDirectory, entry, staticResult, capture, cloneDirectory);
  }
};
