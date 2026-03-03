import {
  createFamilyId,
  extractModulePathFromStack,
  getNextRefreshHelpers,
  getComponentTypeFingerprint,
  isObjectRecord,
  loadViteRefreshRuntime,
  normalizeRefreshModulePath,
  mapFromRecord,
  mapToRecord,
} from 'bippy/hmr';

interface RefreshRuntime {
  getRefreshReg: (
    filename: string,
  ) => (componentType: unknown, registrationId: string) => void;
  validateRefreshBoundaryAndEnqueueUpdate: (
    moduleId: string,
    previousExports: Record<string, unknown>,
    nextExports: Record<string, unknown>,
  ) => string | undefined;
}

interface NextRefreshHelpers {
  scheduleUpdate: () => void;
}

interface PendingFamilyChange {
  familyId: string;
  nextTypeFingerprint: string;
  nextType: unknown;
  previousTypeFingerprint: string | undefined;
  previousType: unknown;
}

interface FamilyRegistrationMetadata {
  familyId: string;
  modulePath: string;
  registrationId: string;
}

interface VersionSnapshot {
  changedFamilyIds: string[];
  familyTypeFingerprintById: Map<string, string>;
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
  activeRefreshModulePath: string | null;
  componentTypeByFingerprint: Map<string, unknown>;
  currentVersionIndex: number;
  familyFirstSeenVersionById: Map<string, number>;
  familyRegistrationMetadataByFamilyId: Map<string, FamilyRegistrationMetadata>;
  isApplyingVersion: boolean;
  isBeforePerformHookInstalled: boolean;
  isNextScheduleHookInstalled: boolean;
  isRefreshInterceptTrackingInstalled: boolean;
  isRefreshRegTrackingInstalled: boolean;
  moduleFallbackCounter: number;
  pendingFamilyChangeById: Map<string, PendingFamilyChange>;
  refreshRegistrationHandlerByModulePath: Map<
    string,
    (componentType: unknown, registrationId: string) => void
  >;
  timelineSnapshots: VersionSnapshot[];
}

interface PersistedVersionSnapshot {
  changedFamilyIds: string[];
  familyTypeFingerprintById: Record<string, string>;
  timestamp: number;
  version: number;
}

interface PersistedHmrVersioningState {
  familyFirstSeenVersionById: Record<string, number>;
  persistedAtTimestamp: number;
  timelineSnapshots: PersistedVersionSnapshot[];
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
    $RefreshHelpers$?: unknown;
    $RefreshInterceptModuleExecution$?: unknown;
    $RefreshReg$?: unknown;
    __BIPPY_HMR_VERSIONING__?: HmrVersioningController;
    __BIPPY_HMR_VERSIONING_INTERNAL_STATE__?: HmrVersioningInternalState;
    __registerBeforePerformReactRefresh?: (
      callback: () => unknown,
    ) => unknown;
  }
}

const createInitialVersionSnapshot = (): VersionSnapshot => {
  return {
    changedFamilyIds: [],
    familyTypeFingerprintById: new Map<string, string>(),
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

const isObjectRecordValue = (
  maybeObjectRecord: unknown,
): maybeObjectRecord is Record<string, unknown> => {
  return isObjectRecord(maybeObjectRecord);
};

const sessionStorageStateKey = '__BIPPY_HMR_VERSIONING_STATE__';
const persistedStateSchemaVersion = 1;

const serializeVersionSnapshot = (
  versionSnapshot: VersionSnapshot,
): PersistedVersionSnapshot => {
  return {
    changedFamilyIds: [...versionSnapshot.changedFamilyIds],
    familyTypeFingerprintById: mapToRecord(
      versionSnapshot.familyTypeFingerprintById,
    ),
    timestamp: versionSnapshot.timestamp,
    version: versionSnapshot.version,
  };
};

const deserializeVersionSnapshot = (
  persistedVersionSnapshot: PersistedVersionSnapshot,
): VersionSnapshot => {
  return {
    changedFamilyIds: [...persistedVersionSnapshot.changedFamilyIds],
    familyTypeFingerprintById: mapFromRecord(
      persistedVersionSnapshot.familyTypeFingerprintById,
    ),
    familyTypeById: new Map<string, unknown>(),
    timestamp: persistedVersionSnapshot.timestamp,
    version: persistedVersionSnapshot.version,
  };
};

const loadPersistedState = (): PersistedHmrVersioningState | null => {
  try {
    const persistedStateString = window.sessionStorage.getItem(
      sessionStorageStateKey,
    );
    if (!persistedStateString) {
      return null;
    }

    const persistedStateCandidate: unknown = JSON.parse(persistedStateString);
    if (!isObjectRecordValue(persistedStateCandidate)) {
      return null;
    }

    const schemaVersion = persistedStateCandidate['schemaVersion'];
    const timelineSnapshots = persistedStateCandidate['timelineSnapshots'];
    const familyFirstSeenVersionById =
      persistedStateCandidate['familyFirstSeenVersionById'];
    const persistedAtTimestamp = persistedStateCandidate['persistedAtTimestamp'];

    if (
      schemaVersion !== persistedStateSchemaVersion ||
      !Array.isArray(timelineSnapshots) ||
      !isObjectRecordValue(familyFirstSeenVersionById) ||
      typeof persistedAtTimestamp !== 'number'
    ) {
      return null;
    }

    const deserializedTimelineSnapshots: PersistedVersionSnapshot[] = [];
    for (const timelineSnapshotCandidate of timelineSnapshots) {
      if (!isObjectRecordValue(timelineSnapshotCandidate)) {
        return null;
      }
      const changedFamilyIds = timelineSnapshotCandidate['changedFamilyIds'];
      const familyTypeFingerprintById =
        timelineSnapshotCandidate['familyTypeFingerprintById'];
      const timestamp = timelineSnapshotCandidate['timestamp'];
      const version = timelineSnapshotCandidate['version'];

      if (
        !Array.isArray(changedFamilyIds) ||
        !changedFamilyIds.every(
          (changedFamilyId) => typeof changedFamilyId === 'string',
        ) ||
        !isObjectRecordValue(familyTypeFingerprintById) ||
        typeof timestamp !== 'number' ||
        typeof version !== 'number'
      ) {
        return null;
      }

      const normalizedFamilyTypeFingerprintById: Record<string, string> = {};
      for (const [familyId, fingerprintValue] of Object.entries(
        familyTypeFingerprintById,
      )) {
        if (typeof fingerprintValue !== 'string') {
          return null;
        }
        normalizedFamilyTypeFingerprintById[familyId] = fingerprintValue;
      }

      deserializedTimelineSnapshots.push({
        changedFamilyIds,
        familyTypeFingerprintById: normalizedFamilyTypeFingerprintById,
        timestamp,
        version,
      });
    }

    const normalizedFamilyFirstSeenVersionById: Record<string, number> = {};
    for (const [familyId, firstSeenVersion] of Object.entries(
      familyFirstSeenVersionById,
    )) {
      if (typeof firstSeenVersion !== 'number') {
        return null;
      }
      normalizedFamilyFirstSeenVersionById[familyId] = firstSeenVersion;
    }

    return {
      familyFirstSeenVersionById: normalizedFamilyFirstSeenVersionById,
      persistedAtTimestamp,
      timelineSnapshots: deserializedTimelineSnapshots,
    };
  } catch {
    return null;
  }
};

const persistInternalState = (internalState: HmrVersioningInternalState): void => {
  try {
    const existingPersistedState = loadPersistedState();
    const hasPersistedTimelineEntries =
      (existingPersistedState?.timelineSnapshots.length ?? 0) > 0;
    if (hasPersistedTimelineEntries) {
      return;
    }

    const persistedState: PersistedHmrVersioningState = {
      familyFirstSeenVersionById: mapToRecord(
        internalState.familyFirstSeenVersionById,
      ),
      persistedAtTimestamp: Date.now(),
      timelineSnapshots: internalState.timelineSnapshots.map(
        serializeVersionSnapshot,
      ),
    };
    window.sessionStorage.setItem(
      sessionStorageStateKey,
      JSON.stringify({
        ...persistedState,
        schemaVersion: persistedStateSchemaVersion,
      }),
    );
  } catch {
    return;
  }
};

const getOrCreateInternalState = (): HmrVersioningInternalState => {
  const existingInternalState = window.__BIPPY_HMR_VERSIONING_INTERNAL_STATE__;
  if (existingInternalState) {
    return existingInternalState;
  }

  const persistedState = loadPersistedState();
  const persistedTimelineSnapshots =
    persistedState?.timelineSnapshots.map(deserializeVersionSnapshot) ?? [];
  const timelineSnapshots =
    persistedTimelineSnapshots.length > 0
      ? persistedTimelineSnapshots
      : [createInitialVersionSnapshot()];
  const currentVersionIndex = timelineSnapshots.length - 1;

  const nextInternalState: HmrVersioningInternalState = {
    activeRefreshModulePath: null,
    componentTypeByFingerprint: new Map<string, unknown>(),
    currentVersionIndex,
    familyFirstSeenVersionById: persistedState
      ? mapFromRecord(persistedState.familyFirstSeenVersionById)
      : new Map<string, number>(),
    familyRegistrationMetadataByFamilyId: new Map<
      string,
      FamilyRegistrationMetadata
    >(),
    isApplyingVersion: false,
    isBeforePerformHookInstalled: false,
    isNextScheduleHookInstalled: false,
    isRefreshInterceptTrackingInstalled: false,
    isRefreshRegTrackingInstalled: false,
    moduleFallbackCounter: 0,
    pendingFamilyChangeById: new Map<string, PendingFamilyChange>(),
    refreshRegistrationHandlerByModulePath: new Map<
      string,
      (componentType: unknown, registrationId: string) => void
    >(),
    timelineSnapshots,
  };
  window.__BIPPY_HMR_VERSIONING_INTERNAL_STATE__ = nextInternalState;
  persistInternalState(nextInternalState);
  return nextInternalState;
};

const prototypeModulePath = '/src/hmr-versioning-prototype.ts';
const modulePathExtractOptions = {
  ignoredModulePaths: [prototypeModulePath],
  modulePathPredicate: (normalizedModulePath: string) => {
    if (normalizedModulePath.endsWith('/hmr-versioning-prototype.ts')) {
      return false;
    }
    return (
      normalizedModulePath.startsWith('/src/') ||
      normalizedModulePath.startsWith('/app/') ||
      normalizedModulePath.startsWith('/components/') ||
      normalizedModulePath.includes('/packages/next-playground/')
    );
  },
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

const backfillFamilyTypeFingerprintInHistory = (
  internalState: HmrVersioningInternalState,
  familyId: string,
  previousTypeFingerprint: string | undefined,
): void => {
  if (!previousTypeFingerprint) {
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
    if (!timelineSnapshot.familyTypeFingerprintById.has(familyId)) {
      timelineSnapshot.familyTypeFingerprintById.set(
        familyId,
        previousTypeFingerprint,
      );
    }
  }
};

const hydrateFamilyTypeFromFingerprint = (
  internalState: HmrVersioningInternalState,
  familyId: string,
  componentTypeFingerprint: string,
  componentType: unknown,
): void => {
  for (const timelineSnapshot of internalState.timelineSnapshots) {
    const timelineFingerprint = timelineSnapshot.familyTypeFingerprintById.get(
      familyId,
    );
    if (timelineFingerprint !== componentTypeFingerprint) {
      continue;
    }

    if (!timelineSnapshot.familyTypeById.has(familyId)) {
      timelineSnapshot.familyTypeById.set(familyId, componentType);
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
  const nextFamilyTypeFingerprintById = new Map<string, string>(
    currentVersionSnapshot.familyTypeFingerprintById,
  );
  const changedFamilyIds: string[] = [];

  for (const pendingFamilyChange of internalState.pendingFamilyChangeById.values()) {
    backfillFamilyTypeInHistory(
      internalState,
      pendingFamilyChange.familyId,
      pendingFamilyChange.previousType,
    );
    backfillFamilyTypeFingerprintInHistory(
      internalState,
      pendingFamilyChange.familyId,
      pendingFamilyChange.previousTypeFingerprint,
    );
    nextFamilyTypeById.set(
      pendingFamilyChange.familyId,
      pendingFamilyChange.nextType,
    );
    nextFamilyTypeFingerprintById.set(
      pendingFamilyChange.familyId,
      pendingFamilyChange.nextTypeFingerprint,
    );
    changedFamilyIds.push(pendingFamilyChange.familyId);
  }

  internalState.pendingFamilyChangeById.clear();
  if (changedFamilyIds.length === 0) {
    return;
  }

  const nextVersionSnapshot: VersionSnapshot = {
    changedFamilyIds,
    familyTypeFingerprintById: nextFamilyTypeFingerprintById,
    familyTypeById: nextFamilyTypeById,
    timestamp: Date.now(),
    version: internalState.timelineSnapshots.length,
  };
  internalState.timelineSnapshots.push(nextVersionSnapshot);
  internalState.currentVersionIndex = internalState.timelineSnapshots.length - 1;
  persistInternalState(internalState);
};

const trackRefreshRegistration = (
  internalState: HmrVersioningInternalState,
  modulePath: string,
  registrationId: string,
  componentType: unknown,
): void => {
  if (internalState.isApplyingVersion) {
    return;
  }

  const familyId = createFamilyId(modulePath, registrationId);
  const componentTypeFingerprint = getComponentTypeFingerprint(
    familyId,
    componentType,
  );
  internalState.componentTypeByFingerprint.set(
    componentTypeFingerprint,
    componentType,
  );
  if (!internalState.familyFirstSeenVersionById.has(familyId)) {
    internalState.familyFirstSeenVersionById.set(
      familyId,
      internalState.currentVersionIndex,
    );
  }

  internalState.familyRegistrationMetadataByFamilyId.set(familyId, {
    familyId,
    modulePath,
    registrationId,
  });

  const currentVersionSnapshot =
    internalState.timelineSnapshots[internalState.currentVersionIndex];
  const previousType = currentVersionSnapshot.familyTypeById.get(familyId);
  const previousTypeFingerprint = currentVersionSnapshot.familyTypeFingerprintById.get(
    familyId,
  );
  currentVersionSnapshot.familyTypeFingerprintById.set(
    familyId,
    componentTypeFingerprint,
  );
  hydrateFamilyTypeFromFingerprint(
    internalState,
    familyId,
    componentTypeFingerprint,
    componentType,
  );
  if (previousType === undefined) {
    currentVersionSnapshot.familyTypeById.set(familyId, componentType);
    persistInternalState(internalState);
    return;
  }

  if (previousType === componentType) {
    persistInternalState(internalState);
    return;
  }

  internalState.pendingFamilyChangeById.set(familyId, {
    familyId,
    nextTypeFingerprint: componentTypeFingerprint,
    nextType: componentType,
    previousTypeFingerprint,
    previousType,
  });
  persistInternalState(internalState);
};

const installRefreshInterceptTracking = (
  internalState: HmrVersioningInternalState,
): void => {
  if (internalState.isRefreshInterceptTrackingInstalled) {
    return;
  }

  let currentRefreshInterceptValue = window.$RefreshInterceptModuleExecution$;
  const wrappedRefreshInterceptByFunction = new WeakMap<
    object,
    (modulePath: unknown) => unknown
  >();

  const existingRefreshInterceptDescriptor = Object.getOwnPropertyDescriptor(
    window,
    '$RefreshInterceptModuleExecution$',
  );
  if (
    existingRefreshInterceptDescriptor &&
    !existingRefreshInterceptDescriptor.configurable
  ) {
    return;
  }

  Object.defineProperty(window, '$RefreshInterceptModuleExecution$', {
    configurable: true,
    get: () => {
      return currentRefreshInterceptValue;
    },
    set: (nextRefreshInterceptValue: unknown) => {
      if (typeof nextRefreshInterceptValue !== 'function') {
        currentRefreshInterceptValue = nextRefreshInterceptValue;
        return;
      }

      const existingWrappedRefreshIntercept =
        wrappedRefreshInterceptByFunction.get(nextRefreshInterceptValue);
      if (existingWrappedRefreshIntercept) {
        currentRefreshInterceptValue = existingWrappedRefreshIntercept;
        return;
      }

      const wrappedRefreshInterceptModuleExecution = (
        modulePathCandidate: unknown,
      ) => {
        const previousActiveRefreshModulePath = internalState.activeRefreshModulePath;
        const normalizedRefreshModulePath = normalizeRefreshModulePath(
          modulePathCandidate,
        );
        if (normalizedRefreshModulePath) {
          internalState.activeRefreshModulePath = normalizedRefreshModulePath;
        }

        const cleanupRefreshIntercept = nextRefreshInterceptValue(
          modulePathCandidate,
        );

        return () => {
          if (typeof cleanupRefreshIntercept === 'function') {
            cleanupRefreshIntercept();
          }
          internalState.activeRefreshModulePath = previousActiveRefreshModulePath;
        };
      };

      wrappedRefreshInterceptByFunction.set(
        nextRefreshInterceptValue,
        wrappedRefreshInterceptModuleExecution,
      );
      wrappedRefreshInterceptByFunction.set(
        wrappedRefreshInterceptModuleExecution,
        wrappedRefreshInterceptModuleExecution,
      );
      currentRefreshInterceptValue = wrappedRefreshInterceptModuleExecution;
    },
  });

  if (typeof currentRefreshInterceptValue === 'function') {
    window.$RefreshInterceptModuleExecution$ = currentRefreshInterceptValue;
  }

  internalState.isRefreshInterceptTrackingInstalled = true;
};

const installRefreshRegTracking = (
  internalState: HmrVersioningInternalState,
): void => {
  if (internalState.isRefreshRegTrackingInstalled) {
    return;
  }

  let currentRefreshRegValue = window.$RefreshReg$;
  const wrappedModulePathByRefreshRegistrationHandler = new WeakMap<
    object,
    string
  >();

  const existingRefreshRegDescriptor = Object.getOwnPropertyDescriptor(
    window,
    '$RefreshReg$',
  );
  if (existingRefreshRegDescriptor && !existingRefreshRegDescriptor.configurable) {
    return;
  }

  Object.defineProperty(window, '$RefreshReg$', {
    configurable: true,
    get: () => {
      return currentRefreshRegValue;
    },
    set: (nextRefreshRegValue: unknown) => {
      if (typeof nextRefreshRegValue !== 'function') {
        currentRefreshRegValue = nextRefreshRegValue;
        return;
      }

      if (
        wrappedModulePathByRefreshRegistrationHandler.has(nextRefreshRegValue)
      ) {
        currentRefreshRegValue = nextRefreshRegValue;
        return;
      }

      const wrappedRefreshRegistrationHandler = (
        componentType: unknown,
        registrationId: string,
      ) => {
        nextRefreshRegValue(componentType, registrationId);

        const modulePathFromStack = extractModulePathFromStack(
          new Error().stack,
          modulePathExtractOptions,
        );
        const modulePathFromRefreshIntercept = internalState.activeRefreshModulePath;
        if (!modulePathFromRefreshIntercept && !modulePathFromStack) {
          internalState.moduleFallbackCounter += 1;
        }
        const modulePath =
          modulePathFromRefreshIntercept ??
          modulePathFromStack ??
          `__module_${internalState.moduleFallbackCounter}`;

        internalState.refreshRegistrationHandlerByModulePath.set(
          modulePath,
          wrappedRefreshRegistrationHandler,
        );
        trackRefreshRegistration(
          internalState,
          modulePath,
          registrationId,
          componentType,
        );
      };
      wrappedModulePathByRefreshRegistrationHandler.set(
        wrappedRefreshRegistrationHandler,
        prototypeModulePath,
      );
      currentRefreshRegValue = wrappedRefreshRegistrationHandler;
    },
  });

  if (typeof currentRefreshRegValue === 'function') {
    window.$RefreshReg$ = currentRefreshRegValue;
  }

  internalState.isRefreshRegTrackingInstalled = true;
};

const installBeforePerformRefreshHook = (
  internalState: HmrVersioningInternalState,
): void => {
  if (internalState.isBeforePerformHookInstalled) {
    return;
  }

  const registerBeforePerformHook = window.__registerBeforePerformReactRefresh;
  if (typeof registerBeforePerformHook !== 'function') {
    return;
  }

  registerBeforePerformHook(() => {
    if (!internalState.isApplyingVersion) {
      finalizePendingRefreshChanges(internalState);
    }
  });
  internalState.isBeforePerformHookInstalled = true;
};

const installNextScheduleHook = (
  internalState: HmrVersioningInternalState,
  nextRefreshHelpers: NextRefreshHelpers,
): void => {
  if (internalState.isNextScheduleHookInstalled) {
    return;
  }

  const originalScheduleUpdate = nextRefreshHelpers.scheduleUpdate;
  nextRefreshHelpers.scheduleUpdate = () => {
    if (!internalState.isApplyingVersion) {
      finalizePendingRefreshChanges(internalState);
    }
    originalScheduleUpdate();
  };
  internalState.isNextScheduleHookInstalled = true;
};

const refreshBoundaryModuleExports = {
  RefreshTriggerComponent: () => null,
};

const triggerRefreshUpdate = (
  refreshRuntime: RefreshRuntime | null,
  nextRefreshHelpers: NextRefreshHelpers | null,
): boolean => {
  if (refreshRuntime) {
    refreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(
      '__bippy_hmr_versioning__',
      refreshBoundaryModuleExports,
      refreshBoundaryModuleExports,
    );
    return true;
  }

  if (nextRefreshHelpers) {
    nextRefreshHelpers.scheduleUpdate();
    return true;
  }

  return false;
};

const registerFamilyTypeForVersionApply = (
  refreshRuntime: RefreshRuntime | null,
  internalState: HmrVersioningInternalState,
  familyId: string,
  componentType: unknown,
): boolean => {
  const familyRegistrationMetadata =
    internalState.familyRegistrationMetadataByFamilyId.get(familyId);
  if (!familyRegistrationMetadata) {
    return false;
  }

  const refreshRegistrationHandlerFromHistory =
    internalState.refreshRegistrationHandlerByModulePath.get(
      familyRegistrationMetadata.modulePath,
    );
  const refreshRegistrationHandler =
    refreshRegistrationHandlerFromHistory ??
    (refreshRuntime
      ? refreshRuntime.getRefreshReg(familyRegistrationMetadata.modulePath)
      : null);
  if (!refreshRegistrationHandler) {
    return false;
  }

  const registrationType = (() => {
    if (typeof componentType !== 'function') {
      return componentType;
    }

    const maybeComponentPrototype = isObjectRecordValue(componentType.prototype)
      ? componentType.prototype
      : null;
    const isClassComponent = Boolean(
      maybeComponentPrototype && 'isReactComponent' in maybeComponentPrototype,
    );
    if (isClassComponent) {
      return componentType;
    }

    const wrappedComponentType = (receivedProps: unknown) => {
      return Reflect.apply(componentType, undefined, [receivedProps]);
    };
    return wrappedComponentType;
  })();

  refreshRegistrationHandler(
    registrationType,
    familyRegistrationMetadata.registrationId,
  );
  return true;
};

const createHmrVersioningController = (
  refreshRuntime: RefreshRuntime | null,
  nextRefreshHelpers: NextRefreshHelpers | null,
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

    const targetVersionSnapshot =
      internalState.timelineSnapshots[targetVersionIndex];
    const targetFamilyIds = Array.from(
      targetVersionSnapshot.familyTypeFingerprintById.keys(),
    );

    let didQueueRefreshUpdate = false;
    let didSkipAnyFamily = false;
    internalState.isApplyingVersion = true;

    try {
      for (const familyId of targetFamilyIds) {
        const targetTypeFingerprint =
          targetVersionSnapshot.familyTypeFingerprintById.get(familyId);
        if (!targetTypeFingerprint) {
          didSkipAnyFamily = true;
          continue;
        }

        const targetType =
          targetVersionSnapshot.familyTypeById.get(familyId) ??
          internalState.componentTypeByFingerprint.get(targetTypeFingerprint);
        if (targetType === undefined) {
          didSkipAnyFamily = true;
          continue;
        }

        const didRegisterFamilyType = registerFamilyTypeForVersionApply(
          refreshRuntime,
          internalState,
          familyId,
          targetType,
        );
        if (didRegisterFamilyType) {
          didQueueRefreshUpdate = true;
        }
      }

      if (didQueueRefreshUpdate) {
        const didTriggerRefreshUpdate = triggerRefreshUpdate(
          refreshRuntime,
          nextRefreshHelpers,
        );
        if (!didTriggerRefreshUpdate) {
          return false;
        }
      }
      if (!didQueueRefreshUpdate && didSkipAnyFamily) {
        return false;
      }
      internalState.currentVersionIndex = targetVersionIndex;
      persistInternalState(internalState);
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

const initializeHmrVersioningPrototype = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  const isViteHotEnvironment =
    typeof window.$RefreshReg$ === 'function' ||
    typeof window.__registerBeforePerformReactRefresh === 'function';
  const isHotEnvironment =
    isViteHotEnvironment ||
    typeof window.$RefreshInterceptModuleExecution$ === 'function' ||
    isObjectRecordValue(window.$RefreshHelpers$);
  if (!isHotEnvironment) {
    return;
  }

  const internalState = getOrCreateInternalState();
  installRefreshInterceptTracking(internalState);
  installRefreshRegTracking(internalState);
  installBeforePerformRefreshHook(internalState);

  if (window.__BIPPY_HMR_VERSIONING__) {
    return;
  }

  const refreshRuntime = await loadViteRefreshRuntime();
  const nextRefreshHelpers = getNextRefreshHelpers();
  if (!refreshRuntime && !nextRefreshHelpers) {
    return;
  }

  installBeforePerformRefreshHook(internalState);
  if (nextRefreshHelpers) {
    installNextScheduleHook(internalState, nextRefreshHelpers);
  }

  const hmrVersioningController = createHmrVersioningController(
    refreshRuntime,
    nextRefreshHelpers,
    internalState,
  );

  window.__BIPPY_HMR_VERSIONING__ = hmrVersioningController;
};

if (typeof window !== 'undefined') {
  void initializeHmrVersioningPrototype();
}
