import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { binaryValue } from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  createSymbolValue,
  getObjectProperty,
  listValue,
  objectValue,
  optionalValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";

it("converts before index validity and keeps errors opaque without writes", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue("Uint8Array", [primitiveValue(1)]);
    for (const key of ["0", "1", "-0", "NaN"])
      for (const value of [primitiveValue(1n), createSymbolValue("token")]) {
        expect(() =>
          Reflect.set(new Uint8Array([1]), key, value.kind === "symbol" ? Symbol("token") : 1n),
        ).toThrow(TypeError);
        const result = interpreter.assignProperty(target, key, value, createEvaluationContext());
        expect(getThrowCertainty(result)).toBe("always");
        const error = getCaughtValue(result, null);
        if (error.kind !== "object") throw new Error("Expected modeled error");
        expect(getObjectProperty(error, "stack")).toMatchObject({
          kind: "unknown-primitive",
          primitiveType: "string",
        });
        expect(target.items).toEqual([primitiveValue(1)]);
        expect(target.properties).toBeUndefined();
      }
    return primitiveValue("checked");
  });
});
it("converts a same-target receiver without changing ordinary array storage", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue("Uint8Array", [primitiveValue(0)]);
    expect(
      interpreter.assignProperty(target, "0", primitiveValue(257), createEvaluationContext(), {
        receiver: target,
      }),
    ).toBe(target);
    expect(target.items).toEqual([primitiveValue(1)]);
    const array = listValue([primitiveValue(0)]);
    interpreter.assignProperty(array, "2", primitiveValue(257), createEvaluationContext());
    expect(array.items).toHaveLength(3);
    expect(array.items[2]).toEqual(primitiveValue(257));
    return primitiveValue("checked");
  });
});
it("refuses foreign receivers and uncertain conversion or lengths", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue("Uint8Array", [primitiveValue(0)]);
    const receiver = objectValue([]);
    expect(
      interpreter.assignProperty(target, "0", primitiveValue(257), createEvaluationContext(), {
        receiver,
      }),
    ).toMatchObject({
      kind: "unknown",
      reason: "typed array indexed write with a foreign receiver",
    });
    expect(target.items).toEqual([primitiveValue(0)]);
    expect(receiver.entries).toEqual([]);
    expect(
      interpreter.assignProperty(target, "0", unknownValue("opaque"), createEvaluationContext()),
    ).toMatchObject({
      kind: "unknown",
      reason: "Uint8Array indexed write with unsupported element conversion",
    });
    const indefinite = binaryValue("Uint8Array", [
      optionalValue(primitiveValue(0), "presence", null),
    ]);
    expect(
      interpreter.assignProperty(indefinite, "0", primitiveValue(1), createEvaluationContext()),
    ).toMatchObject({
      kind: "unknown",
      reason: "typed array indexed write with an indefinite length",
    });
    return primitiveValue("checked");
  });
});
it("converts even for an invalid index on a frozen empty typed array", async () => {
  const native = Object.freeze(new Uint8Array());
  expect(() => Reflect.set(native, "0", 1n)).toThrow(TypeError);
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const target = binaryValue("Uint8Array", []);
    target.isFrozen = true;
    expect(
      getThrowCertainty(
        interpreter.assignProperty(target, "0", primitiveValue(1n), createEvaluationContext()),
      ),
    ).toBe("always");
    expect(
      interpreter.assignProperty(target, "0", primitiveValue(1), createEvaluationContext()),
    ).toBe(target);
    expect(target.items).toEqual([]);
    return primitiveValue("checked");
  });
});
it.each([false, true])(
  "preserves named property fork guards and preference, typed=%s",
  (isTyped) => {
    const target = isTyped
      ? binaryValue("Uint8Array", [primitiveValue(0)])
      : listValue([primitiveValue(0)]);
    target.properties = new Map([["extra", primitiveValue(0)]]);
    const journal = new HeapJournal();
    const predicate = createPathPredicate("property", null);
    const values = [primitiveValue(1n), createSymbolValue("token")];
    for (const value of values) {
      journal.record(target);
      target.properties.set("extra", value);
      journal.endPath();
    }
    journal.join("property", null, 1, predicate);
    const result = target.properties.get("extra");
    const expected = branchValue(values, "property", null, 1, predicate);
    if (result?.kind !== "branch" || expected.kind !== "branch")
      throw new Error("Expected property choices");
    expect(result.alternatives).toEqual(values);
    expect(result.preferredIndex).toBe(1);
    expect(getAlternativeGuards(result)).toEqual(getAlternativeGuards(expected));
  },
);
