import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { Bailout, BailoutReason, Warning, WarningKind } from "../types";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";

const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  left === right ||
  (left !== GeneratedSource &&
    right !== GeneratedSource &&
    left.start.index === right.start.index &&
    left.end.index === right.end.index);

export class Diagnostics {
  readonly bailouts: Bailout[] = [];
  readonly warnings: Warning[] = [];

  bailOut(reason: BailoutReason, message: string, loc: SourceLocation): void {
    const isDuplicate = this.bailouts.some(
      (bailout) => bailout.reason === reason && isSameLocation(bailout.loc, loc),
    );
    if (!isDuplicate) this.bailouts.push({ reason, message, loc });
  }

  warn(
    kind: WarningKind,
    message: string,
    loc: SourceLocation,
    file: string,
    prop: string | null = null,
  ): void {
    const isDuplicate = this.warnings.some(
      (warning) =>
        warning.kind === kind && warning.message === message && isSameLocation(warning.loc, loc),
    );
    if (!isDuplicate) this.warnings.push({ kind, message, loc, file, prop });
  }
}
