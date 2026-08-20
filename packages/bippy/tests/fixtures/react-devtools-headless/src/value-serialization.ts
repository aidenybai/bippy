import { isValidElement } from "bippy";
import type { HooksNode } from "bippy/source";
import type { HookNode } from "./types.js";

const MAX_NORMALIZE_DEPTH = 3;

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
  if (depth >= MAX_NORMALIZE_DEPTH) return "[max depth]";
  if (seenValues.has(value)) return "[circular]";

  seenValues.add(value);
  if (Array.isArray(value)) {
    const normalizedArray = value.map((entry) => normalizeValue(entry, seenValues, depth + 1));
    seenValues.delete(value);
    return normalizedArray;
  }

  const normalizedObject: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    normalizedObject[key] = normalizeValue(Reflect.get(value, key), seenValues, depth + 1);
  }
  seenValues.delete(value);
  return normalizedObject;
};

export const normalizeProps = (props: unknown): Record<string, unknown> | null => {
  if (typeof props !== "object" || props === null) return null;
  const normalizedProps: Record<string, unknown> = {};

  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    normalizedProps[key] = normalizeValue(Reflect.get(props, key));
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
