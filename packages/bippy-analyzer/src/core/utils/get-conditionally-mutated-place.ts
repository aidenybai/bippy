import type { Place } from "../../react-compiler/HIR/HIR";
import type { AliasingEffect } from "../../react-compiler/Inference/AliasingEffects";

export const getConditionallyMutatedPlace = (effect: AliasingEffect): Place | null =>
  effect.kind === "MutateConditionally" || effect.kind === "MutateTransitiveConditionally"
    ? effect.value
    : null;
