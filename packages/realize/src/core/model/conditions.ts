import type { Choice, Condition } from "./types";

export const TRUE: Condition = { kind: "True" };

export const FALSE: Condition = { kind: "False" };

export const KEEP: Choice = { kind: "Keep" };

export const choose = (condition: Condition, consequent: Choice, alternate: Choice): Choice => {
  if (condition.kind === "True") return consequent;
  if (condition.kind === "False") return alternate;
  if (JSON.stringify(consequent) === JSON.stringify(alternate)) return consequent;
  return { kind: "If", condition, consequent, alternate };
};

export const not = (condition: Condition): Condition => {
  if (condition.kind === "In")
    return inCells(
      condition.lane,
      condition.allCells.filter((cell) => !condition.cells.includes(cell)),
      condition.allCells,
    );
  if (condition.kind === "True") return FALSE;
  if (condition.kind === "False") return TRUE;
  if (condition.kind === "Not") return condition.condition;
  return { kind: "Not", condition };
};

const dedupe = (parts: Condition[]): Condition[] => {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = JSON.stringify(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const intersectCells = (parts: Condition[]): Condition[] | null => {
  const merged = new Map<string, Extract<Condition, { kind: "In" }>>();
  const result: Condition[] = [];
  for (const part of parts) {
    if (part.kind !== "In") {
      result.push(part);
      continue;
    }
    const current = merged.get(part.lane);
    if (!current) {
      merged.set(part.lane, part);
      result.push(part);
      continue;
    }
    const cells = current.cells.filter((cell) => part.cells.includes(cell));
    if (cells.length === 0) return null;
    const narrowed = { ...current, cells };
    merged.set(part.lane, narrowed);
    result[result.indexOf(current)] = narrowed;
  }
  return result;
};

export const and = (conditions: Condition[]): Condition => {
  const parts = conditions.flatMap((condition) =>
    condition.kind === "And" ? condition.conditions : [condition],
  );
  if (parts.some((part) => part.kind === "False")) return FALSE;
  const intersected = intersectCells(parts.filter((part) => part.kind !== "True"));
  if (intersected === null) return FALSE;
  const kept = dedupe(intersected);
  if (kept.length === 0) return TRUE;
  if (kept.length === 1) return kept[0];
  return { kind: "And", conditions: kept };
};

export const or = (conditions: Condition[]): Condition => {
  const parts = conditions.flatMap((condition) =>
    condition.kind === "Or" ? condition.conditions : [condition],
  );
  if (parts.some((part) => part.kind === "True")) return TRUE;
  const kept = dedupe(parts.filter((part) => part.kind !== "False"));
  if (kept.length === 0) return FALSE;
  if (kept.length === 1) return kept[0];
  return { kind: "Or", conditions: kept };
};

export const inCells = (lane: string, cells: string[], allCells: string[]): Condition => {
  if (cells.length === 0) return FALSE;
  if (allCells.every((cell) => cells.includes(cell))) return TRUE;
  return { kind: "In", lane, cells, allCells };
};

export const evaluateCondition = (
  condition: Condition,
  cellOf: (lane: string) => string | undefined,
): boolean | null => {
  switch (condition.kind) {
    case "True":
      return true;
    case "False":
      return false;
    case "In": {
      const cell = cellOf(condition.lane);
      return cell === undefined ? null : condition.cells.includes(cell);
    }
    case "Not": {
      const inner = evaluateCondition(condition.condition, cellOf);
      return inner === null ? null : !inner;
    }
    case "And": {
      let result: boolean | null = true;
      for (const part of condition.conditions) {
        const value = evaluateCondition(part, cellOf);
        if (value === false) return false;
        if (value === null) result = null;
      }
      return result;
    }
    case "Or": {
      let result: boolean | null = false;
      for (const part of condition.conditions) {
        const value = evaluateCondition(part, cellOf);
        if (value === true) return true;
        if (value === null) result = null;
      }
      return result;
    }
  }
};

export const collectConditionLanes = (condition: Condition, lanes: Set<string>): Set<string> => {
  switch (condition.kind) {
    case "In":
      lanes.add(condition.lane);
      break;
    case "Not":
      collectConditionLanes(condition.condition, lanes);
      break;
    case "And":
    case "Or":
      for (const part of condition.conditions) collectConditionLanes(part, lanes);
      break;
    default:
      break;
  }
  return lanes;
};

export const evaluateChoice = (
  choice: Choice,
  current: string,
  cellOf: (lane: string) => string | undefined,
): string[] => {
  switch (choice.kind) {
    case "Keep":
      return [current];
    case "Cells":
      return choice.cells;
    case "If":
      return evaluateCondition(choice.condition, cellOf)
        ? evaluateChoice(choice.consequent, current, cellOf)
        : evaluateChoice(choice.alternate, current, cellOf);
  }
};
