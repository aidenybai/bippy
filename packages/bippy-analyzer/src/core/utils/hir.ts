import type { AliasingEffect } from "../../react-compiler/Inference/AliasingEffects";
import type {
  InstructionValue,
  Place,
  SourceLocation,
  SpreadPattern,
} from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

export const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  left === right ||
  (left !== GeneratedSource &&
    right !== GeneratedSource &&
    left.start.index === right.start.index &&
    left.end.index === right.end.index);

// A function's mutations happen when it's called, not where it's created.
export const isFunctionCreation = (value: InstructionValue): boolean =>
  value.kind === "FunctionExpression" || value.kind === "ObjectMethod";

export const getMutatedPlace = (effect: AliasingEffect): Place | null => {
  switch (effect.kind) {
    case "Mutate":
    case "MutateTransitive":
      return effect.value;
    case "MutateFrozen":
      return effect.place;
    default:
      return null;
  }
};

export const getIdentifierName = (place: Place): string | null =>
  place.identifier.name?.value ?? null;

export const getDeclarationLocation = (place: Place): SourceLocation =>
  place.identifier.loc === GeneratedSource ? place.loc : place.identifier.loc;

export const getPlaceOrSpread = (argument: Place | SpreadPattern): Place =>
  argument.kind === "Spread" ? argument.place : argument;
