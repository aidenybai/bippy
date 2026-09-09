import type { CapturedPageState, SourceLocation, StaticValue } from "../types.js";
import { NULL_VALUE, UNDEFINED_VALUE, primitiveValue, unknownValue } from "./values.js";

/**
 * Web Storage as the captured page's first script found it; without a capture,
 * as a fresh browser profile holds it (empty). Later state comes only from
 * writes performed by the interpreted code.
 */
export interface StorageArea {
  /** `null` marks a key whose stored string the analysis could not compute. */
  readonly entries: Map<string, string | null>;
  hasUnknownKeys: boolean;
}

export interface StorageAreas {
  localStorage: StorageArea;
  sessionStorage: StorageArea;
}

export type StorageAreaName = keyof StorageAreas;

const isStorageAreaName = (name: string): name is StorageAreaName =>
  name === "localStorage" || name === "sessionStorage";

export const getStorageAreaName = (globalName: string): StorageAreaName | null => {
  const areaName = globalName.slice(globalName.lastIndexOf(".") + 1);
  return isStorageAreaName(areaName) ? areaName : null;
};

const createStorageArea = (entries: Record<string, string> = {}): StorageArea => ({
  entries: new Map(Object.entries(entries)),
  hasUnknownKeys: false,
});

export const createStorageAreas = (page: CapturedPageState | null): StorageAreas => ({
  localStorage: createStorageArea(page?.localStorage),
  sessionStorage: createStorageArea(page?.sessionStorage),
});

const toStorageString = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" ? String(value.value) : null;

export const getStorageLength = (area: StorageArea, areaName: StorageAreaName): StaticValue =>
  area.hasUnknownKeys
    ? unknownValue(`${areaName}.length after a write to a dynamic key`)
    : primitiveValue(area.entries.size);

export const callStorageMethod = (
  area: StorageArea,
  areaName: StorageAreaName,
  methodName: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue | null => {
  const [first, second] = args;
  const key = toStorageString(first);
  const describe = (detail: string) =>
    unknownValue(`${areaName}.${methodName} ${detail}`, location);

  switch (methodName) {
    case "getItem": {
      if (area.hasUnknownKeys) return describe("after a write to a dynamic key");
      if (key === null) return describe("with a dynamic key");
      const stored = area.entries.get(key);
      if (stored === null) return describe(`of "${key}" after a dynamic write`);
      return stored === undefined ? NULL_VALUE : primitiveValue(stored);
    }
    case "setItem": {
      if (key === null) area.hasUnknownKeys = true;
      else area.entries.set(key, toStorageString(second));
      return UNDEFINED_VALUE;
    }
    case "removeItem": {
      if (key === null) area.hasUnknownKeys = true;
      else area.entries.delete(key);
      return UNDEFINED_VALUE;
    }
    case "clear":
      area.entries.clear();
      area.hasUnknownKeys = false;
      return UNDEFINED_VALUE;
    case "key": {
      if (area.hasUnknownKeys) return describe("after a write to a dynamic key");
      if (first?.kind !== "primitive") return describe("with a dynamic index");
      const storedKey = [...area.entries.keys()][Number(first.value)];
      return storedKey === undefined ? NULL_VALUE : primitiveValue(storedKey);
    }
    default:
      return null;
  }
};
