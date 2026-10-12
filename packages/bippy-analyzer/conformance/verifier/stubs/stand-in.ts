const EMPTY_ARRAY_METHODS = new Set([
  "map",
  "filter",
  "flatMap",
  "flat",
  "slice",
  "concat",
  "sort",
  "toSorted",
  "reverse",
  "entries",
  "keys",
  "values",
]);

/**
 * A stand-in for any value: the fields of a library object, like a TanStack table, that
 * its type has too many of to sample, and the exports of a server SDK. It can be called,
 * constructed, extended, read, awaited and iterated, acts as an empty list, and React
 * renders nothing for it.
 */
export const STAND_IN: unknown = new Proxy(function standIn() {}, {
  apply: () => STAND_IN,
  construct: () => Object(STAND_IN),
  get: (target, key) => {
    if (key === Symbol.iterator) return function* () {};
    if (key === Symbol.toPrimitive) return () => "";
    if (key === "prototype") return Reflect.get(target, key);
    if (typeof key === "symbol" || key === "then" || key === "$$typeof" || key === "toJSON")
      return undefined;
    if (key === "length" || key === "size") return 0;
    if (EMPTY_ARRAY_METHODS.has(key)) return () => [];
    if (key === "reduce") return (_reducer: unknown, initial: unknown) => initial;
    if (key === "find" || key === "at") return () => undefined;
    if (key === "some" || key === "includes") return () => false;
    if (key === "every") return () => true;
    if (key === "join" || key === "toString") return () => "";
    return STAND_IN;
  },
});
