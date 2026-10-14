import type { AliasingEffect } from "../../react-compiler/Inference/AliasingEffects";
import type {
  HIRFunction,
  InstructionValue,
  Place,
  SourceLocation,
  SpreadPattern,
} from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

export const getRangeKey = (start: number, end: number): string => `${start}:${end}`;

export const getLocationKey = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "generated" : getRangeKey(loc.start.index, loc.end.index);

export const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  left === right ||
  (left !== GeneratedSource &&
    right !== GeneratedSource &&
    left.start.index === right.start.index &&
    left.end.index === right.end.index);

export const isFunctionCreation = (
  value: InstructionValue,
): value is Extract<InstructionValue, { kind: "FunctionExpression" | "ObjectMethod" }> =>
  value.kind === "FunctionExpression" || value.kind === "ObjectMethod";

export const getMutatedPlace = (effect: AliasingEffect): Place | null => {
  switch (effect.kind) {
    case "Mutate":
    case "MutateTransitive":
      return effect.value;
    case "MutateFrozen":
    case "MutateGlobal":
      return effect.place;
    default:
      return null;
  }
};

export const getConditionallyMutatedPlace = (effect: AliasingEffect): Place | null =>
  effect.kind === "MutateConditionally" || effect.kind === "MutateTransitiveConditionally"
    ? effect.value
    : null;

export const getIdentifierName = (place: Place): string | null =>
  place.identifier.name?.value ?? null;

export const getDeclarationLocation = (place: Place): SourceLocation =>
  place.identifier.loc === GeneratedSource ? place.loc : place.identifier.loc;

const collectStoredPlaces = (hirFunction: HIRFunction): Place[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) => {
      const { value } = instruction;
      if (value.kind === "StoreContext") return [value.lvalue.place];
      return isFunctionCreation(value) ? collectStoredPlaces(value.loweredFunc.func) : [];
    }),
  );

export const getStoredContextPlaces = (hirFunction: HIRFunction): Place[] => {
  const capturedIds = new Set(hirFunction.context.map((place) => place.identifier.id));
  return collectStoredPlaces(hirFunction).filter((place) => capturedIds.has(place.identifier.id));
};

export const getPlaceOrSpread = (argument: Place | SpreadPattern): Place =>
  argument.kind === "Spread" ? argument.place : argument;
