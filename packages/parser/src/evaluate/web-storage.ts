import type { CapturedPageState, SourceLocation, StaticValue } from "../types.js";
import { recordInputSource } from "./predicates.js";
import { NULL_VALUE, UNDEFINED_VALUE, primitiveValue, unknownValue } from "./values.js";

/**
 * Web Storage as the captured page's first script found it; without a capture,
 * as a fresh browser profile holds it (empty). Later state comes only from
 * writes performed by the interpreted code.
 */
export interface StorageArea {
  readonly entries: Map<string, string>;
  hasUnknownWrites: boolean;
}

export interface StorageAreas {
  localStorage: StorageArea;
  sessionStorage: StorageArea;
}

type StorageAreaName = keyof StorageAreas;

const isStorageAreaName = (name: string): name is StorageAreaName =>
  name === "localStorage" || name === "sessionStorage";

export const getStorageAreaName = (globalName: string): StorageAreaName | null => {
  const areaName = globalName.slice(globalName.lastIndexOf(".") + 1);
  return isStorageAreaName(areaName) ? areaName : null;
};

const createStorageArea = (entries: Record<string, string> = {}): StorageArea => ({
  entries: new Map(Object.entries(entries)),
  hasUnknownWrites: false,
});

export const createStorageAreas = (page: CapturedPageState | null): StorageAreas => ({
  localStorage: createStorageArea(page?.localStorage),
  sessionStorage: createStorageArea(page?.sessionStorage),
});

const toStorageString = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" ? String(value.value) : null;

export const getStorageLength = (area: StorageArea, areaName: StorageAreaName): StaticValue =>
  area.hasUnknownWrites
    ? unknownValue(`${areaName}.length after a dynamic write`)
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
    recordInputSource(
      unknownValue(`${areaName}.${methodName} ${detail}`, location),
      "storage",
      location,
    );

  switch (methodName) {
    case "getItem": {
      if (area.hasUnknownWrites) return describe("after a dynamic write");
      if (key === null) return describe("with a dynamic key");
      const stored = area.entries.get(key);
      return stored === undefined ? NULL_VALUE : primitiveValue(stored);
    }
    case "setItem": {
      const stored = toStorageString(second);
      if (key === null || stored === null) area.hasUnknownWrites = true;
      else area.entries.set(key, stored);
      return UNDEFINED_VALUE;
    }
    case "removeItem": {
      if (key === null) area.hasUnknownWrites = true;
      else area.entries.delete(key);
      return UNDEFINED_VALUE;
    }
    case "clear":
      area.entries.clear();
      area.hasUnknownWrites = false;
      return UNDEFINED_VALUE;
    case "key": {
      if (area.hasUnknownWrites) return describe("after a dynamic write");
      if (first?.kind !== "primitive") return describe("with a dynamic index");
      const storedKey = [...area.entries.keys()][Number(first.value)];
      return storedKey === undefined ? NULL_VALUE : primitiveValue(storedKey);
    }
    default:
      return null;
  }
};
