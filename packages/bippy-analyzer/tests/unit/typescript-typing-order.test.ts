import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { HIRFunction, Instruction, InstructionValue } from "../../src/core/hir/hir.js";
import { getInstructions, lowerProject } from "./helpers.js";

type MethodCall = Extract<InstructionValue, { kind: "MethodCall" }>;

interface MethodCallInstruction {
  instruction: Instruction;
  value: MethodCall;
}

const getMethodCalls = (fn: HIRFunction, method: string): MethodCallInstruction[] => {
  const instructions = getInstructions(fn);
  const propertyNames = new Map(
    instructions.flatMap((instruction) =>
      instruction.value.kind === "PropertyLoad"
        ? [[instruction.lvalue.identifier.id, String(instruction.value.property)]]
        : [],
    ),
  );
  return instructions.flatMap((instruction) =>
    instruction.value.kind === "MethodCall" &&
    propertyNames.get(instruction.value.property.identifier.id) === method
      ? [{ instruction, value: instruction.value }]
      : [],
  );
};

const getOnlyMethodCall = (fn: HIRFunction | undefined, method: string): MethodCallInstruction => {
  if (!fn) throw new Error("Function was not lowered");
  const [call, ...otherCalls] = getMethodCalls(fn, method);
  if (!call || otherCalls.length > 0) throw new Error(`Expected one ${method} call`);
  return call;
};

/**
 * The kinds of the definite mutations an instruction has on the place it was called on.
 */
const getReceiverMutations = (call: MethodCallInstruction): string[] =>
  (call.instruction.effects ?? []).flatMap((effect) => {
    const place =
      effect.kind === "MutateFrozen"
        ? effect.place
        : effect.kind === "Mutate" || effect.kind === "MutateTransitive"
          ? effect.value
          : null;
    return place?.identifier.id === call.value.receiver.identifier.id ? [effect.kind] : [];
  });

const getEffectKinds = (call: MethodCallInstruction): string[] =>
  (call.instruction.effects ?? []).map((effect) => effect.kind);

describe("TypeScript typing order", () => {
  let functions = new Map<string, HIRFunction>();

  beforeAll(() => {
    functions = lowerProject("mutations");
  });

  it("gives items.push in a handler the compiler's own push signature", () => {
    const fn = functions.get("LostUpdate");
    const push = getOnlyMethodCall(fn, "push");
    expect(push.value.property.identifier.type).toEqual(
      fn?.env.getPropertyType(push.value.receiver.identifier.type, "push"),
    );
    expect(getReceiverMutations(push)).toEqual(["Mutate"]);
    expect(getEffectKinds(push)).not.toContain("MutateTransitiveConditionally");
  });

  it("mutates the receiver of a method the compiler doesn't list", () => {
    const copyWithin = getOnlyMethodCall(functions.get("CopyWithinHandler"), "copyWithin");
    expect(getReceiverMutations(copyWithin)).toEqual(["Mutate"]);
  });

  it("mutates the receiver of Map.set", () => {
    expect(getReceiverMutations(getOnlyMethodCall(functions.get("MapStateSet"), "set"))).toEqual([
      "Mutate",
    ]);
  });

  it("marks items.sort() on an array prop during render as MutateFrozen", () => {
    expect(getReceiverMutations(getOnlyMethodCall(functions.get("SortProp"), "sort"))).toEqual([
      "MutateFrozen",
    ]);
  });

  it.each([
    ["MappedList", "map"],
    ["FilteredCount", "filter"],
  ])("leaves the receiver of %s's %s unmutated", (name, method) => {
    expect(getReceiverMutations(getOnlyMethodCall(functions.get(name), method))).toEqual([]);
  });

  it("mutates only the copy in [...items].sort()", () => {
    const sort = getOnlyMethodCall(functions.get("SortedCopy"), "sort");
    expect(getReceiverMutations(sort)).toEqual(["Mutate"]);
    expect(sort.value.receiver.identifier.name).toBeNull();
  });

  it("gives form.tags.push in a handler the compiler's push signature", () => {
    expect(getReceiverMutations(getOnlyMethodCall(functions.get("NestedField"), "push"))).toEqual([
      "Mutate",
    ]);
  });

  it("marks props.items.sort() during render as MutateFrozen", () => {
    expect(
      getReceiverMutations(getOnlyMethodCall(functions.get("SortPropsMember"), "sort")),
    ).toEqual(["MutateFrozen"]);
  });
});
