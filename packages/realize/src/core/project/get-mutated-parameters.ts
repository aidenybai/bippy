import type { HIRFunction, IdentifierId, Instruction, Place } from "../../react-compiler/HIR/HIR";
import { eachPatternOperand } from "../../react-compiler/HIR/visitors";
import { getMutatedPlace } from "../interpret/get-mutated-place";
import { getPlaceOrSpread } from "../interpret/get-place-or-spread";

interface Derivation {
  source: Place;
  derived: Place[];
  isPart: boolean;
}

interface ParameterPart {
  index: number;
  isPart: boolean;
}

const getDerivation = (instruction: Instruction): Derivation | null => {
  const { value, lvalue } = instruction;
  switch (value.kind) {
    case "LoadLocal":
      return { source: value.place, derived: [lvalue], isPart: false };
    case "StoreLocal":
      return { source: value.value, derived: [value.lvalue.place, lvalue], isPart: false };
    case "PropertyLoad":
    case "ComputedLoad":
      return { source: value.object, derived: [lvalue], isPart: true };
    case "GetIterator":
      return { source: value.collection, derived: [lvalue], isPart: false };
    case "IteratorNext":
      return { source: value.iterator, derived: [lvalue], isPart: true };
    case "Destructure":
      return {
        source: value.value,
        derived: [...eachPatternOperand(value.lvalue.pattern)],
        isPart: true,
      };
    default:
      return null;
  }
};

export const getMutatedParameters = (hirFunction: HIRFunction): Map<number, boolean> => {
  const partsById = new Map<IdentifierId, ParameterPart>(
    hirFunction.params.map((parameter, index) => [
      getPlaceOrSpread(parameter).identifier.id,
      { index, isPart: false },
    ]),
  );
  const mutated = new Map<number, boolean>();
  for (const block of hirFunction.body.blocks.values())
    for (const instruction of block.instructions) {
      const derivation = getDerivation(instruction);
      const source = derivation && partsById.get(derivation.source.identifier.id);
      if (derivation && source)
        for (const derived of derivation.derived)
          partsById.set(derived.identifier.id, {
            index: source.index,
            isPart: source.isPart || derivation.isPart,
          });
      for (const effect of instruction.effects ?? []) {
        const mutatedPlace = getMutatedPlace(effect);
        const part = mutatedPlace && partsById.get(mutatedPlace.identifier.id);
        if (part) mutated.set(part.index, (mutated.get(part.index) ?? false) || part.isPart);
      }
    }
  return mutated;
};
