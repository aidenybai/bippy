export const isPlainObject = (item: unknown): item is Record<string, unknown> => {
  if (typeof item !== "object" || item === null) return false;
  const prototype = Object.getPrototypeOf(item);
  return (
    (prototype === null ||
      prototype === Object.prototype ||
      Object.getPrototypeOf(prototype) === null) &&
    !(Symbol.toStringTag in item) &&
    !(Symbol.iterator in item)
  );
};

const deepClone = (source: unknown): unknown => {
  if (!isPlainObject(source)) return source;
  const output: Record<string, unknown> = {};
  Object.keys(source).forEach((key) => {
    output[key] = deepClone(source[key]);
  });
  return output;
};

export const deepmerge = <T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T => {
  const output = { ...target };
  if (isPlainObject(target) && isPlainObject(source)) {
    Object.keys(source).forEach((key) => {
      if (key === "__proto__") return;
      const sourceValue = source[key];
      const targetValue = target[key];
      const merged =
        isPlainObject(sourceValue) && key in target && isPlainObject(targetValue)
          ? deepmerge(targetValue, sourceValue)
          : isPlainObject(sourceValue)
            ? deepClone(sourceValue)
            : sourceValue;
      Object.assign(output, { [key]: merged });
    });
  }
  return output;
};
