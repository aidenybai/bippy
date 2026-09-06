import { _fiberRoots, getRDTHook, instrument, type FiberRoot, type ReactRenderer } from "bippy";
import { createRuntimeSnapshot } from "./runtime-snapshot.js";
import type { RuntimeSnapshot } from "./snapshot.js";

export interface CommitRecorder {
  snapshot: () => RuntimeSnapshot;
  commitCount: () => number;
  waitForCommit: (timeoutMs?: number) => Promise<void>;
  dispose: () => void;
}

export interface CommitRecorderOptions {
  /** Restricts recording to matching roots, e.g. by `root.containerInfo`. */
  rootFilter?: (root: FiberRoot) => boolean;
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
  return {
    snapshot: () =>
      createRuntimeSnapshot({
        roots: [...roots].filter((root) => _fiberRoots.has(root)),
        renderer,
      }),
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
