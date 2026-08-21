import { isValidElement } from "bippy";
import type { HooksNode } from "bippy/source";
import type { HookNode } from "./types.js";

const MAX_NORMALIZE_DEPTH = 3;

interface NormalizedCollection {
  entries: unknown[];
  size: number;
  type: "Map" | "Set";
}

export const safeReadProperty = (target: object, key: string): unknown => {
  try {
    return Reflect.get(target, key);
  } catch (error) {
    return `[Exception: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

export const normalizeValue = (
  value: unknown,
  seenValues: Set<unknown> = new Set(),
  depth = 0,
): unknown => {
  if (value === undefined) return null;
  if (typeof value === "function") return value.name ? `[fn ${value.name}]` : "[fn]";
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value === "bigint") return `${String(value)}n`;
  if (typeof value !== "object" || value === null) return value;
  if (isValidElement(value)) return "[React element]";
  if (value instanceof Date) {
    return `[Date ${Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()}]`;
  }
  if (depth >= MAX_NORMALIZE_DEPTH) return "[max depth]";
  if (seenValues.has(value)) return "[circular]";

  seenValues.add(value);
  if (Array.isArray(value)) {
    const normalizedArray = value.map((entry) => normalizeValue(entry, seenValues, depth + 1));
    seenValues.delete(value);
    return normalizedArray;
  }

  if (value instanceof Map || value instanceof Set) {
    const normalizedCollection: NormalizedCollection = {
      entries: [],
      size: value.size,
      type: value instanceof Map ? "Map" : "Set",
    };
    for (const entry of value) {
      normalizedCollection.entries.push(normalizeValue(entry, seenValues, depth + 1));
    }
    seenValues.delete(value);
    return normalizedCollection;
  }

  const normalizedObject: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    normalizedObject[key] = normalizeValue(safeReadProperty(value, key), seenValues, depth + 1);
  }
  seenValues.delete(value);
  return normalizedObject;
};

export const normalizeProps = (props: unknown): Record<string, unknown> | null => {
  if (typeof props !== "object" || props === null) return null;
  const normalizedProps: Record<string, unknown> = {};

  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    normalizedProps[key] = normalizeValue(safeReadProperty(props, key));
  }

  return Object.keys(normalizedProps).length > 0 ? normalizedProps : null;
};

export const normalizeHooks = (hooks: HooksNode[]): HookNode[] =>
  hooks.flatMap((hook) => {
    const subHooks = normalizeHooks(hook.subHooks);
    if (
      hook.id === null &&
      hook.value === undefined &&
      subHooks.length === 1 &&
      subHooks[0].name === hook.name
    ) {
      return subHooks;
    }
    return [
      {
        id: hook.id,
        name: hook.name,
        subHooks,
        value: normalizeValue(hook.value),
      },
    ];
  });
