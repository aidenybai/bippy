import type { HIRFunction, IdentifierId, Place } from "../../react-compiler/HIR/HIR";
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

const getCapturedIds = (hirFunction: HIRFunction): Set<IdentifierId> =>
  new Set(hirFunction.context.map((place) => place.identifier.id));

export const getStoredContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const capturedIds = getCapturedIds(hirFunction);
  return collectStoredPlaces(hirFunction).filter((place) => capturedIds.has(place.identifier.id));
};

export const getWrittenContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const capturedIds = getCapturedIds(hirFunction);
  return [...collectStoredPlaces(hirFunction), ...collectMutatedPlaces(hirFunction)].filter(
    (place) => capturedIds.has(place.identifier.id),
  );
};
