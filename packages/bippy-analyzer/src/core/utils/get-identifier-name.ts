import type { Place } from "../../react-compiler/HIR/HIR";

export const getIdentifierName = (place: Place): string | null =>
  place.identifier.name?.kind === "named" ? place.identifier.name.value : null;
