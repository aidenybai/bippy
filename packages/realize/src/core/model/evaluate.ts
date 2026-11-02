import type { SymbolicValue } from "../types";
import { getValueLabels } from "./domains";
import { getChildValues } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { ANY, addAbstract, mayOverlap } from "./abstract";
import {
  UNCHANGED,
  and,
  ifThenElse,
  collectPredicateVariables,
  evaluatePredicate,
  inValues,
  or,
} from "./predicates";
import type { VariableTable } from "./variables";
import type { Abstract, NextValue, Predicate, Variable } from "./types";

const MAX_DEPENDENCY_COMBINATIONS = 64;

const BOOLEANS: Abstract[] = [
  { kind: "Exact", value: false },
  { kind: "Exact", value: true },
];

type ValueOf = (variable: string) => string | undefined;

interface Evaluator {
  table: VariableTable;
  valueOf: ValueOf;
}

const fromPredicate = (evaluator: Evaluator, predicate: Predicate): Abstract[] => {
  const result = evaluatePredicate(predicate, evaluator.valueOf);
  return result === null ? BOOLEANS : [{ kind: "Exact", value: result }];
};

const lookupPlace = (evaluator: Evaluator, value: SymbolicValue, path: string[]): Abstract[] => {
  if (value.kind !== "Binding") return [ANY];
  const variable = evaluator.table.getVariable(value.binding, [...value.path, ...path]);
  if (!variable) return [ANY];
  const label = evaluator.valueOf(variable.name);
  return label === undefined ? [ANY] : [evaluator.table.getAbstract(variable, label)];
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
      return fromPredicate(evaluator, evaluator.table.compile(value));
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
      const result = evaluatePredicate(
        evaluator.table.compile(getTestExpression(value)),
        evaluator.valueOf,
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
      if (value.operator === "!") return fromPredicate(evaluator, evaluator.table.compile(value));
      if (value.operator === "-") return evaluate(evaluator, value.value, []).map(negate);
      return [ANY];
    case "Unknown":
      return value.origin?.kind === "Settled" && value.origin.settlement === "fulfilled"
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

const toValues = (variable: Variable, abstracts: Abstract[]): string[] => {
  const values = variable.domain.filter((value) =>
    abstracts.some((abstract) => mayOverlap(value.abstract, abstract)),
  );
  return getValueLabels(values.length > 0 ? values : variable.domain);
};

export const evaluateInitialValues = (
  table: VariableTable,
  variable: Variable,
  initial: SymbolicValue,
): string[] =>
  toValues(
    variable,
    evaluate({ table, valueOf: () => undefined }, initial, variable.path.slice(0)),
  );

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

const collectDependencies = (table: VariableTable, value: SymbolicValue): Variable[] => {
  const names = new Set<string>();
  const bindingIds = new Set<number>();
  forEachEvaluatedValue(value, (node) => {
    if (node.kind === "Binding") bindingIds.add(node.binding.id);
    if (node.kind === "Conditional")
      collectPredicateVariables(table.compile(getTestExpression(node)), names);
    if (node.kind === "BinaryExpression" || node.kind === "UnaryExpression")
      collectPredicateVariables(table.compile(node), names);
  });
  return table.variables.filter(
    (variable) =>
      names.has(variable.name) ||
      (variable.bindingId !== null && bindingIds.has(variable.bindingId)),
  );
};

const forEachAssignment = (
  dependencies: Variable[],
  visit: (assignment: Map<string, string>) => void,
): void => {
  const walk = (index: number, assignment: Map<string, string>): void => {
    if (index === dependencies.length) {
      visit(new Map(assignment));
      return;
    }
    const variable = dependencies[index];
    for (const value of variable.domain) {
      assignment.set(variable.name, value.label);
      walk(index + 1, assignment);
    }
    assignment.delete(variable.name);
  };
  walk(0, new Map());
};

const countAssignments = (dependencies: Variable[]): number =>
  dependencies.reduce((total, variable) => total * variable.domain.length, 1);

const toAssignmentPredicate = (
  dependencies: Variable[],
  assignments: Array<Map<string, string>>,
): Predicate => {
  const getDomain = (name: string): string[] =>
    getValueLabels(dependencies.find((variable) => variable.name === name)?.domain ?? []);
  const [first] = assignments;
  if (first && first.size === 1) {
    const [variable] = first.keys();
    return inValues(
      variable,
      assignments.map((assignment) => assignment.get(variable) ?? ""),
      getDomain(variable),
    );
  }
  return or(
    assignments.map((assignment) =>
      and(
        [...assignment].map(([variable, value]) =>
          inValues(variable, [value], getDomain(variable)),
        ),
      ),
    ),
  );
};

interface NextValueRow {
  assignment: Map<string, string>;
  values: string[];
  key: string;
}

const isUnchangedBy = (variable: Variable, rows: NextValueRow[]): boolean =>
  rows.every(
    (row) => row.values.length === 1 && row.assignment.get(variable.name) === row.values[0],
  );

const getRelevantDependencies = (dependencies: Variable[], rows: NextValueRow[]): Variable[] =>
  dependencies.reduce<Variable[]>((relevant, dependency) => {
    const remaining = relevant.filter((variable) => variable !== dependency);
    const keysByRest = new Map<string, string>();
    const isIrrelevant = rows.every((row) => {
      const restKey = remaining.map((variable) => row.assignment.get(variable.name)).join("\0");
      const existing = keysByRest.get(restKey);
      keysByRest.set(restKey, row.key);
      return existing === undefined || existing === row.key;
    });
    return isIrrelevant ? remaining : relevant;
  }, dependencies);

export const compileNextValue = (
  table: VariableTable,
  variable: Variable,
  value: SymbolicValue,
): NextValue => {
  const domain = getValueLabels(variable.domain);
  const dependencies = collectDependencies(table, value);
  if (countAssignments(dependencies) > MAX_DEPENDENCY_COMBINATIONS)
    return { kind: "Values", values: domain };
  const rows: NextValueRow[] = [];
  forEachAssignment(dependencies, (assignment) => {
    const values = toValues(
      variable,
      evaluate({ table, valueOf: (name) => assignment.get(name) }, value, variable.path),
    );
    rows.push({ assignment, values, key: values.join("\0") });
  });
  if (isUnchangedBy(variable, rows)) return UNCHANGED;
  const relevant = getRelevantDependencies(dependencies, rows);
  const groups = new Map<
    string,
    { values: string[]; assignments: Map<string, Map<string, string>> }
  >();
  for (const row of rows) {
    const projected = new Map(
      relevant.map((dependency) => [dependency.name, row.assignment.get(dependency.name) ?? ""]),
    );
    const group = groups.get(row.key) ?? { values: row.values, assignments: new Map() };
    group.assignments.set([...projected.values()].join("\0"), projected);
    groups.set(row.key, group);
  }
  const ordered = [...groups.values()];
  const fallback = ordered.pop();
  if (!fallback) return { kind: "Values", values: domain };
  return ordered.reduceRight<NextValue>(
    (otherwise, group) =>
      ifThenElse(
        toAssignmentPredicate(relevant, [...group.assignments.values()]),
        { kind: "Values", values: group.values },
        otherwise,
      ),
    { kind: "Values", values: fallback.values },
  );
};
