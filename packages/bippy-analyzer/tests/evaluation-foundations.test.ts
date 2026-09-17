import { describe, expect, it } from "vite-plus/test";
import { getCollectionKind, type CollectionKind } from "../src/evaluate/collection-values.js";
import { createCollectionValue } from "../src/evaluate/collections.js";
import {
  getIntrinsicGlobal,
  getIntrinsicMemberGlobal,
  getLanguageCounterpart,
  getLanguageObject,
  getNamedSymbolValue,
  getPrototypeConstructorGlobal,
  isEngineGlobal,
  readLanguageValue,
  toLanguagePropertyKey,
} from "../src/evaluate/language-intrinsics.js";
import {
  applyMathToRanges,
  applyNumberRangeOperator,
  compareNumberRanges,
  rangedNumberValue,
} from "../src/evaluate/number-ranges.js";
import {
  getPrototypeOwner,
  isBaseClassPrototype,
  isClassPrototype,
  setPrototypeOwner,
} from "../src/evaluate/prototype-owners.js";
import {
  getExternalMember,
  ITERATOR_PROPERTY_KEY,
  objectValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import type { StaticClassValue, StaticExternalValue } from "../src/types.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const createClassValue = (): StaticClassValue => {
  const context = createEvaluationContext();
  return {
    kind: "class",
    node: createCallbackValue(context).node,
    body: { members: [], superValue: null },
    scope: context.scope,
    module: context.module,
    name: "Base",
    properties: objectValue(),
  };
};

describe("prototype ownership", () => {
  it("distinguishes registered prototypes from ordinary objects", () => {
    const prototype = objectValue();
    expect(getPrototypeOwner(prototype)).toBeNull();
    expect(isClassPrototype(prototype)).toBe(false);
    expect(isBaseClassPrototype(prototype)).toBe(false);
    const owner = createClassValue();
    setPrototypeOwner(prototype, owner);
    expect(getPrototypeOwner(prototype)).toBe(owner);
    expect(isClassPrototype(prototype)).toBe(true);
    expect(isBaseClassPrototype(prototype)).toBe(true);
    expect(isClassPrototype(objectValue())).toBe(false);
  });

  it("reads the registered owner's current superclass rather than a copied classification", () => {
    const prototype = objectValue();
    const owner = createClassValue();
    setPrototypeOwner(prototype, owner);
    owner.body.superValue = primitiveValue(null);
    expect(getPrototypeOwner(prototype)).toBe(owner);
    expect(isBaseClassPrototype(prototype)).toBe(false);
  });
});

describe("language intrinsics", () => {
  it("uses one separate language counterpart for shared intrinsics", () => {
    const counterpart = getLanguageCounterpart(Array.prototype);
    expect(counterpart).not.toBeNull();
    expect(counterpart).not.toBe(Array.prototype);
    expect(getLanguageCounterpart(Array.prototype)).toBe(counterpart);
    expect(getLanguageObject("Array.prototype")).toBe(counterpart);
    expect(getLanguageCounterpart({})).toBeNull();
  });

  it("canonicalizes intrinsic constructors and prototypes but not user classes", () => {
    expect(getIntrinsicGlobal(Array)).toEqual({ kind: "global", name: "Array" });
    expect(getIntrinsicGlobal(Array.prototype)).toEqual({
      kind: "global",
      name: "Array.prototype",
    });
    expect(getPrototypeConstructorGlobal(Array.prototype)).toEqual({
      kind: "global",
      name: "Array",
    });
    expect(getPrototypeConstructorGlobal(null)).toBeNull();
    expect(getIntrinsicGlobal(class ApplicationClass {})).toBeNull();
  });

  it("recognizes captured intrinsic members and named symbols", () => {
    expect(getIntrinsicMemberGlobal(Object.prototype.toString)).toEqual({
      kind: "global",
      name: "Object.prototype.toString",
    });
    expect(getIntrinsicMemberGlobal(Array.prototype)).toEqual({
      kind: "global",
      name: "Array.prototype",
    });
    expect(getIntrinsicMemberGlobal(() => undefined)).toBeNull();
    expect(getNamedSymbolValue(Symbol.iterator)).toEqual({
      kind: "symbol",
      key: "Symbol.iterator",
    });
    expect(getNamedSymbolValue(Symbol.for("bippy.merge"))).toEqual({
      kind: "symbol",
      key: "bippy.merge",
    });
    expect(getNamedSymbolValue(Symbol("bippy.merge"))).toBeNull();
  });

  it("reads language constants and symbol keys without host-document access", () => {
    expect(readLanguageValue("Math.PI")).toEqual(primitiveValue(Math.PI));
    expect(readLanguageValue("Array.prototype.constructor")).toEqual({
      kind: "global",
      name: "Array",
    });
    expect(readLanguageValue("document.body")).toBeNull();
    expect(toLanguagePropertyKey(ITERATOR_PROPERTY_KEY)).toBe(Symbol.iterator);
    expect(toLanguagePropertyKey("length")).toBe("length");
    expect(isEngineGlobal("Array")).toBe(true);
    expect(isEngineGlobal("document")).toBe(false);
  });
});

describe("collection identity", () => {
  it.each(["Map", "Set", "WeakMap", "WeakSet"] satisfies CollectionKind[])(
    "recognizes modeled %s values without treating plain objects as collections",
    (kind) => {
      const value = createCollectionValue(kind, undefined, null);
      expect(value.kind).toBe("object");
      if (value.kind !== "object") throw new Error("Expected a modeled collection");
      expect(getCollectionKind(value)).toBe(kind);
      expect(getCollectionKind(objectValue(value.entries))).toBeNull();
    },
  );
});

describe("numeric range operations", () => {
  it("decides disjoint comparisons without consulting prototype or class evaluation", () => {
    const left = rangedNumberValue("left", { min: 1, max: 3 });
    const right = rangedNumberValue("right", { min: 4, max: 6 });
    expect(compareNumberRanges("<", left, right)).toEqual(primitiveValue(true));
    expect(compareNumberRanges("===", left, right)).toEqual(primitiveValue(false));
    expect(
      compareNumberRanges("<", left, rangedNumberValue("overlap", { min: 2, max: 4 })),
    ).toBeNull();
  });

  it("propagates interval bounds and declines division through zero", () => {
    const left = rangedNumberValue("left", { min: -2, max: 3 });
    const right = rangedNumberValue("right", { min: 4, max: 5 });
    expect(applyNumberRangeOperator("*", left, right)).toMatchObject({
      numberRange: { min: -10, max: 15 },
    });
    expect(applyNumberRangeOperator("/", right, left)).toBeNull();
    expect(applyMathToRanges("abs", [left])).toMatchObject({ numberRange: { min: 0, max: 3 } });
    expect(
      applyMathToRanges("floor", [rangedNumberValue("fraction", { min: -1.2, max: 2.3 })]),
    ).toMatchObject({ numberRange: { min: -2, max: 2 } });
  });
});

describe("external member values", () => {
  it("recognizes React members while retaining opaque derived members", () => {
    const react: StaticExternalValue = {
      kind: "external",
      packageName: "react",
      specifier: "react",
      importedName: "*",
      origin: "binding",
    };
    expect(getExternalMember(react, "useState")).toEqual({ kind: "react-api", api: "useState" });
    expect(getExternalMember(react, "unavailable")).toEqual({
      ...react,
      importedName: "*.unavailable",
      origin: "derived",
    });
  });
});
