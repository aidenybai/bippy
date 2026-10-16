import type { ProjectAnalysis } from "./types";
import { PlaceMap } from "./utils/place-map";

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const countReferences = (root: unknown): WeakMap<object, number> => {
  const referenceCounts = new WeakMap<object, number>();
  const visit = (value: unknown): void => {
    if (!isObject(value)) return;
    const referenceCount = referenceCounts.get(value) ?? 0;
    referenceCounts.set(value, referenceCount + 1);
    if (referenceCount > 0) return;
    const children =
      value instanceof Map || value instanceof PlaceMap ? value.values() : Object.values(value);
    for (const child of children) visit(child);
  };
  visit(root);
  return referenceCounts;
};

export const serializeProjectAnalysis = (analysis: ProjectAnalysis): string => {
  const referenceCounts = countReferences(analysis.components);
  const idsBySharedObject = new WeakMap<object, number>();
  let nextId = 0;
  return JSON.stringify(
    analysis.components,
    (_key, value: unknown) => {
      if (typeof value === "symbol") return "generated";
      const jsonValue = value instanceof Map ? Object.fromEntries(value) : value;
      if (!isObject(value) || (referenceCounts.get(value) ?? 0) < 2) return jsonValue;
      const sharedId = idsBySharedObject.get(value);
      if (sharedId !== undefined) return { $ref: sharedId };
      idsBySharedObject.set(value, nextId);
      return Array.isArray(jsonValue)
        ? { $id: nextId++, items: jsonValue }
        : { $id: nextId++, ...jsonValue };
    },
    2,
  );
};
