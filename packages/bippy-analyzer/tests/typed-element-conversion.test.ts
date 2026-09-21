import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { callArrayFrom } from "../src/evaluate/array-from.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import {
  createTypedElementConverter,
  isTypedArrayName,
  getBinaryKind,
} from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  createSymbolValue,
  getObjectProperty,
  objectValue,
  optionalValue,
  listValue,
  UNDEFINED_VALUE,
  primitiveValue,
  thrownValue,
  unknownValue,
} from "../src/evaluate/values.js";

it.each([4, 5])("retains the finite from shape limit with %i decisions", async (count) => {
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
  let calls = 0;
  const mapper = nativeFunction("map", (args) => {
    calls++;
    expect(args).toHaveLength(2);
    return args[1];
  });
  const renderer = await createStaticRenderer({ rootDirectory: process.cwd() });
  await renderer.renderWith((interpreter) => {
    const result = callArrayFrom(
      interpreter,
      "Uint8Array",
      source,
      mapper,
      UNDEFINED_VALUE,
      createEvaluationContext(),
      null,
    );
    if (count === 5) {
      expect(result).toEqual(unknownValue("Uint8Array.from() with indefinite iterable", null));
      expect(calls).toBe(0);
    } else {
      if (result.kind !== "branch") throw new Error("Expected finite choices");
      expect(result.alternatives).toHaveLength(16);
      for (const alternative of result.alternatives) {
        expect(getBinaryKind(alternative)).toBe("Uint8Array");
        if (alternative.kind !== "list") throw new Error("Expected binary list");
        expect(alternative.items).toEqual(
          [...Uint8Array.from({ length: alternative.items.length }, (_value, index) => index)].map(
            primitiveValue,
          ),
        );
      }
      expect(calls).toBe(32);
    }
    expect(source.items).toHaveLength(count);
    return primitiveValue("checked");
  });
});

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
  "converts 10,000 %s elements with fixed scratch storage",
  (name, constructor) => {
    if (!isTypedArrayName(name)) throw new Error(name);
    const convert = createTypedElementConverter(name, null, `${name}.from()`);
    const inputs = Array.from({ length: 10000 }, (_value, index) =>
      index % 2 === 0 ? index + 0.5 : -index - 0.25,
    );
    expect(inputs.map((value) => convert(primitiveValue(value)))).toEqual(
      [...constructor.from(inputs)].map(primitiveValue),
    );
  },
);
it.each([primitiveValue(1n), createSymbolValue("token")])(
  "models primitive conversion errors without host stacks",
  (value) => {
    const result = createTypedElementConverter("Uint8Array", null, "Uint8Array.from()")(value);
    expect(getThrowCertainty(result)).toBe("always");
    const error = getCaughtValue(result, null);
    if (error.kind !== "object") throw new Error("Expected modeled error");
    expect(getObjectProperty(error, "name")).toEqual(primitiveValue("TypeError"));
    expect(getObjectProperty(error, "message")).toEqual(
      primitiveValue(
        `Cannot convert a ${value.kind === "symbol" ? "Symbol" : "BigInt"} value to a number`,
      ),
    );
    expect(getObjectProperty(error, "stack")).toMatchObject({
      kind: "unknown-primitive",
      primitiveType: "string",
    });
  },
);
it("preserves conversion error guards and preferences", () => {
  const source = branchValue(
    [primitiveValue(257), primitiveValue(1n)],
    "choice",
    null,
    1,
    createPathPredicate("choice", null),
  );
  const result = createTypedElementConverter("Uint8Array", null, "Uint8Array.from()")(source);
  if (source.kind !== "branch" || result.kind !== "branch")
    throw new Error("Expected conversion alternatives");
  expect(result.preferredIndex).toBe(1);
  expect(getAlternativeGuards(result)).toEqual(getAlternativeGuards(source));
  expect(result.alternatives[0]).toEqual(primitiveValue(1));
  expect(getThrowCertainty(result.alternatives[1])).toBe("always");
});
it("preserves mapper throws and refuses opaque or object conversion", () => {
  const convert = createTypedElementConverter("Uint8Array", null, "Uint8Array.from()");
  const thrown = thrownValue("token", primitiveValue("token"), null);
  expect(convert(thrown)).toBe(thrown);
  for (const value of [objectValue([]), unknownValue("opaque", null)])
    expect(convert(value)).toEqual(
      unknownValue("Uint8Array.from() with unsupported element conversion", null),
    );
});
