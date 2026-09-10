import type { CapturedPageState, SourceLocation, StaticValue } from "../types.js";
import { recordInputSource } from "./predicates.js";
import { toStringValue } from "./primitive-shapes.js";
import { NULL_VALUE, UNDEFINED_VALUE, primitiveValue, unknownValue } from "./values.js";

/**
 * Web Storage as the captured page's first script found it; without a capture,
 * as a fresh browser profile holds it (empty). Later state comes only from
 * writes performed by the interpreted code: a write under a known key replaces
 * that key's (possibly uncertain) text, a write under a dynamic key loses
 * track of which entries exist.
 */
export interface StorageArea {
  readonly entries: Map<string, StaticValue>;
  hasDynamicKeyWrites: boolean;
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
  entries: new Map(
    Object.entries(entries).map(([key, stored]) => [key, primitiveValue(stored)]),
  ),
  hasDynamicKeyWrites: false,
});

export const createStorageAreas = (page: CapturedPageState | null): StorageAreas => ({
  localStorage: createStorageArea(page?.localStorage),
  sessionStorage: createStorageArea(page?.sessionStorage),
});

const toStorageKey = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" ? String(value.value) : null;

export const getStorageLength = (area: StorageArea, areaName: StorageAreaName): StaticValue =>
  area.hasDynamicKeyWrites
    ? unknownValue(`${areaName}.length after a write under a dynamic key`)
    : primitiveValue(area.entries.size);

export const callStorageMethod = (
  area: StorageArea,
  areaName: StorageAreaName,
  methodName: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue | null => {
  const [first, second] = args;
  const key = toStorageKey(first);
  const describe = (detail: string) =>
    recordInputSource(
      unknownValue(`${areaName}.${methodName} ${detail}`, location),
      "storage",
      location,
    );

  switch (methodName) {
    case "getItem": {
      if (area.hasDynamicKeyWrites) return describe("after a write under a dynamic key");
      if (key === null) return describe("with a dynamic key");
      return area.entries.get(key) ?? NULL_VALUE;
    }
    case "setItem": {
      if (key === null) area.hasDynamicKeyWrites = true;
      else area.entries.set(key, toStringValue(second ?? UNDEFINED_VALUE));
      return UNDEFINED_VALUE;
    }
    case "removeItem": {
      if (key === null) area.hasDynamicKeyWrites = true;
      else area.entries.delete(key);
      return UNDEFINED_VALUE;
    }
    case "clear":
      area.entries.clear();
      area.hasDynamicKeyWrites = false;
      return UNDEFINED_VALUE;
    case "key": {
      if (area.hasDynamicKeyWrites) return describe("after a write under a dynamic key");
      if (first?.kind !== "primitive") return describe("with a dynamic index");
      const storedKey = [...area.entries.keys()][Number(first.value)];
      return storedKey === undefined ? NULL_VALUE : primitiveValue(storedKey);
    }
    default:
      return null;
  }
};
