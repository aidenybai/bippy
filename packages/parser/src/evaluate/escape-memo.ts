import type {
  ModuleRecord,
  Scope,
  StaticFunctionValue,
  StaticObjectValue,
  StaticValue,
} from "../types.js";

/** A container whose member an escape walk read to resolve a path in a closure body. */
export type EscapeDependency = StaticObjectValue | StaticFunctionValue | Scope | ModuleRecord;

export type EscapeArguments = readonly (StaticValue | null)[];

/** The arguments a closure was followed with; null when it escaped directly rather than as a callee. */
export type EscapeTuple = EscapeArguments | null;

const isSameTuple = (left: EscapeTuple, right: EscapeTuple): boolean =>
  left === null || right === null
    ? left === right
    : left.length === right.length && left.every((argument, index) => argument === right[index]);

/**
 * Closures the escape walk has followed, by argument tuple, with the members
 * each walk read. A closure stays followed until one of those members is
 * reassigned; it is then stale and the next walk follows it again with the
 * same tuples, so a callback stored into a ref after the closure escaped is
 * still reached, while unrelated mutations cost nothing.
 */
export class EscapeMemo {
  private readonly followed = new Map<StaticFunctionValue, EscapeTuple[]>();
  private readonly stale = new Map<StaticFunctionValue, EscapeTuple[]>();
  private readonly dependents = new Map<EscapeDependency, Map<string, Set<StaticFunctionValue>>>();

  /** Records the tuple as followed; false when the closure was already followed with it. */
  follow(closure: StaticFunctionValue, tuple: EscapeTuple): boolean {
    const tuples = this.followed.get(closure);
    if (tuples?.some((followed) => isSameTuple(followed, tuple))) return false;
    if (tuples) tuples.push(tuple);
    else this.followed.set(closure, [tuple]);
    return true;
  }

  addDependency(closure: StaticFunctionValue, dependency: EscapeDependency, key: string): void {
    let byKey = this.dependents.get(dependency);
    if (!byKey) {
      byKey = new Map();
      this.dependents.set(dependency, byKey);
    }
    let closures = byKey.get(key);
    if (!closures) {
      closures = new Set();
      byKey.set(key, closures);
    }
    closures.add(closure);
  }

  /** `key` null: every member of the container may have changed. */
  invalidate(dependency: EscapeDependency, key: string | null): void {
    const byKey = this.dependents.get(dependency);
    if (!byKey) return;
    const closureSets = key === null ? [...byKey.values()] : [byKey.get(key) ?? new Set()];
    for (const closures of closureSets) {
      for (const closure of closures) {
        const tuples = this.followed.get(closure);
        if (!tuples) continue;
        this.followed.delete(closure);
        this.stale.set(closure, tuples);
      }
      closures.clear();
    }
  }

  takeStale(): [StaticFunctionValue, EscapeTuple[]][] {
    const entries = [...this.stale];
    this.stale.clear();
    return entries;
  }
}
