import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import { getRangeKey } from "./get-range-key";

export const getLocationKey = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "generated" : getRangeKey(loc.start.index, loc.end.index);
