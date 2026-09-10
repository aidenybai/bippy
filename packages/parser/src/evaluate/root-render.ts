import type { JournaledState, SourceLocation, StaticValue } from "../types.js";
import { UNDEFINED_VALUE, branchValue, getAllocationCount } from "./values.js";

export interface StaticRootRender {
  container: StaticValue;
  element: StaticValue | null;
}

/**
 * Journaled React roots in creation order (a root's id is its index): every
 * `createRoot` / `hydrateRoot` opens a new root (React warns and still creates
 * one on a reused container), `root.render` re-renders that root, and legacy
 * `ReactDOM.render` reuses the root already attached to the same container. An
 * entry that mounts different trees on different paths keeps one alternative
 * per path for each root; a root only one path opened renders nothing on the
 * others.
 */
export type StaticRootRenders = readonly StaticRootRender[];

export class RootRenderState implements JournaledState<StaticRootRenders> {
  readonly allocation = getAllocationCount();
  private roots: StaticRootRenders = [];

  /** The rendered roots in creation order, skipping roots never rendered into. */
  get elements(): StaticValue[] {
    return this.roots.flatMap((root) => (root.element === null ? [] : [root.element]));
  }

  createRoot(container: StaticValue, element: StaticValue | null): number {
    this.roots = [...this.roots, { container, element }];
    return this.roots.length - 1;
  }

  findRoot(container: StaticValue): number | null {
    const rootId = this.roots.findIndex((root) => root.container === container);
    return rootId === -1 ? null : rootId;
  }

  render(rootId: number, element: StaticValue): void {
    this.roots = this.roots.map((root, index) => (index === rootId ? { ...root, element } : root));
  }

  capture(): StaticRootRenders {
    return this.roots;
  }

  restore(snapshot: StaticRootRenders): void {
    this.roots = snapshot;
  }

  join(
    snapshots: StaticRootRenders[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): void {
    const rootCount = Math.max(0, ...snapshots.map((snapshot) => snapshot.length));
    this.roots = Array.from({ length: rootCount }, (_, rootId) => {
      const roots = snapshots.map((snapshot) => snapshot[rootId] ?? null);
      const container = roots.find((root) => root !== null)?.container ?? UNDEFINED_VALUE;
      if (roots.every((root) => root === null || root.element === null)) {
        return { container, element: null };
      }
      const alternatives = roots.map((root) => root?.element ?? UNDEFINED_VALUE);
      return {
        container,
        element: alternatives.every((alternative) => alternative === alternatives[0])
          ? alternatives[0]
          : branchValue(alternatives, reason, location, preferredPath, predicate),
      };
    });
  }
}
