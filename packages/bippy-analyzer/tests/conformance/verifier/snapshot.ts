import { TRUNCATED_VALUE } from "./types";

const MAX_SNAPSHOT_DEPTH = 6;
const MAX_SNAPSHOT_NODES = 2000;

export const isPlainData = (value: unknown): value is object => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null ||
    Array.isArray(value) ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date
  );
};

export const isRefObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(value).length === 1 &&
  Object.hasOwn(value, "current");

export const isPlainRecord = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
};

const getChildValues = (value: object): unknown[] => {
  if (value instanceof Map) return [...value].flat();
  if (value instanceof Set) return [...value];
  if (value instanceof Date) return [];
  return Object.values(value);
};

export const forEachPlainObject = (value: unknown, visitor: (object: object) => void): void => {
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): void => {
    if (!isPlainData(current) || seen.has(current) || depth >= MAX_SNAPSHOT_DEPTH) return;
    if (seen.size >= MAX_SNAPSHOT_NODES) return;
    seen.add(current);
    visitor(current);
    for (const child of getChildValues(current)) visit(child, depth + 1);
  };
  visit(value, 0);
};

const snapshotContainer = (container: object, visitItem: (item: unknown) => unknown): object => {
  if (container instanceof Date) return { date: container.getTime() };
  if (container instanceof Map)
    return { map: [...container].map(([key, item]) => [visitItem(key), visitItem(item)]) };
  if (container instanceof Set) return { set: [...container].map(visitItem) };
  if (Array.isArray(container)) return { array: container.map(visitItem) };
  return { object: Object.entries(container).map(([key, item]) => [key, visitItem(item)]) };
};

export const snapshotValue = (value: unknown): string => {
  const ancestors = new Set<object>();
  let nodeCount = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (current === undefined) return "[undefined]";
    if (typeof current === "function") return "[function]";
    if (typeof current === "bigint" || typeof current === "symbol") return String(current);
    if (typeof current === "number" && !Number.isFinite(current)) return String(current);
    if (current === null || typeof current !== "object") return current;
    if (!isPlainData(current)) return "[instance]";
    if (isRefObject(current)) return "[ref]";
    if (ancestors.has(current)) return "[cycle]";
    nodeCount++;
    if (depth >= MAX_SNAPSHOT_DEPTH || nodeCount > MAX_SNAPSHOT_NODES) return TRUNCATED_VALUE;
    ancestors.add(current);
    const snapshot = snapshotContainer(current, (item) => visit(item, depth + 1));
    ancestors.delete(current);
    return snapshot;
  };
  return JSON.stringify(visit(value, 0));
};
