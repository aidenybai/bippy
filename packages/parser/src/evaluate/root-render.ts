import type { JournaledState, SourceLocation, StaticValue } from "../types.js";
import { UNDEFINED_VALUE, branchValue, getAllocationCount } from "./values.js";

/** Journaled root element so an entry that mounts different trees on different paths keeps one alternative per path. */
export class RootRenderState implements JournaledState<StaticValue | null> {
  readonly allocation = getAllocationCount();
  element: StaticValue | null = null;

  capture(): StaticValue | null {
    return this.element;
  }

  restore(snapshot: StaticValue | null): void {
    this.element = snapshot;
  }

  join(
    snapshots: (StaticValue | null)[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): void {
    if (snapshots.every((snapshot) => snapshot === null)) {
      this.element = null;
      return;
    }
    const alternatives = snapshots.map((snapshot) => snapshot ?? UNDEFINED_VALUE);
    this.element = alternatives.every((alternative) => alternative === alternatives[0])
      ? alternatives[0]
      : branchValue(alternatives, reason, location, preferredPath, predicate);
  }
}
