import type { HIRFunction, IdentifierId, Place } from "../../react-compiler/HIR/HIR";
import { getConditionallyMutatedPlace } from "./get-conditionally-mutated-place";
import { getMutatedPlace } from "./get-mutated-place";
import { isFunctionCreation } from "./is-function-creation";

const collectMutatedIds = (hirFunction: HIRFunction, mutatedIds: Set<IdentifierId>): void => {
  for (const block of hirFunction.body.blocks.values())
    for (const { value, effects } of block.instructions) {
      if (!isFunctionCreation(value)) continue;
      for (const effect of [
        ...(effects ?? []),
        ...(value.loweredFunc.func.aliasingEffects ?? []),
      ]) {
        const mutatedPlace = getMutatedPlace(effect) ?? getConditionallyMutatedPlace(effect);
        if (mutatedPlace) mutatedIds.add(mutatedPlace.identifier.id);
      }
      collectMutatedIds(value.loweredFunc.func, mutatedIds);
    }
};

export const getClosureMutatedLocals = (hirFunction: HIRFunction): Map<IdentifierId, Place> => {
  const mutatedIds = new Set<IdentifierId>();
  collectMutatedIds(hirFunction, mutatedIds);
  const localsByValue = new Map<IdentifierId, Place>();
  for (const block of hirFunction.body.blocks.values())
    for (const { value } of block.instructions)
      if (value.kind === "StoreLocal" && mutatedIds.has(value.lvalue.place.identifier.id))
        localsByValue.set(value.value.identifier.id, value.lvalue.place);
  return localsByValue;
};
