import type { NextValue, Predicate } from "./types";

export const TRUE: Predicate = { kind: "True" };

export const FALSE: Predicate = { kind: "False" };

export const UNCHANGED: NextValue = { kind: "Unchanged" };

export const ifThenElse = (
  predicate: Predicate,
  consequent: NextValue,
  alternate: NextValue,
): NextValue => {
  if (predicate.kind === "True") return consequent;
  if (predicate.kind === "False") return alternate;
  if (JSON.stringify(consequent) === JSON.stringify(alternate)) return consequent;
  return { kind: "If", predicate, consequent, alternate };
};

export const not = (predicate: Predicate): Predicate => {
  if (predicate.kind === "In")
    return inValues(
      predicate.variable,
      predicate.domain.filter((value) => !predicate.values.includes(value)),
      predicate.domain,
    );
  if (predicate.kind === "True") return FALSE;
  if (predicate.kind === "False") return TRUE;
  if (predicate.kind === "Not") return predicate.operand;
  return { kind: "Not", operand: predicate };
};

const dedupe = (parts: Predicate[]): Predicate[] => {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = JSON.stringify(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const intersectValues = (parts: Predicate[]): Predicate[] | null => {
  const merged = new Map<string, Extract<Predicate, { kind: "In" }>>();
  const result: Predicate[] = [];
  for (const part of parts) {
    if (part.kind !== "In") {
      result.push(part);
      continue;
    }
    const current = merged.get(part.variable);
    if (!current) {
      merged.set(part.variable, part);
      result.push(part);
      continue;
    }
    const values = current.values.filter((value) => part.values.includes(value));
    if (values.length === 0) return null;
    const narrowed = { ...current, values };
    merged.set(part.variable, narrowed);
    result[result.indexOf(current)] = narrowed;
  }
  return result;
};

export const and = (predicates: Predicate[]): Predicate => {
  const parts = predicates.flatMap((predicate) =>
    predicate.kind === "And" ? predicate.conjuncts : [predicate],
  );
  if (parts.some((part) => part.kind === "False")) return FALSE;
  const intersected = intersectValues(parts.filter((part) => part.kind !== "True"));
  if (intersected === null) return FALSE;
  const kept = dedupe(intersected);
  if (kept.length === 0) return TRUE;
  if (kept.length === 1) return kept[0];
  return { kind: "And", conjuncts: kept };
};

export const or = (predicates: Predicate[]): Predicate => {
  const parts = predicates.flatMap((predicate) =>
    predicate.kind === "Or" ? predicate.disjuncts : [predicate],
  );
  if (parts.some((part) => part.kind === "True")) return TRUE;
  const kept = dedupe(parts.filter((part) => part.kind !== "False"));
  if (kept.length === 0) return FALSE;
  if (kept.length === 1) return kept[0];
  return { kind: "Or", disjuncts: kept };
};

export const inValues = (variable: string, values: string[], domain: string[]): Predicate => {
  if (values.length === 0) return FALSE;
  if (domain.every((value) => values.includes(value))) return TRUE;
  return { kind: "In", variable, values, domain };
};

export const evaluatePredicate = (
  predicate: Predicate,
  valueOf: (variable: string) => string | undefined,
): boolean | null => {
  switch (predicate.kind) {
    case "True":
      return true;
    case "False":
      return false;
    case "In": {
      const value = valueOf(predicate.variable);
      return value === undefined ? null : predicate.values.includes(value);
    }
    case "Not": {
      const inner = evaluatePredicate(predicate.operand, valueOf);
      return inner === null ? null : !inner;
    }
    case "And": {
      let result: boolean | null = true;
      for (const part of predicate.conjuncts) {
        const value = evaluatePredicate(part, valueOf);
        if (value === false) return false;
        if (value === null) result = null;
      }
      return result;
    }
    case "Or": {
      let result: boolean | null = false;
      for (const part of predicate.disjuncts) {
        const value = evaluatePredicate(part, valueOf);
        if (value === true) return true;
        if (value === null) result = null;
      }
      return result;
    }
  }
};

export const collectPredicateVariables = (
  predicate: Predicate,
  variables: Set<string>,
): Set<string> => {
  switch (predicate.kind) {
    case "In":
      variables.add(predicate.variable);
      break;
    case "Not":
      collectPredicateVariables(predicate.operand, variables);
      break;
    case "And":
      for (const part of predicate.conjuncts) collectPredicateVariables(part, variables);
      break;
    case "Or":
      for (const part of predicate.disjuncts) collectPredicateVariables(part, variables);
      break;
    default:
      break;
  }
  return variables;
};

export const evaluateNextValue = (
  next: NextValue,
  current: string,
  valueOf: (variable: string) => string | undefined,
): string[] => {
  switch (next.kind) {
    case "Unchanged":
      return [current];
    case "Values":
      return next.values;
    case "If":
      return evaluatePredicate(next.predicate, valueOf)
        ? evaluateNextValue(next.consequent, current, valueOf)
        : evaluateNextValue(next.alternate, current, valueOf);
  }
};
