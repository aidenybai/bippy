import { expect, it, vi } from "vite-plus/test";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { constructBinary, getBinaryByteLength } from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  createSymbolValue,
  getObjectProperty,
  primitiveValue,
} from "../src/evaluate/values.js";

interface NativeBinary {
  byteLength: number;
}
const constructors = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  ArrayBuffer,
};
it.each(Object.entries(constructors))(
  "retains the allocation bound for %s after truncation",
  (name, constructor) => {
    const native: NativeBinary = Reflect.construct(constructor, [65536.9]);
    const beyond: NativeBinary = Reflect.construct(constructor, [65537]);
    expect(beyond.byteLength).toBeGreaterThan(native.byteLength);
    const construct = vi.spyOn(Reflect, "construct");
    try {
      const result = constructBinary(name, [primitiveValue(65536.9)], null);
      if (result.kind !== "list") throw new Error("Expected a bounded binary list");
      expect(result.items).toHaveLength(65536);
      expect(getBinaryByteLength(result)).toBe(native.byteLength);
      expect(
        result.items.every((item) => item.kind === "primitive" && Object.is(item.value, 0)),
      ).toBe(true);
      for (const length of ["65537", Number.MAX_SAFE_INTEGER])
        expect(constructBinary(name, [primitiveValue(length)], null)).toMatchObject({
          kind: "unknown",
          reason: `new ${name}() longer than the analysis follows`,
        });
      expect(construct).not.toHaveBeenCalled();
    } finally {
      construct.mockRestore();
    }
  },
);
it.each(["Uint8Array", "ArrayBuffer"])(
  "keeps %s length errors modeled with opaque stacks",
  (name) => {
    for (const input of [
      { native: -1.9, modeled: primitiveValue(-1.9) },
      { native: 1n, modeled: primitiveValue(1n) },
      { native: Symbol("length"), modeled: createSymbolValue("length") },
    ]) {
      let nativeError: unknown;
      try {
        Reflect.construct(name === "ArrayBuffer" ? ArrayBuffer : Uint8Array, [input.native]);
      } catch (error) {
        nativeError = error;
      }
      if (!(nativeError instanceof Error)) throw new Error("Expected native failure");
      const result = constructBinary(name, [input.modeled], null);
      expect(getThrowCertainty(result)).toBe("always");
      const error = getCaughtValue(result, null);
      if (error.kind !== "object") throw new Error("Expected modeled error");
      expect(getObjectProperty(error, "name")).toEqual(primitiveValue(nativeError.name));
      expect(getObjectProperty(error, "message")).toEqual(primitiveValue(nativeError.message));
      expect(getObjectProperty(error, "stack")).toMatchObject({
        kind: "unknown-primitive",
        primitiveType: "string",
      });
    }
  },
);
it.each(["Uint8Array", "ArrayBuffer"])("preserves %s length choice metadata", (name) => {
  const source = branchValue(
    [primitiveValue("2.9"), primitiveValue("Infinity")],
    "length",
    null,
    1,
    createPathPredicate("length", null),
  );
  const result = constructBinary(name, [source], null);
  if (source.kind !== "branch" || result.kind !== "branch")
    throw new Error("Expected length choices");
  expect(result.preferredIndex).toBe(1);
  expect(getAlternativeGuards(result)).toEqual(getAlternativeGuards(source));
  expect(getBinaryByteLength(result.alternatives[0])).toBe(2);
  expect(getThrowCertainty(result.alternatives[1])).toBe("always");
});
