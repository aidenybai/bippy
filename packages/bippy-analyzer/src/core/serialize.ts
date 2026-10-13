import type { ProjectAnalysis } from "./types";

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const countReferences = (root: unknown): WeakMap<object, number> => {
  const counts = new WeakMap<object, number>();
  const visit = (value: unknown): void => {
    if (!isObject(value)) return;
    const count = counts.get(value) ?? 0;
    counts.set(value, count + 1);
    if (count > 0) return;
    const children = value instanceof Map ? value.values() : Object.values(value);
    for (const child of children) visit(child);
  };
  visit(root);
  return counts;
};

// Render values share subtrees, so a repeated object is written once with `$id`, then as `{ $ref
// }`.
export const serializeProjectAnalysis = (analysis: ProjectAnalysis): string => {
  const counts = countReferences(analysis.components);
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  return JSON.stringify(
    analysis.components,
    (_key, value: unknown) => {
      if (typeof value === "symbol") return "generated";
      const plain = value instanceof Map ? Object.fromEntries(value) : value;
      if (!isObject(value) || (counts.get(value) ?? 0) < 2) return plain;
      const id = ids.get(value);
      if (id !== undefined) return { $ref: id };
      ids.set(value, nextId);
      return Array.isArray(plain) ? { $id: nextId++, items: plain } : { $id: nextId++, ...plain };
    },
    2,
  );
};
