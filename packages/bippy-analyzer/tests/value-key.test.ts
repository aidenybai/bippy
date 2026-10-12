import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../src/react-compiler/HIR/HIR.js";
import type { Binding, SymbolicValue } from "../src/core/types.js";
import { getValueKey } from "../src/core/utils/value-key.js";

const createBinding = (id: number): Binding => ({
  id,
  name: "date",
  kind: "call",
  hookKind: null,
  propName: null,
  loc: GeneratedSource,
  domain: { kind: "Unknown", reason: "unresolved" },
  samples: [],
  initial: null,
  inputs: [],
});

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
});
