import { isObjectRecord } from './primitives.js';
import { RefreshRuntime } from './types.js';

export const isRefreshRuntime = (
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

export const loadViteRefreshRuntime = async (): Promise<RefreshRuntime | null> => {
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
