import { expect, it } from "vite-plus/test";
import { compareIdentity } from "../src/evaluate/values.js";
import { createFunctionComponentDefinition } from "../src/react/element-type.js";
import type { StaticFunctionValue, StaticValue } from "../src/types.js";
import { evaluateCases } from "./helpers/differential-evaluator.js";

it.each([false, true])(
  "keeps non-constructor error messages and stacks opaque: bound=%s",
  async (isBound) => {
    const [result] = await evaluateCases([
      {
        name: "non-constructor error",
        body: `const target=()=>0;const Bound=${isBound ? "target.bind(null)" : "target"};try{new Bound();}catch(error){return [error.name,error.message,error.stack];}`,
      },
    ]);
    if (result.kind !== "list") throw new Error("Expected error fields");
    expect(result.items[0]).toEqual({ kind: "primitive", value: "TypeError" });
    for (const value of result.items.slice(1)) {
      expect(value.kind).toBe("unknown-primitive");
      if (value.kind === "unknown-primitive") expect(value.primitiveType).toBe("string");
    }
  },
);

const getReference = (value: StaticFunctionValue): StaticValue => ({
  kind: "component-reference",
  type: { kind: "function", component: createFunctionComponentDefinition(value) },
});
it("preserves bound identity through clones and component references", async () => {
  const [result] = await evaluateCases([
    {
      name: "bound identities",
      body: "const target=()=>0;return [target,target.bind(null),target.bind(null)];",
    },
  ]);
  if (result.kind !== "list") throw new Error("Expected functions");
  const [target, first, second] = result.items;
  if (target.kind !== "function" || first.kind !== "function" || second.kind !== "function")
    throw new Error("Expected functions");
  expect(first.boundTarget).toBe(target);
  expect(second.boundTarget).toBe(target);
  expect(createFunctionComponentDefinition(first).boundTarget).toBe(target);
  expect(first.boundIdentity).toBeTypeOf("number");
  expect(second.boundIdentity).not.toBe(first.boundIdentity);
  expect(compareIdentity(first, { ...first })).toBe(true);
  expect(compareIdentity(first, getReference(first))).toBe(true);
  expect(compareIdentity(getReference(first), getReference(first))).toBe(true);
  expect(compareIdentity(getReference(first), getReference(second))).toBe(false);
  expect(compareIdentity(getReference(first), target)).toBe(false);
  expect(compareIdentity(target, getReference(first))).toBe(false);
  expect(compareIdentity(first, { ...first, boundIdentity: undefined })).toBeNull();
});
