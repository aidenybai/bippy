import type { SourceLocation } from "../parse/source-types.js";
import type { Scope, StaticValue, UnknownPrimitiveType } from "../types.js";
import type { EvaluationContext } from "./context.js";
import {
  branchValue,
  countAlternatives,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export interface ScopeSnapshot {
  scope: Scope;
  bindings: Map<string, StaticValue>;
}

export const snapshotScopes = (scope: Scope | null): ScopeSnapshot[] => {
  const snapshots: ScopeSnapshot[] = [];
  let current: Scope | null = scope;
  while (current && current.parent) {
    snapshots.push({ scope: current, bindings: new Map(current.bindings) });
    current = current.parent;
  }
  return snapshots;
};

/** The scopes the running activation closed over; `null` outside any call, where every scope outlives the path. */
export const getClosureScopes = (context: EvaluationContext): Set<Scope> | null => {
  const frame = context.callStack.at(-1);
  if (!frame) return null;
  const scopes = new Set<Scope>();
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
): void => {
  entryPath.forEach((snapshot, scopeIndex) => {
    for (const [name, before] of snapshot.bindings) {
      const after = ranPath[scopeIndex].bindings.get(name);
      if (after === undefined || after === before) continue;
      const joined = branchValue([before, after], "loop-carried value", location);
      if (countAlternatives(joined) === countAlternatives(before)) continue;
      snapshot.scope.bindings.set(name, widenValue(joined, location));
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

const getPrimitiveType = (value: StaticValue): UnknownPrimitiveType | null => {
  if (value.kind === "unknown-primitive") return value.primitiveType;
  if (value.kind !== "primitive") return null;
  const type = typeof value.value;
  return type === "string" || type === "number" || type === "boolean" ? type : null;
};

const widenValue = (value: StaticValue, location: SourceLocation): StaticValue => {
  const alternatives = value.kind === "branch" ? value.alternatives : [value];
  const types = new Set(alternatives.map(getPrimitiveType));
  const [type] = types;
  return types.size === 1 && type
    ? unknownPrimitiveValue(type, "loop-carried value")
    : unknownValue("loop-carried value", location);
};
