export interface RefreshRuntime {
  getRefreshReg: (
    filename: string,
  ) => (componentType: unknown, registrationId: string) => void;
  validateRefreshBoundaryAndEnqueueUpdate: (
    moduleId: string,
    previousExports: Record<string, unknown>,
    nextExports: Record<string, unknown>,
  ) => string | undefined;
}

export interface NextRefreshHelpers {
  getRefreshBoundarySignature: (moduleExports: unknown) => unknown[];
  isReactRefreshBoundary: (moduleExports: unknown) => boolean;
  registerExportsForReactRefresh: (
    moduleExports: unknown,
    moduleId: string | number,
  ) => void;
  scheduleUpdate: () => void;
  shouldInvalidateReactRefreshBoundary: (
    previousSignature: unknown[],
    nextSignature: unknown[],
  ) => boolean;
}

export interface ExtractModulePathFromStackOptions {
  ignoredModulePaths?: string[];
  modulePathPredicate?: (normalizedFileName: string) => boolean;
  sourcePathPrefix?: string;
  sourcePathPrefixes?: string[];
}
