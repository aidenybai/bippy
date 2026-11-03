import type { SymbolicValue } from "../types";
import { getValueLabels } from "./domains";
import { getChildValues } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { ANY } from "./abstract";
import { evaluatePredicate } from "./predicates";
import type { VariableTable } from "./variables";
import type { Abstract, Initial, Predicate, Term, Variable } from "./types";

const ANY_TERM: Term = { kind: "Constant", value: ANY };

interface Compiler {
  table: VariableTable;
  isInitial: boolean;
}

const constant = (value: Abstract): Term => ({ kind: "Constant", value });

const isNumeric = (value: Abstract): boolean =>
  value.kind === "Range" || (value.kind === "Exact" && typeof value.value === "number");

const isNeverNumeric = (term: Term): boolean => term.kind === "Constant" && !isNumeric(term.value);

const plus = (left: Term, right: Term): Term =>
  isNeverNumeric(left) || isNeverNumeric(right) ? ANY_TERM : { kind: "Plus", left, right };

const minus = (left: Term, right: Term): Term =>
  isNeverNumeric(left) || isNeverNumeric(right) ? ANY_TERM : { kind: "Minus", left, right };

const negative = (operand: Term): Term =>
  isNeverNumeric(operand) ? ANY_TERM : { kind: "Negative", operand };

const choose = (
  compiler: Compiler,
  predicate: Predicate,
  consequent: () => Term,
  alternate: () => Term,
): Term => {
  const result = evaluatePredicate(predicate, () => undefined);
  if (result === true) return consequent();
  if (result === false) return alternate();
  const terms = [consequent(), alternate()];
  return compiler.isInitial
    ? { kind: "Either", terms }
    : { kind: "If", predicate, consequent: terms[0], alternate: terms[1] };
};

const fromPredicate = (compiler: Compiler, predicate: Predicate): Term =>
  choose(
    compiler,
    predicate,
    () => constant({ kind: "Exact", value: true }),
    () => constant({ kind: "Exact", value: false }),
  );

const readPlace = (compiler: Compiler, value: SymbolicValue, path: string[]): Term => {
  if (value.kind !== "Binding" || compiler.isInitial) return ANY_TERM;
  const variable = compiler.table.getVariable(value.binding, [...value.path, ...path]);
  return variable ? { kind: "Read", variable: variable.name } : ANY_TERM;
};

const compileLength = (
  compiler: Compiler,
  value: Extract<SymbolicValue, { kind: "ArrayExpression" }>,
): Term =>
  value.spreads.reduce<Term>(
    (total, spread) => plus(total, compile(compiler, spread, ["length"])),
    constant({ kind: "Exact", value: value.elements.length }),
  );

const compileObjectPath = (
  compiler: Compiler,
  value: Extract<SymbolicValue, { kind: "ObjectExpression" }>,
  path: string[],
): Term => {
  const [key, ...rest] = path;
  const property = value.properties.findLast((candidate) => candidate.key === key);
  if (property) return compile(compiler, property.value, rest);
  const spread = value.spreads.at(-1);
  if (spread) return compile(compiler, spread, path);
  return constant({ kind: "Exact", value: undefined });
};

const compileBinary = (
  compiler: Compiler,
  value: Extract<SymbolicValue, { kind: "BinaryExpression" }>,
): Term => {
  switch (value.operator) {
    case "+":
      return plus(compile(compiler, value.left, []), compile(compiler, value.right, []));
    case "-":
      return minus(compile(compiler, value.left, []), compile(compiler, value.right, []));
    case "===":
    case "!==":
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return fromPredicate(compiler, compiler.table.compile(value));
    default:
      return ANY_TERM;
  }
};

const compile = (compiler: Compiler, value: SymbolicValue, path: string[]): Term => {
  switch (value.kind) {
    case "Primitive":
      if (path.length === 0) return constant({ kind: "Exact", value: value.value });
      if (path.length === 1 && path[0] === "length" && typeof value.value === "string")
        return constant({ kind: "Exact", value: value.value.length });
      return ANY_TERM;
    case "Binding":
      return readPlace(compiler, value, path);
    case "Conditional":
      return choose(
        compiler,
        compiler.table.compile(getTestExpression(value)),
        () => compile(compiler, value.consequent, path),
        () => compile(compiler, value.alternate, path),
      );
    case "ObjectExpression":
      return path.length === 0
        ? constant({ kind: "Object", typeText: "object" })
        : compileObjectPath(compiler, value, path);
    case "ArrayMap":
      if (path.length === 0) return constant({ kind: "Object", typeText: "array" });
      return path.length === 1 && path[0] === "length" && !value.isFlat
        ? compile(compiler, value.array, path)
        : ANY_TERM;
    case "ArrayExpression":
      if (path.length === 0) return constant({ kind: "Object", typeText: "array" });
      return path.length === 1 && path[0] === "length" ? compileLength(compiler, value) : ANY_TERM;
    case "BinaryExpression":
      return path.length === 0 ? compileBinary(compiler, value) : ANY_TERM;
    case "UnaryExpression":
      if (path.length > 0) return ANY_TERM;
      if (value.operator === "!") return fromPredicate(compiler, compiler.table.compile(value));
      if (value.operator === "-") return negative(compile(compiler, value.value, []));
      return ANY_TERM;
    case "Unknown":
      return value.origin?.kind === "Settled" && value.origin.settlement === "fulfilled"
        ? compile(compiler, value.origin.promise, path)
        : ANY_TERM;
    case "JsxExpression":
    case "JsxFragment":
    case "Function":
    case "Setter":
    case "Dispatch":
    case "RegExp":
      return path.length === 0 ? constant({ kind: "Object", typeText: value.kind }) : ANY_TERM;
    default:
      return ANY_TERM;
  }
};

const toInitial = (variable: Variable, term: Term): Initial =>
  term.kind === "Constant" && term.value.kind === "Any"
    ? { kind: "Values", values: getValueLabels(variable.domain) }
    : { kind: "Evaluate", term };

export const compileNextValue = (
  table: VariableTable,
  variable: Variable,
  value: SymbolicValue,
): Initial => toInitial(variable, compile({ table, isInitial: false }, value, variable.path));

export const compileInitialValue = (
  table: VariableTable,
  variable: Variable,
  value: SymbolicValue,
): Initial => toInitial(variable, compile({ table, isInitial: true }, value, variable.path));

const getTermChildren = (term: Term): Term[] => {
  switch (term.kind) {
    case "Plus":
    case "Minus":
      return [term.left, term.right];
    case "Negative":
      return [term.operand];
    case "If":
      return [term.consequent, term.alternate];
    case "Either":
      return term.terms;
    case "Constant":
    case "Read":
      return [];
  }
};

export const forEachTerm = (root: Term, visit: (term: Term) => void): void => {
  const pending = [root];
  for (let term = pending.pop(); term !== undefined; term = pending.pop()) {
    visit(term);
    pending.push(...getTermChildren(term));
  }
};

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
