import { normalizeFileName, parseStack } from '../source/index.js';

import { ExtractModulePathFromStackOptions } from './types.js';

export const isObjectRecord = (
  maybeObjectRecord: unknown,
): maybeObjectRecord is Record<string, unknown> => {
  return typeof maybeObjectRecord === 'object' && maybeObjectRecord !== null;
};

export const mapFromRecord = <Value>(
  recordObject: Record<string, Value>,
): Map<string, Value> => {
  return new Map<string, Value>(Object.entries(recordObject));
};

export const mapToRecord = <Value>(
  valueByKeyMap: Map<string, Value>,
): Record<string, Value> => {
  return Object.fromEntries(valueByKeyMap.entries());
};

export const createTextHash = (inputText: string): string => {
  let hashValue = 2166136261;
  for (let characterIndex = 0; characterIndex < inputText.length; characterIndex += 1) {
    hashValue ^= inputText.charCodeAt(characterIndex);
    hashValue +=
      (hashValue << 1) +
      (hashValue << 4) +
      (hashValue << 7) +
      (hashValue << 8) +
      (hashValue << 24);
  }
  return (hashValue >>> 0).toString(36);
};

export const getComponentTypeFingerprint = (
  familyId: string,
  componentType: unknown,
): string => {
  const componentTypeSignature =
    typeof componentType === 'function' || typeof componentType === 'object'
      ? String(componentType)
      : typeof componentType;
  return createTextHash(`${familyId}::${componentTypeSignature}`);
};

export const createFamilyId = (
  modulePath: string,
  registrationId: string,
): string => {
  return `${modulePath}::${registrationId}`;
};

export const extractModulePathFromStack = (
  errorStack: string | undefined,
  options?: ExtractModulePathFromStackOptions,
): string | null => {
  if (!errorStack) {
    return null;
  }

  const ignoredModulePathSet = new Set(options?.ignoredModulePaths ?? []);
  const sourcePathPrefix = options?.sourcePathPrefix ?? '/src/';
  const stackFrames = parseStack(errorStack, { includeInElement: false });
  for (const stackFrame of stackFrames) {
    if (!stackFrame.fileName) {
      continue;
    }

    const normalizedFileName = normalizeFileName(stackFrame.fileName);
    if (
      normalizedFileName.startsWith(sourcePathPrefix) &&
      !ignoredModulePathSet.has(normalizedFileName)
    ) {
      return normalizedFileName;
    }
  }

  return null;
};
