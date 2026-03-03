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

export interface ExtractModulePathFromStackOptions {
  ignoredModulePaths?: string[];
  sourcePathPrefix?: string;
}
