import { _fiberRoots, getRDTHook, instrument, type FiberRoot, type ReactRenderer } from "bippy";
import type { RootObservations } from "../types.js";
import type { ExportIndex } from "./module-exports.js";
import { readRootObservations } from "./provider-state.js";
import type { ReduxStoreLike } from "./redux-store.js";
import { createRuntimeSnapshot } from "./runtime-snapshot.js";
import type { RuntimeSnapshot } from "./snapshot.js";

export interface CommitRecorder {
  snapshot: () => RuntimeSnapshot;
  /** Library state held by providers in the live roots, as the page's code reads it. */
  observations: () => Promise<RootObservations>;
  commitCount: () => number;
  waitForCommit: (timeoutMs?: number) => Promise<void>;
  dispose: () => void;
}

export interface CommitRecorderOptions {
  /** Restricts recording to matching roots, e.g. by `root.containerInfo`. */
  rootFilter?: (root: FiberRoot) => boolean;
  /** Redux stores the page created outside any react-redux provider (see `installReduxStoreHook`). */
  reduxStores?: () => ReduxStoreLike[] | Promise<ReduxStoreLike[]>;
  /** Exports of the page's loaded modules, so captured state names them instead of serializing them. */
  moduleExports?: () => ExportIndex | Promise<ExportIndex>;
}

const DEFAULT_COMMIT_TIMEOUT_MS = 5_000;

/** The host container a root renders into (`containerInfo` is not part of bippy's public FiberRoot shape). */
export const getRootContainer = (root: FiberRoot): unknown =>
  "containerInfo" in root ? root.containerInfo : null;

// Observes every React commit through bippy's DevTools hook and turns the
// live roots into serializable snapshots. Works in Node (happy-dom) and in
// the browser injection bundle alike.
export const createCommitRecorder = ({
  rootFilter,
  reduxStores,
  moduleExports,
}: CommitRecorderOptions = {}): CommitRecorder => {
  const roots = new Set<FiberRoot>();
  let renderer: ReactRenderer | null = null;
  let commits = 0;
  let commitWaiters: Array<() => void> = [];
  const unsubscribe = instrument({
    name: "bippy-parser-harness",
    onCommitFiberRoot: (rendererId, root) => {
      if (rootFilter && !rootFilter(root)) return;
      roots.add(root);
      renderer = getRDTHook().renderers.get(rendererId) ?? renderer;
      commits++;
      const waiters = commitWaiters;
      commitWaiters = [];
      for (const resolve of waiters) resolve();
    },
  });
  const liveRoots = (): FiberRoot[] => [...roots].filter((root) => _fiberRoots.has(root));
  return {
    snapshot: () => createRuntimeSnapshot({ roots: liveRoots(), renderer }),
    observations: async () =>
      readRootObservations(liveRoots(), await reduxStores?.(), await moduleExports?.()),
    commitCount: () => commits,
    waitForCommit: (timeoutMs = DEFAULT_COMMIT_TIMEOUT_MS) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no React commit observed within ${timeoutMs}ms`)),
          timeoutMs,
        );
        commitWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      }),
    dispose: () => {
      unsubscribe();
      roots.clear();
    },
  };
};
