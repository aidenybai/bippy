import type { Place } from "../../react-compiler/HIR/HIR";
import type { AliasingEffect } from "../../react-compiler/Inference/AliasingEffects";

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
