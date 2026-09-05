const getContainer = (value: unknown, property: number | string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, property);
};

const cloneContainer = (
  value: unknown,
  property: number | string,
): Record<PropertyKey, unknown> | unknown[] => {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === "object" && value !== null) return { ...value };
  return typeof property === "number" ? [] : {};
};

export const copyWithSet = (
  source: unknown,
  path: Array<number | string>,
  value: unknown,
): unknown => {
  if (path.length === 0) return value;
  const [property, ...remainingPath] = path;
  const clone = cloneContainer(source, property);
  Reflect.set(clone, property, copyWithSet(getContainer(source, property), remainingPath, value));
  return clone;
};

export const copyWithDelete = (source: unknown, path: Array<number | string>): unknown => {
  if (path.length === 0) return undefined;
  const [property, ...remainingPath] = path;
  const clone = cloneContainer(source, property);
  if (remainingPath.length === 0) {
    if (Array.isArray(clone) && typeof property === "number") clone.splice(property, 1);
    else Reflect.deleteProperty(clone, property);
  } else {
    Reflect.set(clone, property, copyWithDelete(getContainer(source, property), remainingPath));
  }
  return clone;
};

export const copyWithRename = (
  source: unknown,
  oldPath: Array<number | string>,
  newPath: Array<number | string>,
): unknown => {
  if (oldPath.length === 0 || newPath.length === 0) return source;
  const value = oldPath.reduce(getContainer, source);
  return copyWithSet(copyWithDelete(source, oldPath), newPath, value);
};
