import type { SourceLocation, Place } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

export const getDeclarationLocation = (place: Place): SourceLocation =>
  place.identifier.loc === GeneratedSource ? place.loc : place.identifier.loc;
