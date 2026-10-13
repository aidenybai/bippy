import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { Bailout, BailoutReason, Warning, WarningKind } from "./types";
import { isSameLocation } from "./utils/hir";

/** What the analysis couldn't model, and the bugs it saw, each reported once. */
export class Diagnostics {
  readonly bailouts: Bailout[] = [];
  readonly warnings: Warning[] = [];

  bailOut(reason: BailoutReason, message: string, loc: SourceLocation): void {
    const isDuplicate = this.bailouts.some(
      (bailout) => bailout.reason === reason && isSameLocation(bailout.loc, loc),
    );
    if (!isDuplicate) this.bailouts.push({ reason, message, loc });
  }

  warn(kind: WarningKind, message: string, loc: SourceLocation, file: string): void {
    const isDuplicate = this.warnings.some(
      (warning) => warning.kind === kind && warning.message === message,
    );
    if (!isDuplicate) this.warnings.push({ kind, message, loc, file });
  }
}
