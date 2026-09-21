import type { SourceLocation } from "../parse/source-types.js";
import type { Scope, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import {
  branchValue,
  countAlternatives,
  UNDEFINED_VALUE,
  widenLoopCarriedValue,
} from "./values.js";

export interface ScopeSnapshot {
  scope: Scope;
  bindings: Map<string, StaticValue>;
}

export const snapshotScopes = (scope: Scope | null, additionalScope?: Scope): ScopeSnapshot[] => {
  const snapshots: ScopeSnapshot[] = [];
  const visited = new Set<Scope>();
  for (const root of [scope, additionalScope]) {
    let current = root;
    while (current?.parent && !visited.has(current)) {
      visited.add(current);
      snapshots.push({ scope: current, bindings: new Map(current.bindings) });
      current = current.parent;
    }
  }
  return snapshots;
};

/** The scopes the running activation closed over; `null` outside any call, where every scope outlives the path. */
export const getClosureScopes = (context: EvaluationContext): Set<Scope> | null => {
  const frame = context.callStack.at(-1);
  if (!frame) return null;
  const scopes = new Set<Scope>();
  for (let current: Scope | null = context.scope; current; current = current.parent) {
    if (current.isCaptured) scopes.add(current);
  }
  for (let current: Scope | null = frame.scope; current; current = current.parent) {
    scopes.add(current);
  }
  return scopes;
};

export const restoreScopes = (snapshots: ScopeSnapshot[]): void => {
  for (const snapshot of snapshots) {
    snapshot.scope.bindings.clear();
    for (const [name, value] of snapshot.bindings) snapshot.scope.bindings.set(name, value);
  }
};

export const widenMovedBindings = (
  entryPath: ScopeSnapshot[],
  ranPath: ScopeSnapshot[],
  location: SourceLocation,
  isPrimitiveOnly: boolean,
): void => {
  entryPath.forEach((snapshot, scopeIndex) => {
    for (const [name, before] of snapshot.bindings) {
      const after = ranPath[scopeIndex].bindings.get(name);
      if (after === undefined || after === before) continue;
      const joined = branchValue([before, after], "loop-carried value", location);
      if (countAlternatives(joined) === countAlternatives(before)) continue;
      const widened = widenLoopCarriedValue(joined, location);
      if (isPrimitiveOnly && widened.kind !== "unknown-primitive") continue;
      snapshot.scope.bindings.set(name, widened);
    }
  });
};

export const joinScopes = (
  paths: ScopeSnapshot[][],
  reason: string,
  location: SourceLocation | null,
  preferredPath: number,
  predicate: string | null,
): void => {
  const [firstPath, ...otherPaths] = paths;
  firstPath.forEach((snapshot, scopeIndex) => {
    const siblings = otherPaths.map((path) => path[scopeIndex].bindings);
    const names = new Set([
      ...snapshot.bindings.keys(),
      ...siblings.flatMap((bindings) => [...bindings.keys()]),
    ]);
    snapshot.scope.bindings.clear();
    for (const name of names) {
      const values = [snapshot.bindings, ...siblings].map(
        (bindings) => bindings.get(name) ?? UNDEFINED_VALUE,
      );
      snapshot.scope.bindings.set(
        name,
        values.every((value) => value === values[0])
          ? values[0]
          : branchValue(values, reason, location, preferredPath, predicate),
      );
    }
  });
};
