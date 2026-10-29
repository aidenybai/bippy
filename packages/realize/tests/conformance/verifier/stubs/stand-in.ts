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

const STAND_IN_PROTOTYPE: object = new Proxy(Object.create(null), {
  get: (_target, key) => Reflect.get(Object(STAND_IN), key),
});

export const STAND_IN: unknown = new Proxy(function standIn() {}, {
  getPrototypeOf: () => STAND_IN_PROTOTYPE,
  apply: () => STAND_IN,
  construct: () => Object(STAND_IN),
  get: (target, key) => {
    if (key === Symbol.iterator) return function* () {};
    if (key === Symbol.toPrimitive) return () => "";
    if (key === "prototype") return Reflect.get(target, key);
    if (
      typeof key === "symbol" ||
      key === "then" ||
      key === "$$typeof" ||
      key === "toJSON" ||
      key === "__esModule"
    )
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
