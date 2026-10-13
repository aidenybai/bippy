export interface ProfilerCommit {
  componentUids: string[];
  isVisible?: boolean;
}

export interface ProfilerRootData {
  commits: ProfilerCommit[];
  rootUid: string;
}

export interface ProfilerModelState {
  isProfiling: boolean;
  selectedCommitIndex: number | null;
  selectedRootUid: string | null;
}

export interface ProfilerModel {
  getState: () => ProfilerModelState;
  navigateCommits: (offset: number) => void;
  selectCommit: (index: number | null) => void;
  selectElement: (uid: string | null) => void;
  selectRoot: (rootUid: string | null) => void;
  setData: (data: ProfilerRootData[]) => void;
  toggleProfiling: () => void;
}

export const createProfilerModel = (onSelectElement?: (uid: string) => void): ProfilerModel => {
  let data = new Map<string, ProfilerRootData>();
  let selectedElementUid: string | null = null;
  let state: ProfilerModelState = {
    isProfiling: false,
    selectedCommitIndex: null,
    selectedRootUid: null,
  };

  const getVisibleCommitIndexes = (): number[] => {
    const commits = state.selectedRootUid ? data.get(state.selectedRootUid)?.commits : undefined;
    return commits
      ? commits.flatMap((commit, index) => (commit.isVisible === false ? [] : [index]))
      : [];
  };

  const selectRoot = (rootUid: string | null): void => {
    const selectedRootUid = rootUid && data.has(rootUid) ? rootUid : null;
    const firstCommit = selectedRootUid
      ? (getFirstVisibleCommit(data.get(selectedRootUid)) ?? null)
      : null;
    state = { ...state, selectedCommitIndex: firstCommit, selectedRootUid };
  };

  const selectCommit = (index: number | null): void => {
    if (index === null) {
      state = { ...state, selectedCommitIndex: null };
      return;
    }
    const visibleIndexes = getVisibleCommitIndexes();
    if (visibleIndexes.includes(index)) state = { ...state, selectedCommitIndex: index };
  };

  const navigateCommits = (offset: number): void => {
    const visibleIndexes = getVisibleCommitIndexes();
    if (visibleIndexes.length === 0) return;
    const currentPosition = visibleIndexes.indexOf(state.selectedCommitIndex ?? -1);
    const nextPosition = Math.max(0, Math.min(visibleIndexes.length - 1, currentPosition + offset));
    selectCommit(visibleIndexes[nextPosition]);
  };

  const setData = (nextData: ProfilerRootData[]): void => {
    data = new Map(nextData.map((rootData) => [rootData.rootUid, rootData]));
    if (state.selectedRootUid && data.has(state.selectedRootUid)) {
      const visibleIndexes = getVisibleCommitIndexes();
      if (!visibleIndexes.includes(state.selectedCommitIndex ?? -1)) {
        state = { ...state, selectedCommitIndex: visibleIndexes[0] ?? null };
      }
      return;
    }
    const matchingRoot = selectedElementUid
      ? nextData.find((rootData) =>
          rootData.commits.some((commit) =>
            commit.componentUids.includes(selectedElementUid ?? ""),
          ),
        )
      : undefined;
    selectRoot(matchingRoot?.rootUid ?? nextData[0]?.rootUid ?? null);
  };

  const selectElement = (uid: string | null): void => {
    selectedElementUid = uid;
    if (!uid) return;
    const matchingRoot = [...data.values()].find((rootData) =>
      rootData.commits.some((commit) => commit.componentUids.includes(uid)),
    );
    if (matchingRoot) selectRoot(matchingRoot.rootUid);
    const commitIndex = matchingRoot?.commits.findIndex((commit) =>
      commit.componentUids.includes(uid),
    );
    if (commitIndex !== undefined && commitIndex >= 0) selectCommit(commitIndex);
    onSelectElement?.(uid);
  };

  return {
    getState: () => state,
    navigateCommits,
    selectCommit,
    selectElement,
    selectRoot,
    setData,
    toggleProfiling: () => {
      state = { ...state, isProfiling: !state.isProfiling };
    },
  };
};

const getFirstVisibleCommit = (rootData: ProfilerRootData | undefined): number | undefined => {
  const index = rootData?.commits.findIndex((commit) => commit.isVisible !== false) ?? -1;
  return index >= 0 ? index : undefined;
};
