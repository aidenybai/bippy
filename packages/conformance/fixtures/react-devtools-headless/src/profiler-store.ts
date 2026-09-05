export interface ProfilerStoreCommit {
  duration: number;
  renderedUids: string[];
}

export interface ProfilerStoreRootData {
  commits: ProfilerStoreCommit[];
  rootUid: string;
}

export interface ProfilerStore {
  getData: (rootUid: string) => ProfilerStoreRootData | undefined;
  removeRoot: (rootUid: string) => void;
  setData: (data: ProfilerStoreRootData[]) => void;
  setFilters: (filters: string[]) => void;
  startProfiling: () => void;
  stopProfiling: () => void;
}

export const createProfilerStore = (): ProfilerStore => {
  const data = new Map<string, ProfilerStoreRootData>();
  let isProfiling = false;
  return {
    getData: (rootUid) => data.get(rootUid),
    removeRoot: () => undefined,
    setData: (nextData) => {
      if (isProfiling) throw new Error("Cannot modify profiling data while profiling");
      data.clear();
      for (const rootData of nextData) {
        data.set(rootData.rootUid, {
          ...rootData,
          commits: rootData.commits.filter(
            (commit) => commit.duration > 0 || commit.renderedUids.length > 0,
          ),
        });
      }
    },
    setFilters: () => {
      if (isProfiling) throw new Error("Cannot modify component filters while profiling");
    },
    startProfiling: () => {
      isProfiling = true;
    },
    stopProfiling: () => {
      isProfiling = false;
    },
  };
};
