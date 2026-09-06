import { join } from "node:path";
import type { MountApi } from "../analyze/mount.js";
import { type VerificationReport, verifySnapshots } from "../harness/verify.js";
import { createStaticRenderer, type StaticRenderResult } from "../renderer.js";
import type { FiberSnapshot, NodeSnapshot } from "../snapshot/types.js";
import { type CaptureOptions, captureRuntimeTree } from "./browser.js";
import { installDependencies, startDevServer } from "./dev-server.js";
import type { CorpusCheckout, LiveTarget } from "./repositories.js";

export interface LiveOptions {
  captureScriptPath: string;
  /** Link into `node_modules`, which live targets have installed. */
  followExternalModules: boolean;
  /** Fiber budget for the static tree. */
  maxFiberCount: number;
  /** Wall-clock budget for the static tree. */
  timeBudgetMs: number;
  onLog?: (message: string) => void;
}

export interface LiveVerification {
  url: string;
  entryFile: string;
  /** The react-dom API the static root was found through; `null` when none was found. */
  mountApi: MountApi | null;
  runtimeRootCount: number;
  commitCount: number;
  /** Comparison of the static root against the largest runtime root. */
  report: VerificationReport | null;
  /** Analyzer diagnostics raised while building the static tree. */
  diagnosticCount: number;
  pageErrors: string[];
  error: string | null;
  durationMs: number;
}

const CAPTURE_TIMING: Omit<CaptureOptions, "captureScriptPath"> = {
  firstCommitTimeoutMs: 60_000,
  settleMs: 2_000,
  maxSettleMs: 20_000,
};

const countFibers = (nodes: NodeSnapshot[]): number => {
  let total = 0;
  for (const node of nodes) {
    if (node.kind !== "fiber") continue;
    total += 1 + countFibers(node.children);
  }
  return total;
};

/** The app's root: React also commits to roots such as portals and devtools overlays. */
const pickLargestRoot = (roots: FiberSnapshot[]): FiberSnapshot | null =>
  roots.reduce<FiberSnapshot | null>(
    (largest, root) =>
      largest === null || countFibers([root]) > countFibers([largest]) ? root : largest,
    null,
  );

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const renderStaticRoot = (
  checkout: CorpusCheckout,
  target: LiveTarget,
  options: LiveOptions,
): { result: StaticRenderResult; mountApi: MountApi } => {
  const renderer = createStaticRenderer({
    rootDirectory: checkout.rootDirectory,
    followExternalModules: options.followExternalModules,
    build: { maxFiberCount: options.maxFiberCount },
    timeBudgetMs: options.timeBudgetMs,
  });
  const entryPath = join(checkout.rootDirectory, target.entryFile);
  const [mount] = renderer.findMountPoints(entryPath);
  if (!mount) throw new Error(`${target.entryFile} has no createRoot/hydrateRoot mount`);
  return { result: renderer.renderValue(mount.element), mountApi: mount.api };
};

/**
 * Boots the checkout's dev server, captures what React committed in a real
 * browser and compares it with the tree derived from the entry module's
 * mount call. Failures at any step are reported, not thrown.
 */
export const verifyLive = async (
  checkout: CorpusCheckout,
  options: LiveOptions,
): Promise<LiveVerification> => {
  const startedAt = performance.now();
  const target = checkout.live;
  if (!target) throw new Error(`${checkout.name} has no live target`);
  const verification: LiveVerification = {
    url: "",
    entryFile: target.entryFile,
    mountApi: null,
    runtimeRootCount: 0,
    commitCount: 0,
    report: null,
    diagnosticCount: 0,
    pageErrors: [],
    error: null,
    durationMs: 0,
  };
  const log = options.onLog ?? (() => {});
  try {
    log("rendering static tree");
    const { result, mountApi } = renderStaticRoot(checkout, target, options);
    verification.mountApi = mountApi;
    verification.diagnosticCount = result.diagnostics.length;
    log(`static tree: ${result.root.fiberCount} fibers, ${result.root.unknownCount} unknown`);

    await installDependencies(checkout, target, log);
    log(`starting dev server: ${target.devCommand}`);
    const server = await startDevServer(checkout, target);
    verification.url = server.url;
    try {
      log(`capturing ${server.url}`);
      const capture = await captureRuntimeTree(server.url, {
        ...CAPTURE_TIMING,
        captureScriptPath: options.captureScriptPath,
      });
      verification.runtimeRootCount = capture.roots.length;
      verification.commitCount = capture.commitCount;
      verification.pageErrors = capture.pageErrors;
      const runtimeRoot = pickLargestRoot(capture.roots);
      if (!runtimeRoot) throw new Error("React committed no roots");
      verification.report = verifySnapshots(result.snapshot, runtimeRoot);
    } finally {
      await server.stop();
    }
  } catch (error) {
    verification.error = getErrorMessage(error);
  }
  verification.durationMs = Math.round(performance.now() - startedAt);
  return verification;
};
