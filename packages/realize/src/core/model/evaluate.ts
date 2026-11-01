import type { SymbolicValue } from "../types";
import { getChildValues } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { ANY, addAbstract, mayOverlap } from "./abstract";
import { and, collectConditionLanes, evaluateCondition, or } from "./conditions";
import type { LaneTable } from "./lanes";
import type { Abstract, Choice, Condition, Lane } from "./types";

const MAX_DEPENDENCY_COMBINATIONS = 64;

const BOOLEANS: Abstract[] = [
  { kind: "Exact", value: false },
  { kind: "Exact", value: true },
];

type CellOf = (lane: string) => string | undefined;

interface Evaluator {
  table: LaneTable;
  cellOf: CellOf;
}

const fromCondition = ({ cellOf }: Evaluator, condition: Condition): Abstract[] => {
  const result = evaluateCondition(condition, cellOf);
  return result === null ? BOOLEANS : [{ kind: "Exact", value: result }];
};

const lookupPlace = (evaluator: Evaluator, value: SymbolicValue, path: string[]): Abstract[] => {
  if (value.kind !== "Binding") return [ANY];
  const lane = evaluator.table.getLane(value.binding, [...value.path, ...path]);
  if (!lane) return [ANY];
  const cell = evaluator.cellOf(lane.name);
  return cell === undefined ? [ANY] : [evaluator.table.getCellValue(lane, cell)];
};

const addAll = (left: Abstract[], right: Abstract[]): Abstract[] =>
  left.flatMap((leftValue) => right.map((rightValue) => addAbstract(leftValue, rightValue)));

const evaluateLength = (
  evaluator: Evaluator,
  value: Extract<SymbolicValue, { kind: "ArrayExpression" }>,
): Abstract[] =>
  value.spreads.reduce<Abstract[]>(
    (total, spread) => addAll(total, evaluate(evaluator, spread, ["length"])),
    [{ kind: "Exact", value: value.elements.length }],
  );

const evaluateObjectPath = (
  evaluator: Evaluator,
  value: Extract<SymbolicValue, { kind: "ObjectExpression" }>,
  path: string[],
): Abstract[] => {
  const [key, ...rest] = path;
  const property = value.properties.findLast((candidate) => candidate.key === key);
  if (property) return evaluate(evaluator, property.value, rest);
  const spread = value.spreads.at(-1);
  if (spread) return evaluate(evaluator, spread, path);
  return [{ kind: "Exact", value: undefined }];
};

const negate = (value: Abstract): Abstract =>
  value.kind === "Exact" && typeof value.value === "number"
    ? { kind: "Exact", value: -value.value }
    : ANY;

const evaluateBinary = (
  evaluator: Evaluator,
  value: Extract<SymbolicValue, { kind: "BinaryExpression" }>,
): Abstract[] => {
  switch (value.operator) {
    case "+":
      return addAll(evaluate(evaluator, value.left, []), evaluate(evaluator, value.right, []));
    case "-":
      return addAll(
        evaluate(evaluator, value.left, []),
        evaluate(evaluator, value.right, []).map(negate),
      );
    case "===":
    case "!==":
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return fromCondition(evaluator, evaluator.table.compile(value));
    default:
      return [ANY];
  }
};

const evaluate = (evaluator: Evaluator, value: SymbolicValue, path: string[]): Abstract[] => {
  switch (value.kind) {
    case "Primitive":
      if (path.length === 0) return [{ kind: "Exact", value: value.value }];
      if (path.length === 1 && path[0] === "length" && typeof value.value === "string")
        return [{ kind: "Exact", value: value.value.length }];
      return [ANY];
    case "Binding":
      return lookupPlace(evaluator, value, path);
    case "Conditional": {
      const result = evaluateCondition(
        evaluator.table.compile(getTestExpression(value)),
        evaluator.cellOf,
      );
      if (result === true) return evaluate(evaluator, value.consequent, path);
      if (result === false) return evaluate(evaluator, value.alternate, path);
      return [
        ...evaluate(evaluator, value.consequent, path),
        ...evaluate(evaluator, value.alternate, path),
      ];
    }
    case "ObjectExpression":
      return path.length === 0
        ? [{ kind: "Object", typeText: "object" }]
        : evaluateObjectPath(evaluator, value, path);
    case "ArrayMap":
      if (path.length === 0) return [{ kind: "Object", typeText: "array" }];
      return path.length === 1 && path[0] === "length"
        ? evaluate(evaluator, value.array, path)
        : [ANY];
    case "ArrayExpression":
      if (path.length === 0) return [{ kind: "Object", typeText: "array" }];
      return path.length === 1 && path[0] === "length" ? evaluateLength(evaluator, value) : [ANY];
    case "BinaryExpression":
      return path.length === 0 ? evaluateBinary(evaluator, value) : [ANY];
    case "UnaryExpression":
      if (path.length > 0) return [ANY];
      if (value.operator === "!") return fromCondition(evaluator, evaluator.table.compile(value));
      if (value.operator === "-") return evaluate(evaluator, value.value, []).map(negate);
      return [ANY];
    case "Unknown":
      return value.origin?.kind === "Settled" && value.origin.outcome === "resolved"
        ? evaluate(evaluator, value.origin.promise, path)
        : [ANY];
    case "JsxExpression":
    case "JsxFragment":
    case "Function":
    case "Setter":
    case "Dispatch":
    case "RegExp":
      return path.length === 0 ? [{ kind: "Object", typeText: value.kind }] : [ANY];
    default:
      return [ANY];
  }
};

const toCells = (lane: Lane, values: Abstract[]): string[] => {
  const cells = lane.cells
    .filter((cell) => values.some((value) => mayOverlap(cell.value, value)))
    .map((cell) => cell.label);
  return cells.length > 0 ? cells : lane.cells.map((cell) => cell.label);
};

export const evaluateInitialCells = (
  table: LaneTable,
  lane: Lane,
  initial: SymbolicValue,
): string[] =>
  toCells(lane, evaluate({ table, cellOf: () => undefined }, initial, lane.path.slice(0)));

export const forEachEvaluatedValue = (
  root: SymbolicValue,
  visit: (value: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const pending = [root];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (visited.has(value)) continue;
    visited.add(value);
    visit(value);
    pending.push(...(value.kind === "ArrayMap" ? [value.array] : getChildValues(value)));
  }
};

const collectDependencies = (table: LaneTable, value: SymbolicValue): Lane[] => {
  const names = new Set<string>();
  const bindingIds = new Set<number>();
  forEachEvaluatedValue(value, (node) => {
    if (node.kind === "Binding") bindingIds.add(node.binding.id);
    if (node.kind === "Conditional")
      collectConditionLanes(table.compile(getTestExpression(node)), names);
    if (node.kind === "BinaryExpression" || node.kind === "UnaryExpression")
      collectConditionLanes(table.compile(node), names);
  });
  return table.lanes.filter(
    (lane) => names.has(lane.name) || (lane.bindingId !== null && bindingIds.has(lane.bindingId)),
  );
};

const forEachAssignment = (
  dependencies: Lane[],
  visit: (assignment: Map<string, string>) => void,
): void => {
  const walk = (index: number, assignment: Map<string, string>): void => {
    if (index === dependencies.length) {
      visit(new Map(assignment));
      return;
    }
    const lane = dependencies[index];
    for (const cell of lane.cells) {
      assignment.set(lane.name, cell.label);
      walk(index + 1, assignment);
    }
    assignment.delete(lane.name);
  };
  walk(0, new Map());
};

const countAssignments = (dependencies: Lane[]): number =>
  dependencies.reduce((total, lane) => total * lane.cells.length, 1);

const toAssignmentCondition = (assignments: Array<Map<string, string>>): Condition => {
  const [first] = assignments;
  if (first && first.size === 1) {
    const [lane] = first.keys();
    return { kind: "In", lane, cells: assignments.map((assignment) => assignment.get(lane) ?? "") };
  }
  return or(
    assignments.map((assignment) =>
      and([...assignment].map(([lane, cell]) => ({ kind: "In", lane, cells: [cell] }))),
    ),
  );
};

export const compileChoice = (table: LaneTable, lane: Lane, value: SymbolicValue): Choice => {
  const allCells = lane.cells.map((cell) => cell.label);
  const dependencies = collectDependencies(table, value);
  if (countAssignments(dependencies) > MAX_DEPENDENCY_COMBINATIONS)
    return { kind: "Cells", cells: allCells };
  const outcomes: Array<{ assignment: Map<string, string>; cells: string[] }> = [];
  forEachAssignment(dependencies, (assignment) => {
    const cells = toCells(
      lane,
      evaluate({ table, cellOf: (name) => assignment.get(name) }, value, lane.path),
    );
    outcomes.push({ assignment, cells });
  });
  const groups = new Map<string, { cells: string[]; assignments: Array<Map<string, string>> }>();
  for (const { assignment, cells } of outcomes) {
    const key = cells.join("\0");
    const group = groups.get(key) ?? { cells, assignments: [] };
    group.assignments.push(assignment);
    groups.set(key, group);
  }
  const ordered = [...groups.values()];
  const fallback = ordered.pop();
  if (!fallback) return { kind: "Cells", cells: allCells };
  return ordered.reduceRight<Choice>(
    (otherwise, group) => ({
      kind: "If",
      condition: toAssignmentCondition(group.assignments),
      then: { kind: "Cells", cells: group.cells },
      otherwise,
    }),
    { kind: "Cells", cells: fallback.cells },
  );
};
