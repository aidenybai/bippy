import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

export const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  left === right ||
  (left !== GeneratedSource &&
    right !== GeneratedSource &&
    left.start.index === right.start.index &&
    left.end.index === right.end.index);
