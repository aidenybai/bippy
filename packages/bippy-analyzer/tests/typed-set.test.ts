import { expect, it, vi } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { callTypedSet } from "../src/evaluate/typed-array-set.js";
import {
  binaryValue,
  fillBinaryUnknown,
  getBinaryKind,
  isTypedArrayName,
} from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  createSymbolValue,
  getObjectProperty,
  listValue,
  objectValue,
  optionalValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../src/evaluate/values.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";
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
  "sets 10,000 definite %s elements iteratively",
  async (name, constructor) => {
    if (!isTypedArrayName(name)) throw new Error(name);
    const inputs = Array.from({ length: 10000 }, (_value, index) =>
      index % 2 ? index + 0.5 : -index - 0.25,
    );
    const native = new constructor(10000);
    native.set(inputs);
    const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
    await renderer.renderWith((interpreter) => {
      const source = listValue(inputs.map(primitiveValue));
      const target = binaryValue(
        name,
        inputs.map(() => primitiveValue(0)),
      );
      expect(callTypedSet(interpreter, target, [source], createEvaluationContext(), null)).toBe(
        UNDEFINED_VALUE,
      );
      expect(target.items).toEqual([...native].map(primitiveValue));
      expect(getBinaryKind(target)).toBe(name);
      expect(source.items).toEqual(inputs.map(primitiveValue));
      return primitiveValue("checked");
    });
  },
);
it.each([1n, Symbol("element")])(
  "retains 9,999 writes before %s conversion fails",
  async (nativeElement) => {
    const native = new Uint8Array(10000);
    let nativeError: unknown;
    try {
      Reflect.apply(native.set, native, [
        [...Array.from({ length: 9999 }, () => 257), nativeElement],
      ]);
    } catch (error) {
      nativeError = error;
    }
    if (!(nativeError instanceof TypeError)) throw new Error("Expected native TypeError");
    const nativeMessage = nativeError.message;
    const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
    await renderer.renderWith((interpreter) => {
      const target = binaryValue(
        "Uint8Array",
        Array.from({ length: 10000 }, () => primitiveValue(0)),
      );
      const source = listValue([
        ...Array.from({ length: 9999 }, () => primitiveValue(257)),
        typeof nativeElement === "symbol"
          ? createSymbolValue("element")
          : primitiveValue(nativeElement),
      ]);
      const result = callTypedSet(interpreter, target, [source], createEvaluationContext(), null);
      expect(getThrowCertainty(result)).toBe("always");
      expect(target.items).toEqual([...native].map(primitiveValue));
      const error = getCaughtValue(result, null);
      if (error.kind !== "object") throw new Error("Expected modeled error");
      expect(getObjectProperty(error, "message")).toEqual(primitiveValue(nativeMessage));
      expect(getObjectProperty(error, "stack")).toMatchObject({
        kind: "unknown-primitive",
        primitiveType: "string",
      });
      return primitiveValue("checked");
    });
  },
);
it.each([4, 5])("retains the finite shape limit with %s optional decisions", async (count) => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const source = listValue(
      Array.from({ length: count }, (_value, index) =>
        optionalValue(
          primitiveValue(257),
          "presence",
          null,
          false,
          createPathPredicate(`presence ${index}`, null),
        ),
      ),
    );
    const target = binaryValue(
      "Uint8Array",
      Array.from({ length: 8 }, () => primitiveValue(0)),
    );
    const result = callTypedSet(interpreter, target, [source], createEvaluationContext(), null);
    if (count === 4) {
      expect(result).toBe(UNDEFINED_VALUE);
      expect(target.items.some((item) => item.kind === "branch")).toBe(true);
    } else expect(result).toEqual(unknownValue("Uint8Array.set(): indefinite source length", null));
    expect(target.items).toHaveLength(8);
    expect(source.items).toHaveLength(count);
    expect(getBinaryKind(target)).toBe("Uint8Array");
    return primitiveValue("checked");
  });
});
it.each([1000, 1001])("retains the array-like acquisition bound at %s", async (count) => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue(
      "Float64Array",
      Array.from({ length: 1001 }, () => primitiveValue(0)),
    );
    const source = objectValue([
      { kind: "property", key: "length", value: primitiveValue(count) },
      { kind: "property", key: "0", value: primitiveValue(257) },
    ]);
    const result = callTypedSet(interpreter, target, [source], createEvaluationContext(), null);
    if (count === 1000) {
      const native = new Float64Array(1001);
      native.set({ length: count, 0: 257 });
      expect(result).toBe(UNDEFINED_VALUE);
      expect(target.items).toEqual([...native].map(primitiveValue));
    } else
      expect(result).toEqual(
        unknownValue("Float64Array.set(): array-like source exceeds supported length", null),
      );
    return primitiveValue("checked");
  });
});
it.each([4, 5])("bounds raw completion products at %s by four", async (count) => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const choice = (size: number, label: string) =>
      branchValue(
        [
          ...Array.from({ length: size - 1 }, (_value, index) => primitiveValue(index)),
          primitiveValue(1n),
        ],
        label,
        null,
      );
    const source = listValue([choice(count, "left"), choice(4, "right")]);
    const target = binaryValue("Uint8Array", [primitiveValue(99), primitiveValue(99)]);
    const result = callTypedSet(interpreter, target, [source], createEvaluationContext(), null);
    const alternatives = result.kind === "branch" ? result.alternatives : [result];
    const isRefused = alternatives.some(
      (value) =>
        value.kind === "unknown" &&
        value.reason === "Uint8Array.set(): element completion alternatives exceed supported limit",
    );
    expect(isRefused).toBe(count === 5);
    return primitiveValue("checked");
  });
});
it("stores seventeen numeric alternatives without expanding mutation paths", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const source = listValue([
      branchValue(
        Array.from({ length: 17 }, (_value, index) => primitiveValue(index + 256)),
        "numbers",
        null,
      ),
    ]);
    const target = binaryValue("Uint8Array", [primitiveValue(0)]);
    const spy = vi.spyOn(interpreter, "callAlternatives");
    expect(callTypedSet(interpreter, target, [source], createEvaluationContext(), null)).toBe(
      UNDEFINED_VALUE,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const result = target.items[0];
    if (result.kind !== "branch") throw new Error("Expected numeric alternatives");
    expect(result.alternatives).toEqual(
      Array.from({ length: 17 }, (_value, index) => primitiveValue(index)),
    );
    return primitiveValue("checked");
  });
});
it("refuses opaque offsets, lengths, elements, buffers and indefinite targets", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    for (const args of [
      [listValue([primitiveValue(1)]), unknownValue("offset")],
      [objectValue([{ kind: "property", key: "length", value: unknownValue("length") }])],
      [listValue([objectValue([])])],
      [binaryValue("ArrayBuffer", [primitiveValue(0)])],
    ]) {
      const target = binaryValue("Uint8Array", [primitiveValue(0)]);
      expect(
        callTypedSet(interpreter, target, args, createEvaluationContext(), null),
      ).toMatchObject({ kind: "unknown" });
      expect(target.items[0]).toMatchObject({ kind: "unknown-primitive", primitiveType: "number" });
    }
    const target = binaryValue("Uint8Array", [optionalValue(primitiveValue(0), "presence", null)]);
    expect(
      callTypedSet(interpreter, target, [listValue([])], createEvaluationContext(), null),
    ).toEqual(unknownValue("Uint8Array.set(): indefinite target length", null));
    expect(callTypedSet(interpreter, listValue([]), [], createEvaluationContext(), null)).toEqual(
      unknownValue("typed array set with an incompatible receiver", null),
    );
    return primitiveValue("checked");
  });
});
it("preserves optional presence and repeat counts while invalidating binary values", () => {
  const optional = optionalValue(
    primitiveValue(0),
    "presence",
    null,
    true,
    createPathPredicate("presence", null),
  );
  const target = binaryValue("Uint8Array", [
    optional,
    { kind: "repeat", item: primitiveValue(0), location: null, count: { min: 0, max: 3 } },
  ]);
  fillBinaryUnknown(target, "opaque set");
  expect(target.items[0]).toMatchObject({
    ...optional,
    value: { kind: "unknown-primitive", primitiveType: "number" },
  });
  expect(target.items[1]).toMatchObject({
    kind: "repeat",
    count: { min: 0, max: 3 },
    item: { kind: "unknown-primitive", primitiveType: "number" },
  });
});
it("keeps range errors opaque and rejects oversize sources before the acquisition bound", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue("Uint8Array", [primitiveValue(0)]);
    const result = callTypedSet(
      interpreter,
      target,
      [objectValue([{ kind: "property", key: "length", value: primitiveValue(1001) }])],
      createEvaluationContext(),
      null,
    );
    expect(getThrowCertainty(result)).toBe("always");
    const error = getCaughtValue(result, null);
    if (error.kind !== "object") throw new Error("Expected modeled error");
    expect(getObjectProperty(error, "name")).toEqual(primitiveValue("RangeError"));
    expect(getObjectProperty(error, "message")).toEqual(primitiveValue("offset is out of bounds"));
    expect(getObjectProperty(error, "stack")).toMatchObject({
      kind: "unknown-primitive",
      primitiveType: "string",
    });
    expect(target.items).toEqual([primitiveValue(0)]);
    return primitiveValue("checked");
  });
});
