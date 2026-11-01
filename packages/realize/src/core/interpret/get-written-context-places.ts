import { InstructionKind } from "../../react-compiler/HIR/HIR";
import type { HIRFunction, IdentifierId, Place } from "../../react-compiler/HIR/HIR";
import { memoizeByIdentity } from "../shared/memoize-by-identity";
import { isFunctionCreation } from "./is-function-creation";
import { getMutatedPlace } from "./get-mutated-place";

const collectStoredPlaces = (hirFunction: HIRFunction): Place[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) => {
      if (instruction.value.kind === "StoreContext") return [instruction.value.lvalue.place];
      return isFunctionCreation(instruction.value)
        ? collectStoredPlaces(instruction.value.loweredFunc.func)
        : [];
    }),
  );

const collectReassignedPlaces = (hirFunction: HIRFunction): Place[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) => {
      if (instruction.value.kind === "StoreContext")
        return instruction.value.lvalue.kind === InstructionKind.Reassign
          ? [instruction.value.lvalue.place]
          : [];
      return isFunctionCreation(instruction.value)
        ? collectReassignedPlaces(instruction.value.loweredFunc.func)
        : [];
    }),
  );

export const getReassignedIds = memoizeByIdentity(
  (hirFunction: HIRFunction): Set<IdentifierId> =>
    new Set(collectReassignedPlaces(hirFunction).map((place) => place.identifier.id)),
);

const collectMutatedPlaces = (hirFunction: HIRFunction): Place[] =>
  (hirFunction.aliasingEffects ?? []).flatMap((effect) => {
    const mutatedPlace = getMutatedPlace(effect);
    return mutatedPlace ? [mutatedPlace] : [];
  });

const getCapturedIds = (hirFunction: HIRFunction): Set<IdentifierId> =>
  new Set(hirFunction.context.map((place) => place.identifier.id));

const storedContextPlaces = new WeakMap<HIRFunction, Place[]>();

export const getStoredContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const cached = storedContextPlaces.get(hirFunction);
  if (cached) return cached;
  const capturedIds = getCapturedIds(hirFunction);
  const places = collectStoredPlaces(hirFunction).filter((place) =>
    capturedIds.has(place.identifier.id),
  );
  storedContextPlaces.set(hirFunction, places);
  return places;
};

export const getWrittenContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const capturedIds = getCapturedIds(hirFunction);
  return [...collectStoredPlaces(hirFunction), ...collectMutatedPlaces(hirFunction)].filter(
    (place) => capturedIds.has(place.identifier.id),
  );
};
