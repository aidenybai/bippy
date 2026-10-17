import type { Place, HIRFunction } from "../../react-compiler/HIR/HIR";
import { isFunctionCreation } from "./is-function-creation";
import { getMutatedPlace } from "./get-mutated-place";

const collectStoredPlaces = (hirFunction: HIRFunction): Place[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) => {
      const { value } = instruction;
      if (value.kind === "StoreContext") return [value.lvalue.place];
      return isFunctionCreation(value) ? collectStoredPlaces(value.loweredFunc.func) : [];
    }),
  );

const collectMutatedPlaces = (hirFunction: HIRFunction): Place[] =>
  (hirFunction.aliasingEffects ?? []).flatMap((effect) => {
    const mutatedPlace = getMutatedPlace(effect);
    return mutatedPlace ? [mutatedPlace] : [];
  });

export const getWrittenContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const capturedIds = new Set(hirFunction.context.map((place) => place.identifier.id));
  return [...collectStoredPlaces(hirFunction), ...collectMutatedPlaces(hirFunction)].filter(
    (place) => capturedIds.has(place.identifier.id),
  );
};
