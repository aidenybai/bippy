import type { HIRFunction, IdentifierId, Instruction, Place } from "../../react-compiler/HIR/HIR";
import { eachPatternOperand } from "../../react-compiler/HIR/visitors";
import { getMutatedPlace } from "./get-mutated-place";
import { getPlaceOrSpread } from "./get-place-or-spread";

const getDerivation = (instruction: Instruction): [Place, Place[]] | null => {
  const { value, lvalue } = instruction;
  switch (value.kind) {
    case "LoadLocal":
      return [value.place, [lvalue]];
    case "StoreLocal":
      return [value.value, [value.lvalue.place, lvalue]];
    case "PropertyLoad":
    case "ComputedLoad":
      return [value.object, [lvalue]];
    case "Destructure":
      return [value.value, [...eachPatternOperand(value.lvalue.pattern)]];
    default:
      return null;
  }
};

export const getMutatedParameters = (hirFunction: HIRFunction): Set<number> => {
  const parameterIndexById = new Map<IdentifierId, number>(
    hirFunction.params.map((parameter, index) => [
      getPlaceOrSpread(parameter).identifier.id,
      index,
    ]),
  );
  const mutated = new Set<number>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const derivation = getDerivation(instruction);
      const sourceIndex = derivation && parameterIndexById.get(derivation[0].identifier.id);
      if (derivation && sourceIndex !== undefined && sourceIndex !== null)
        for (const derived of derivation[1])
          parameterIndexById.set(derived.identifier.id, sourceIndex);
      for (const effect of instruction.effects ?? []) {
        const mutatedPlace = getMutatedPlace(effect);
        const mutatedIndex = mutatedPlace && parameterIndexById.get(mutatedPlace.identifier.id);
        if (mutatedIndex !== undefined && mutatedIndex !== null) mutated.add(mutatedIndex);
      }
    }
  return mutated;
};
