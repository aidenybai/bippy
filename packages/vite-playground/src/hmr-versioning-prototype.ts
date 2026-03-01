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

interface PendingFamilyChange {
  familyId: string;
  nextType: unknown;
  previousType: unknown;
}

interface FamilyRegistrationMetadata {
  familyId: string;
  modulePath: string;
  registrationId: string;
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
  familyRegistrationMetadataByFamilyId: Map<string, FamilyRegistrationMetadata>;
  isApplyingVersion: boolean;
  isBeforePerformHookInstalled: boolean;
  isRefreshRegTrackingInstalled: boolean;
  moduleFallbackCounter: number;
  pendingFamilyChangeById: Map<string, PendingFamilyChange>;
  refreshRegistrationHandlerByModulePath: Map<
    string,
    (componentType: unknown, registrationId: string) => void
  >;
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
    $RefreshReg$?: unknown;
    __BIPPY_HMR_VERSIONING__?: HmrVersioningController;
    __BIPPY_HMR_VERSIONING_INTERNAL_STATE__?: HmrVersioningInternalState;
    __BIPPY_HMR_VERSIONING_KEYDOWN_LISTENER__?: (
      keyboardEvent: KeyboardEvent,
    ) => void;
    __registerBeforePerformReactRefresh?: (
      callback: () => unknown,
    ) => unknown;
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

  const maybeGetRefreshReg = maybeRefreshRuntime['getRefreshReg'];
  const maybeValidateRefreshBoundaryAndEnqueueUpdate =
    maybeRefreshRuntime['validateRefreshBoundaryAndEnqueueUpdate'];

  return (
    typeof maybeGetRefreshReg === 'function' &&
    typeof maybeValidateRefreshBoundaryAndEnqueueUpdate === 'function'
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

    if (!isRefreshRuntime(runtimeModuleImportResult)) {
      return null;
    }

    return runtimeModuleImportResult;
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
    familyRegistrationMetadataByFamilyId: new Map<
      string,
      FamilyRegistrationMetadata
    >(),
    isApplyingVersion: false,
    isBeforePerformHookInstalled: false,
    isRefreshRegTrackingInstalled: false,
    moduleFallbackCounter: 0,
    pendingFamilyChangeById: new Map<string, PendingFamilyChange>(),
    refreshRegistrationHandlerByModulePath: new Map<
      string,
      (componentType: unknown, registrationId: string) => void
    >(),
    timelineSnapshots: [createInitialVersionSnapshot()],
  };
  window.__BIPPY_HMR_VERSIONING_INTERNAL_STATE__ = nextInternalState;
  return nextInternalState;
};

const prototypeModulePath = '/src/hmr-versioning-prototype.ts';

const extractModulePathFromStack = (errorStack: string | undefined): string | null => {
  if (!errorStack) {
    return null;
  }

  for (const stackLine of errorStack.split('\n')) {
    const urlMatch = stackLine.match(/https?:\/\/[^\s)]+/);
    if (!urlMatch) {
      continue;
    }

    try {
      const parsedUrl = new URL(urlMatch[0]);
      if (
        parsedUrl.pathname.startsWith('/src/') &&
        parsedUrl.pathname !== prototypeModulePath
      ) {
        return parsedUrl.pathname;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const createFamilyId = (modulePath: string, registrationId: string): string => {
  return `${modulePath}::${registrationId}`;
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
  if (previousType === undefined) {
    currentVersionSnapshot.familyTypeById.set(familyId, componentType);
    return;
  }

  if (previousType === componentType) {
    return;
  }

  internalState.pendingFamilyChangeById.set(familyId, {
    familyId,
    nextType: componentType,
    previousType,
  });
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

        const modulePathFromStack = extractModulePathFromStack(new Error().stack);
        if (!modulePathFromStack) {
          internalState.moduleFallbackCounter += 1;
        }
        const modulePath =
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

const refreshBoundaryModuleExports = {
  RefreshTriggerComponent: () => null,
};

const triggerRefreshUpdate = (refreshRuntime: RefreshRuntime): void => {
  refreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(
    '__bippy_hmr_versioning__',
    refreshBoundaryModuleExports,
    refreshBoundaryModuleExports,
  );
};

const registerFamilyTypeForVersionApply = (
  refreshRuntime: RefreshRuntime,
  internalState: HmrVersioningInternalState,
  familyId: string,
  componentType: unknown,
): boolean => {
  const familyRegistrationMetadata =
    internalState.familyRegistrationMetadataByFamilyId.get(familyId);
  if (!familyRegistrationMetadata) {
    return false;
  }

  const refreshRegistrationHandler =
    internalState.refreshRegistrationHandlerByModulePath.get(
      familyRegistrationMetadata.modulePath,
    ) ?? refreshRuntime.getRefreshReg(familyRegistrationMetadata.modulePath);

  const registrationType = (() => {
    if (typeof componentType !== 'function') {
      return componentType;
    }

    const maybeComponentPrototype = isObjectRecord(componentType.prototype)
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

    const targetVersionSnapshot =
      internalState.timelineSnapshots[targetVersionIndex];
    const targetFamilyEntries = Array.from(
      targetVersionSnapshot.familyTypeById.entries(),
    );

    let didQueueRefreshUpdate = false;
    internalState.isApplyingVersion = true;

    try {
      for (const [familyId, targetType] of targetFamilyEntries) {
        if (targetType === undefined) {
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
        triggerRefreshUpdate(refreshRuntime);
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

  const internalState = getOrCreateInternalState();
  installRefreshRegTracking(internalState);
  installBeforePerformRefreshHook(internalState);

  if (window.__BIPPY_HMR_VERSIONING__) {
    return;
  }

  const refreshRuntime = await loadRefreshRuntime();
  if (!refreshRuntime) {
    return;
  }

  installBeforePerformRefreshHook(internalState);

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
