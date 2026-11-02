import { InstructionKind } from "../../react-compiler/HIR/HIR";
import type { HIRFunction, IdentifierId, LValue, Place } from "../../react-compiler/HIR/HIR";
import { isFunctionCreation } from "./is-function-creation";
import { getMutatedPlace } from "./get-mutated-place";

const collectStoredLValues = (hirFunction: HIRFunction): LValue[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) => {
      if (instruction.value.kind === "StoreContext") return [instruction.value.lvalue];
      return isFunctionCreation(instruction.value)
        ? collectStoredLValues(instruction.value.loweredFunc.func)
        : [];
    }),
  );

const collectStoredPlaces = (hirFunction: HIRFunction): Place[] =>
  collectStoredLValues(hirFunction).map((lvalue) => lvalue.place);

const collectReassignedPlaces = (hirFunction: HIRFunction): Place[] =>
  collectStoredLValues(hirFunction)
    .filter((lvalue) => lvalue.kind === InstructionKind.Reassign)
    .map((lvalue) => lvalue.place);

export const getReassignedIds = (hirFunction: HIRFunction): Set<IdentifierId> =>
  new Set(collectReassignedPlaces(hirFunction).map((place) => place.identifier.id));

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
