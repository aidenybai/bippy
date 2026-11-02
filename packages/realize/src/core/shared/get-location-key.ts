import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

export const getRangeKey = (start: number, end: number): string => `${start}:${end}`;

export const getLocationKey = (loc: SourceLocation): string =>
  loc === GeneratedSource ? "generated" : getRangeKey(loc.start.index, loc.end.index);
