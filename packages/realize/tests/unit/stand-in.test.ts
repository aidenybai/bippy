import { describe, expect, it } from "vite-plus/test";
import { STAND_IN } from "../conformance/verifier/stubs/stand-in";

const toEsModule = (commonJsExports: object): Record<string, unknown> => {
  const namespace = Object.create(Object.getPrototypeOf(commonJsExports));
  Object.defineProperty(namespace, "default", { value: commonJsExports, enumerable: true });
  for (const key of Object.getOwnPropertyNames(commonJsExports))
    if (key !== "default")
      Object.defineProperty(namespace, key, {
        get: () => Reflect.get(commonJsExports, key),
        enumerable: true,
      });
  return namespace;
};

describe("stand-in module", () => {
  it("serves any named import when a bundler wraps it as CommonJS exports", () => {
    const namespace = toEsModule(Object(STAND_IN));
    expect(typeof namespace.createRequire).toBe("function");
    expect(namespace.default).toBe(STAND_IN);
  });

  it("is not mistaken for a promise or an ES module", () => {
    const namespace = toEsModule(Object(STAND_IN));
    expect(namespace.then).toBeUndefined();
    expect(namespace.__esModule).toBeUndefined();
  });

  it("ends its prototype chain", () => {
    expect(Object(STAND_IN) instanceof Date).toBe(false);
  });
});
