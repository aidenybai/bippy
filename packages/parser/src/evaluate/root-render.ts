import type { JournaledState, SourceLocation, StaticValue } from "../types.js";
import { branchValue, getAllocationCount } from "./values.js";

/**
 * Journaled root element so an entry that mounts different trees on different
 * paths keeps one alternative per path. Paths that never mount (a missing
 * container, an early return) contribute no alternative: the analysis is of
 * the render that happened.
 */
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
  ): void {
    const rendered = snapshots.flatMap((snapshot, pathIndex) =>
      snapshot === null ? [] : [{ snapshot, pathIndex }],
    );
    if (rendered.length === 0) {
      this.element = null;
      return;
    }
    const alternatives = rendered.map(({ snapshot }) => snapshot);
    const preferredRendered = rendered.findIndex(({ pathIndex }) => pathIndex === preferredPath);
    this.element = alternatives.every((alternative) => alternative === alternatives[0])
      ? alternatives[0]
      : branchValue(alternatives, reason, location, Math.max(preferredRendered, 0));
  }
}
