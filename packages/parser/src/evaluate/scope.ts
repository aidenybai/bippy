import type { Scope, StaticValue } from "../types.js";

export const createScope = (parent: Scope | null): Scope => ({ parent, bindings: new Map() });

export const lookupScope = (scope: Scope, name: string): StaticValue | undefined => {
  let current: Scope | null = scope;
  while (current) {
    const value = current.bindings.get(name);
    if (value !== undefined) return value;
    current = current.parent;
  }
  return undefined;
};

export const findOwningScope = (scope: Scope, name: string): Scope | null => {
  let current: Scope | null = scope;
  while (current) {
    if (current.bindings.has(name)) return current;
    current = current.parent;
  }
  return null;
};

export const declareInScope = (scope: Scope, name: string, value: StaticValue): void => {
  scope.bindings.set(name, value);
};
