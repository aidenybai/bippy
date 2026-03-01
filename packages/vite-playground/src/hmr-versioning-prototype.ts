interface RefreshFamily {
  current: unknown;
}

interface RefreshUpdate {
  staleFamilies: Set<RefreshFamily>;
  updatedFamilies: Set<RefreshFamily>;
}

interface RefreshRuntime {
  getFamilyByID: (familyId: string) => RefreshFamily | undefined;
  performReactRefresh: () => RefreshUpdate | null;
  register: (componentType: unknown, familyId: string) => void;
}

interface RefreshRuntimeModule {
  default: unknown;
}

interface PendingFamilyChange {
  familyId: string;
  nextType: unknown;
  previousType: unknown;
}

interface VersionSnapshot {
  changedFamilyIds: string[];
  familyTypeById: Map<string, unknown>;
  timestamp: number;
  version: number;
}

interface VersionSummary {
  changedFamilyIds: string[];
  familyCount: number;
  timestamp: number;
  version: number;
}

interface HmrVersioningInternalState {
  currentVersionIndex: number;
  familyFirstSeenVersionById: Map<string, number>;
  isApplyingVersion: boolean;
  isPatched: boolean;
  knownFamilyIds: Set<string>;
  pendingFamilyChangeById: Map<string, PendingFamilyChange>;
  timelineSnapshots: VersionSnapshot[];
}

interface HmrVersioningController {
  getCurrentVersion: () => VersionSummary;
  getTimeline: () => VersionSummary[];
  jumpToVersion: (targetVersionIndex: number) => boolean;
  redo: () => boolean;
  undo: () => boolean;
}

declare global {
  interface Window {
    __BIPPY_HMR_VERSIONING__?: HmrVersioningController;
    __BIPPY_HMR_VERSIONING_INTERNAL_STATE__?: HmrVersioningInternalState;
    __BIPPY_HMR_VERSIONING_KEYDOWN_LISTENER__?: (
      keyboardEvent: KeyboardEvent,
    ) => void;
  }
}

const createInitialVersionSnapshot = (): VersionSnapshot => {
  return {
    changedFamilyIds: [],
    familyTypeById: new Map<string, unknown>(),
    timestamp: Date.now(),
    version: 0,
  };
};

const createVersionSummary = (versionSnapshot: VersionSnapshot): VersionSummary => {
  return {
    changedFamilyIds: [...versionSnapshot.changedFamilyIds],
    familyCount: versionSnapshot.familyTypeById.size,
    timestamp: versionSnapshot.timestamp,
    version: versionSnapshot.version,
  };
};

const isObjectRecord = (
  maybeObjectRecord: unknown,
): maybeObjectRecord is Record<string, unknown> => {
  return typeof maybeObjectRecord === 'object' && maybeObjectRecord !== null;
};

const isRefreshRuntime = (
  maybeRefreshRuntime: unknown,
): maybeRefreshRuntime is RefreshRuntime => {
  if (!isObjectRecord(maybeRefreshRuntime)) {
    return false;
  }

  const maybeRegister = maybeRefreshRuntime['register'];
  const maybePerformReactRefresh = maybeRefreshRuntime['performReactRefresh'];
  const maybeGetFamilyByID = maybeRefreshRuntime['getFamilyByID'];

  return (
    typeof maybeRegister === 'function' &&
    typeof maybePerformReactRefresh === 'function' &&
    typeof maybeGetFamilyByID === 'function'
  );
};

const isRefreshRuntimeModule = (
  maybeRefreshRuntimeModule: unknown,
): maybeRefreshRuntimeModule is RefreshRuntimeModule => {
  return (
    isObjectRecord(maybeRefreshRuntimeModule) &&
    'default' in maybeRefreshRuntimeModule
  );
};

const loadRefreshRuntime = async (): Promise<RefreshRuntime | null> => {
  try {
    const runtimeModulePath = ['/', '@react-refresh'].join('');
    const importRuntimeModule = new Function(
      'modulePath',
      'return import(modulePath)',
    );
    const runtimeModuleImportResult: unknown =
      await importRuntimeModule(runtimeModulePath);

    if (!isRefreshRuntimeModule(runtimeModuleImportResult)) {
      return null;
    }

    const maybeRefreshRuntime = runtimeModuleImportResult.default;
    if (!isRefreshRuntime(maybeRefreshRuntime)) {
      return null;
    }

    return maybeRefreshRuntime;
  } catch {
    return null;
  }
};

const getOrCreateInternalState = (): HmrVersioningInternalState => {
  const existingInternalState = window.__BIPPY_HMR_VERSIONING_INTERNAL_STATE__;
  if (existingInternalState) {
    return existingInternalState;
  }

  const nextInternalState: HmrVersioningInternalState = {
    currentVersionIndex: 0,
    familyFirstSeenVersionById: new Map<string, number>(),
    isApplyingVersion: false,
    isPatched: false,
    knownFamilyIds: new Set<string>(),
    pendingFamilyChangeById: new Map<string, PendingFamilyChange>(),
    timelineSnapshots: [createInitialVersionSnapshot()],
  };
  window.__BIPPY_HMR_VERSIONING_INTERNAL_STATE__ = nextInternalState;
  return nextInternalState;
};

const backfillFamilyTypeInHistory = (
  internalState: HmrVersioningInternalState,
  familyId: string,
  previousType: unknown,
): void => {
  if (previousType === undefined) {
    return;
  }

  const firstSeenVersionIndex =
    internalState.familyFirstSeenVersionById.get(familyId) ?? 0;
  const latestBackfillVersionIndex = Math.min(
    internalState.currentVersionIndex,
    internalState.timelineSnapshots.length - 1,
  );

  for (
    let versionIndex = firstSeenVersionIndex;
    versionIndex <= latestBackfillVersionIndex;
    versionIndex += 1
  ) {
    const timelineSnapshot = internalState.timelineSnapshots[versionIndex];
    if (!timelineSnapshot.familyTypeById.has(familyId)) {
      timelineSnapshot.familyTypeById.set(familyId, previousType);
    }
  }
};

const finalizePendingRefreshChanges = (
  internalState: HmrVersioningInternalState,
): void => {
  if (internalState.pendingFamilyChangeById.size === 0) {
    return;
  }

  const currentVersionIndex = internalState.currentVersionIndex;
  if (currentVersionIndex < internalState.timelineSnapshots.length - 1) {
    internalState.timelineSnapshots.splice(currentVersionIndex + 1);
  }

  const currentVersionSnapshot =
    internalState.timelineSnapshots[internalState.currentVersionIndex];
  const nextFamilyTypeById = new Map<string, unknown>(
    currentVersionSnapshot.familyTypeById,
  );
  const changedFamilyIds: string[] = [];

  for (const pendingFamilyChange of internalState.pendingFamilyChangeById.values()) {
    backfillFamilyTypeInHistory(
      internalState,
      pendingFamilyChange.familyId,
      pendingFamilyChange.previousType,
    );
    nextFamilyTypeById.set(
      pendingFamilyChange.familyId,
      pendingFamilyChange.nextType,
    );
    changedFamilyIds.push(pendingFamilyChange.familyId);
  }

  internalState.pendingFamilyChangeById.clear();
  if (changedFamilyIds.length === 0) {
    return;
  }

  const nextVersionSnapshot: VersionSnapshot = {
    changedFamilyIds,
    familyTypeById: nextFamilyTypeById,
    timestamp: Date.now(),
    version: internalState.timelineSnapshots.length,
  };
  internalState.timelineSnapshots.push(nextVersionSnapshot);
  internalState.currentVersionIndex = internalState.timelineSnapshots.length - 1;
};

const patchRefreshRuntime = (
  refreshRuntime: RefreshRuntime,
  internalState: HmrVersioningInternalState,
): void => {
  if (internalState.isPatched) {
    return;
  }

  const originalRegister = refreshRuntime.register.bind(refreshRuntime);
  const originalPerformReactRefresh =
    refreshRuntime.performReactRefresh.bind(refreshRuntime);

  refreshRuntime.register = (componentType: unknown, familyId: string) => {
    const existingFamily = refreshRuntime.getFamilyByID(familyId);
    const previousType = existingFamily?.current;
    const didFamilyExistBeforeRegistration = existingFamily !== undefined;

    originalRegister(componentType, familyId);

    const updatedFamily = refreshRuntime.getFamilyByID(familyId);
    if (!updatedFamily) {
      return;
    }

    internalState.knownFamilyIds.add(familyId);

    if (!internalState.familyFirstSeenVersionById.has(familyId)) {
      internalState.familyFirstSeenVersionById.set(
        familyId,
        internalState.currentVersionIndex,
      );
    }

    const currentVersionSnapshot =
      internalState.timelineSnapshots[internalState.currentVersionIndex];

    if (!didFamilyExistBeforeRegistration) {
      currentVersionSnapshot.familyTypeById.set(familyId, updatedFamily.current);
      return;
    }

    if (internalState.isApplyingVersion) {
      return;
    }

    const nextType = updatedFamily.current;
    if (previousType === nextType) {
      return;
    }

    internalState.pendingFamilyChangeById.set(familyId, {
      familyId,
      nextType,
      previousType,
    });
  };

  refreshRuntime.performReactRefresh = () => {
    const refreshUpdate = originalPerformReactRefresh();
    if (!internalState.isApplyingVersion) {
      finalizePendingRefreshChanges(internalState);
    }
    return refreshUpdate;
  };

  internalState.isPatched = true;
};

const createHmrVersioningController = (
  refreshRuntime: RefreshRuntime,
  internalState: HmrVersioningInternalState,
): HmrVersioningController => {
  const applyVersionAtIndex = (targetVersionIndex: number): boolean => {
    if (
      targetVersionIndex < 0 ||
      targetVersionIndex >= internalState.timelineSnapshots.length
    ) {
      return false;
    }

    if (targetVersionIndex === internalState.currentVersionIndex) {
      return true;
    }

    const currentVersionSnapshot =
      internalState.timelineSnapshots[internalState.currentVersionIndex];
    const targetVersionSnapshot =
      internalState.timelineSnapshots[targetVersionIndex];
    const allFamilyIds = new Set<string>([
      ...Array.from(currentVersionSnapshot.familyTypeById.keys()),
      ...Array.from(targetVersionSnapshot.familyTypeById.keys()),
    ]);

    let didQueueRefreshUpdate = false;
    internalState.isApplyingVersion = true;

    try {
      for (const familyId of allFamilyIds) {
        const currentType = currentVersionSnapshot.familyTypeById.get(familyId);
        const targetType = targetVersionSnapshot.familyTypeById.get(familyId);

        if (currentType === targetType) {
          continue;
        }

        if (targetType === undefined) {
          continue;
        }

        refreshRuntime.register(targetType, familyId);
        didQueueRefreshUpdate = true;
      }

      if (didQueueRefreshUpdate) {
        refreshRuntime.performReactRefresh();
      }
      internalState.currentVersionIndex = targetVersionIndex;
      return true;
    } finally {
      internalState.isApplyingVersion = false;
    }
  };

  return {
    getCurrentVersion: () => {
      return createVersionSummary(
        internalState.timelineSnapshots[internalState.currentVersionIndex],
      );
    },
    getTimeline: () => {
      return internalState.timelineSnapshots.map(createVersionSummary);
    },
    jumpToVersion: (targetVersionIndex: number) => {
      return applyVersionAtIndex(targetVersionIndex);
    },
    redo: () => {
      return applyVersionAtIndex(internalState.currentVersionIndex + 1);
    },
    undo: () => {
      return applyVersionAtIndex(internalState.currentVersionIndex - 1);
    },
  };
};

const installKeyboardShortcuts = (
  hmrVersioningController: HmrVersioningController,
): void => {
  const previousKeydownListener = window.__BIPPY_HMR_VERSIONING_KEYDOWN_LISTENER__;
  if (previousKeydownListener) {
    window.removeEventListener('keydown', previousKeydownListener);
  }

  const keydownListener = (keyboardEvent: KeyboardEvent) => {
    const isCommandKeyPressed = keyboardEvent.metaKey || keyboardEvent.ctrlKey;
    if (!isCommandKeyPressed || keyboardEvent.altKey) {
      return;
    }

    const normalizedKey = keyboardEvent.key.toLowerCase();
    const isUndoShortcut = normalizedKey === 'z' && !keyboardEvent.shiftKey;
    const isRedoShortcut =
      (normalizedKey === 'z' && keyboardEvent.shiftKey) ||
      (normalizedKey === 'y' && keyboardEvent.ctrlKey && !keyboardEvent.metaKey);

    if (isUndoShortcut) {
      keyboardEvent.preventDefault();
      hmrVersioningController.undo();
      return;
    }

    if (isRedoShortcut) {
      keyboardEvent.preventDefault();
      hmrVersioningController.redo();
    }
  };

  window.addEventListener('keydown', keydownListener);
  window.__BIPPY_HMR_VERSIONING_KEYDOWN_LISTENER__ = keydownListener;
};

const initializeHmrVersioningPrototype = async (): Promise<void> => {
  if (typeof window === 'undefined' || !import.meta.hot) {
    return;
  }

  if (window.__BIPPY_HMR_VERSIONING__) {
    return;
  }

  const refreshRuntime = await loadRefreshRuntime();
  if (!refreshRuntime) {
    return;
  }

  const internalState = getOrCreateInternalState();
  patchRefreshRuntime(refreshRuntime, internalState);

  const hmrVersioningController = createHmrVersioningController(
    refreshRuntime,
    internalState,
  );

  window.__BIPPY_HMR_VERSIONING__ = hmrVersioningController;
  installKeyboardShortcuts(hmrVersioningController);
};

if (import.meta.hot) {
  void initializeHmrVersioningPrototype();
}
