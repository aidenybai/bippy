import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import type { Binding, SymbolicValue } from "../../src/core/types";
import { getValueKey } from "../../src/core/values/get-value-key";
import { createTestBinding } from "./helpers";

const createBinding = (id: number): Binding =>
  createTestBinding({ id, name: "date", kind: "call" });

const isSameKey = (left: SymbolicValue, right: SymbolicValue): boolean =>
  getValueKey(left) === getValueKey(right);

describe("getValueKey", () => {
  it("tells apart bindings that print the same", () => {
    expect(
      isSameKey(
        { kind: "Binding", binding: createBinding(1), path: [] },
        { kind: "Binding", binding: createBinding(2), path: [] },
      ),
    ).toBe(false);
  });

  it("tells apart functions and primitives that print the same", () => {
    expect(
      isSameKey(
        { kind: "Function", functionId: 1, loc: GeneratedSource },
        { kind: "Function", functionId: 2, loc: GeneratedSource },
      ),
    ).toBe(false);
    expect(isSameKey({ kind: "Primitive", value: "1" }, { kind: "Primitive", value: 1 })).toBe(
      false,
    );
  });

  it("matches the same value built twice", () => {
    const binding = createBinding(1);
    expect(
      isSameKey(
        {
          kind: "UnaryExpression",
          operator: "!",
          value: { kind: "Binding", binding, path: ["a"] },
        },
        {
          kind: "UnaryExpression",
          operator: "!",
          value: { kind: "Binding", binding, path: ["a"] },
        },
      ),
    ).toBe(true);
  });

  it("keeps keys short for values that share subexpressions", () => {
    let value: SymbolicValue = { kind: "Binding", binding: createBinding(1), path: [] };
    for (let depth = 0; depth < 20; depth++)
      value = { kind: "BinaryExpression", operator: "+", left: value, right: value };
    expect(getValueKey(value).length).toBeLessThan(100);
  });
});
