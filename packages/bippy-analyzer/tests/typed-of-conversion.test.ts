import { expect, it } from "vite-plus/test";
import {
  convertTypedElements,
  getBinaryKind,
  isTypedArrayName,
} from "../src/evaluate/typed-arrays.js";
import { primitiveValue, unknownValue } from "../src/evaluate/values.js";

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
};
it.each(Object.entries(constructors))(
  "converts 10,000 independent %s.of arguments",
  (name, constructor) => {
    if (!isTypedArrayName(name)) throw new Error(name);
    const inputs = Array.from({ length: 10000 }, (_value, index) =>
      index % 2 === 0 ? index + 0.5 : -index - 0.25,
    );
    const items = inputs.map(primitiveValue);
    const result = convertTypedElements(name, items, null, `${name}.of()`);
    expect(result.kind).toBe("list");
    if (result.kind !== "list") throw new Error("Expected typed list");
    expect(getBinaryKind(result)).toBe(name);
    expect(result.items).not.toBe(items);
    expect(result.items).toEqual([...constructor.of(...inputs)].map(primitiveValue));
    expect(items).toEqual(inputs.map(primitiveValue));
    items[0] = primitiveValue(100);
    expect(result.items[0]).toEqual(primitiveValue(constructor.of(inputs[0])[0]));
  },
);
it("refuses opaque of conversion without inventing numeric values", () => {
  expect(
    convertTypedElements("Uint8Array", [unknownValue("opaque", null)], null, "Uint8Array.of()"),
  ).toEqual(unknownValue("Uint8Array.of() with unsupported element conversion", null));
});
