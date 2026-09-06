import { conditional, type StaticValue } from "./values.js";

/**
 * Lexical scope for the abstract interpreter. Module scope has no parent;
 * component bodies and nested functions create plain child scopes, while
 * control-flow arms create branch scopes whose assignments shadow the outer
 * binding until the arms are merged back as a conditional.
 */
export interface Scope {
  parent: Scope | null;
  variables: Map<string, StaticValue>;
  isBranch: boolean;
  /** Names assigned (not declared) inside a branch scope. */
  assigned: Set<string>;
}

export interface BranchOutcome {
  test: string;
  scope: Scope;
}

export const createScope = (parent: Scope | null = null, isBranch = false): Scope => ({
  parent,
  variables: new Map(),
  isBranch,
  assigned: new Set(),
});

export const isModuleScope = (scope: Scope): boolean => scope.parent === null;

export const lookupVariable = (scope: Scope, name: string): StaticValue | undefined => {
  let current: Scope | null = scope;
  while (current) {
    const value = current.variables.get(name);
    if (value !== undefined) return value;
    current = current.parent;
  }
  return undefined;
};

/** Whether `name` is bound in a function-local scope (not the module scope). */
export const hasLocalBinding = (scope: Scope, name: string): boolean => {
  let current: Scope | null = scope;
  while (current && !isModuleScope(current)) {
    if (current.variables.has(name)) return true;
    current = current.parent;
  }
  return false;
};

export const declareVariable = (scope: Scope, name: string, value: StaticValue): void => {
  scope.variables.set(name, value);
};

/**
 * Assigns to the nearest declaring scope, unless a branch scope is crossed
 * first: then the assignment shadows inside the branch so the other arms
 * still observe the previous value.
 */
export const assignVariable = (scope: Scope, name: string, value: StaticValue): void => {
  let current: Scope | null = scope;
  while (current) {
    if (current.variables.has(name)) {
      current.variables.set(name, value);
      return;
    }
    if (current.isBranch) {
      current.variables.set(name, value);
      current.assigned.add(name);
      return;
    }
    current = current.parent;
  }
  scope.variables.set(name, value);
};

export const forkScope = (scope: Scope): Scope => createScope(scope, true);

/**
 * Merges branch scopes back into `scope`: every variable assigned in any arm
 * becomes a chain of conditionals over the arms' outcomes, falling back to
 * the value before the branch when an arm left it untouched.
 */
export const mergeBranchScopes = (
  scope: Scope,
  arms: BranchOutcome[],
  fallback: Scope | null,
): void => {
  const assignedNames = new Set<string>();
  for (const arm of arms) for (const name of arm.scope.assigned) assignedNames.add(name);
  if (fallback) for (const name of fallback.assigned) assignedNames.add(name);
  for (const name of assignedNames) {
    const before = lookupVariable(scope, name);
    const valueIn = (branch: Scope | null): StaticValue | undefined =>
      branch?.assigned.has(name) ? branch.variables.get(name) : before;
    const fallbackValue = valueIn(fallback);
    if (fallbackValue === undefined) continue;
    let merged: StaticValue = fallbackValue;
    for (let index = arms.length - 1; index >= 0; index--) {
      const armValue = valueIn(arms[index].scope);
      if (armValue === undefined) continue;
      merged = armValue === merged ? merged : conditional(arms[index].test, armValue, merged);
    }
    assignVariable(scope, name, merged);
  }
};
