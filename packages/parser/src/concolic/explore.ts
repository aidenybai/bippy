import { createCommitRecorder, getRootContainer } from "../harness/commit-recorder.js";
import type { RuntimeSnapshot } from "../harness/snapshot.js";
import type { Decision, PinnedDecision } from "./decisions.js";
import type { SymbolicLeak, SymbolicSummary } from "./symbolic.js";
import { createConcolicRealm, type ConcolicRealm, type ConcolicRealmOptions } from "./realm.js";

// Depth-first path enumeration by replay: a path runs the entry in a fresh
// realm under a list of pinned decisions; every fresh decision it records is a
// fork point, and each unexplored alternative becomes a new pinned list whose
// prefix is the decisions taken up to that point.

/** Upper bound on explored paths per entry; forks beyond it are reported as omitted, never silently dropped. */
export const MAX_PATHS = 16;

/** How long a path may keep committing after the entry finished before its tree is taken as settled. */
export const MAX_SETTLE_MS = 20_000;

export interface ConcolicPath {
  index: number;
  pinned: PinnedDecision[];
  decisions: Decision[];
  snapshot: RuntimeSnapshot;
  commits: RuntimeSnapshot[];
  leaks: SymbolicLeak[];
  /** Symbolic values created while the path ran. */
  symbolics: SymbolicSummary[];
  error: string | null;
  pageErrors: string[];
  durationMs: number;
}

export interface OmittedPath {
  pinned: PinnedDecision[];
}

export interface ConcolicExploration {
  paths: ConcolicPath[];
  omitted: OmittedPath[];
  /** Unhandled promise rejections raised by the analyzed program, per path index. */
  rejections: Map<number, string[]>;
}

export interface EntryRunner {
  run: (realm: ConcolicRealm) => Promise<void>;
}

export interface ExploreOptions {
  realm: Omit<ConcolicRealmOptions, "pinned">;
  runner: EntryRunner;
  /** Quiet period without commits after which a path is considered settled. */
  settleMs: number;
  maxPaths?: number;
  onPath?: (path: ConcolicPath) => void;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const runPath = async (
  index: number,
  pinned: PinnedDecision[],
  options: ExploreOptions,
  rejections: string[],
): Promise<ConcolicPath> => {
  const startedAt = Date.now();
  const realm = createConcolicRealm({ ...options.realm, pinned });
  const ownerDocument = realm.window.document;
  const recorder = createCommitRecorder({
    rootFilter: (root) => {
      const container = getRootContainer(root);
      return (
        container === ownerDocument ||
        (typeof container === "object" &&
          container !== null &&
          "ownerDocument" in container &&
          container.ownerDocument === ownerDocument)
      );
    },
    recordCommits: true,
  });
  const onRejection = (reason: unknown): void => {
    rejections.push(describeError(reason));
  };
  process.on("unhandledRejection", onRejection);
  let error: string | null = null;
  try {
    await options.runner.run(realm);
    await settle(recorder.commitCount, options.settleMs);
  } catch (caught) {
    error = describeError(caught);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  const snapshot = recorder.snapshot();
  const commits = recorder.commits();
  recorder.dispose();
  await realm.dispose();
  return {
    index,
    pinned,
    decisions: realm.decisions.recorded,
    snapshot,
    commits,
    leaks: realm.space.leaks,
    symbolics: realm.space.nodes,
    error,
    pageErrors: realm.pageErrors,
    durationMs: Date.now() - startedAt,
  };
};

const settle = async (commitCount: () => number, settleMs: number): Promise<void> => {
  const deadline = Date.now() + MAX_SETTLE_MS;
  let lastCount = commitCount();
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(Math.min(50, settleMs));
    const count = commitCount();
    if (count !== lastCount) {
      lastCount = count;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= settleMs) {
      return;
    }
  }
};

const forksOf = (path: ConcolicPath): PinnedDecision[][] => {
  const forks: PinnedDecision[][] = [];
  const prefix: PinnedDecision[] = [...path.pinned];
  for (const decision of path.decisions) {
    if (!decision.isFresh) continue;
    for (let choice = 0; choice < decision.alternatives; choice++) {
      if (choice === decision.choice) continue;
      forks.push([...prefix, { key: decision.key, choice }]);
    }
    prefix.push({ key: decision.key, choice: decision.choice });
  }
  return forks;
};

export const explorePaths = async (options: ExploreOptions): Promise<ConcolicExploration> => {
  const maxPaths = options.maxPaths ?? MAX_PATHS;
  const paths: ConcolicPath[] = [];
  const rejections = new Map<number, string[]>();
  const pending: PinnedDecision[][] = [[]];
  while (pending.length > 0 && paths.length < maxPaths) {
    const pinned = pending.pop();
    if (!pinned) break;
    const pathRejections: string[] = [];
    const path = await runPath(paths.length, pinned, options, pathRejections);
    if (pathRejections.length > 0) rejections.set(path.index, pathRejections);
    paths.push(path);
    options.onPath?.(path);
    const forks = forksOf(path);
    for (let index = forks.length - 1; index >= 0; index--) pending.push(forks[index]);
  }
  return {
    paths,
    omitted: pending.map((pinned) => ({ pinned })),
    rejections,
  };
};
