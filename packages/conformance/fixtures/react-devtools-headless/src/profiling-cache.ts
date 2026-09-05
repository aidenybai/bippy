import type { CommitTree } from "./profiling-commit-tree.js";

export interface ProfilingCacheCommit {
  contexts?: unknown[];
  duration: number;
  hookValues?: unknown[];
  tree: CommitTree;
  updaterUids?: string[];
}

export interface ProfilingCache {
  addCommit: (rootUid: string, commit: ProfilingCacheCommit) => void;
  getCommit: (rootUid: string, commitIndex: number) => ProfilingCacheCommit | undefined;
  getCommitCount: (rootUid: string) => number;
}

export const createProfilingCache = (): ProfilingCache => {
  const commitsByRoot = new Map<string, ProfilingCacheCommit[]>();
  return {
    addCommit: (rootUid, commit) => {
      const commits = commitsByRoot.get(rootUid) ?? [];
      commits.push(commit);
      commitsByRoot.set(rootUid, commits);
    },
    getCommit: (rootUid, commitIndex) => commitsByRoot.get(rootUid)?.[commitIndex],
    getCommitCount: (rootUid) => commitsByRoot.get(rootUid)?.length ?? 0,
  };
};

export const getChangedHookIndices = (previous: unknown[], next: unknown[]): number[] => {
  const changed: number[] = [];
  const count = Math.max(previous.length, next.length);
  for (let index = 0; index < count; index++) {
    if (!Object.is(previous[index], next[index])) changed.push(index);
  }
  return changed;
};

export const filterMountedUpdaters = (updaterUids: string[], mountedUids: Set<string>): string[] =>
  updaterUids.filter((uid) => mountedUids.has(uid));
