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

const getChildValues = (value: object): unknown[] => {
  if (value instanceof Map) return [...value].flat();
  if (value instanceof Set) return [...value];
  if (value instanceof Date) return [];
  return Object.values(value);
};

/**
 * Visits every plain object and array reachable from a value, stopping at class instances,
 * cycles and a depth limit.
 */
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

/**
 * Serializes the plain data reachable from a value, so two snapshots of the same object
 * differ exactly when its contents changed. Functions, class instances and cycles become
 * markers instead of being followed.
 */
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
    if (ancestors.has(current)) return "[cycle]";
    nodeCount++;
    if (depth >= MAX_SNAPSHOT_DEPTH || nodeCount > MAX_SNAPSHOT_NODES) return "[truncated]";
    ancestors.add(current);
    const snapshot =
      current instanceof Date
        ? { date: current.getTime() }
        : current instanceof Map
          ? {
              map: [...current].map(([key, item]) => [
                visit(key, depth + 1),
                visit(item, depth + 1),
              ]),
            }
          : current instanceof Set
            ? { set: [...current].map((item) => visit(item, depth + 1)) }
            : Array.isArray(current)
              ? { array: current.map((item) => visit(item, depth + 1)) }
              : {
                  object: Object.entries(current).map(([key, item]) => [
                    key,
                    visit(item, depth + 1),
                  ]),
                };
    ancestors.delete(current);
    return snapshot;
  };
  return JSON.stringify(visit(value, 0));
};
