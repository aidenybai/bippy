import type {
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  Domain,
  PrimitiveValue,
  SymbolicValue,
} from "../types";
import { formatPlace, formatSymbolicValue } from "../values/format";
import { getTestExpression } from "../values/get-test-expression";
import { COMPARISONS, compareAbstract, getAbstractTruthiness, type Comparison } from "./abstract";
import { createDomain, getValueLabels, type PlaceTests } from "./domains";
import { FALSE, TRUE, and, inValues, not, or } from "./predicates";
import type { Abstract, Predicate, Value, Variable, VariableSource } from "./types";

const FLIPPED: Record<Comparison, Comparison> = {
  "===": "===",
  "!==": "!==",
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

export const STATE_KINDS = new Set(["state", "reducer"]);

const DERIVED_KINDS = new Set(["call", "memo"]);

const TLA_KEYWORDS = new Set([
  "ASSUME",
  "CASE",
  "CHOOSE",
  "CONSTANT",
  "DOMAIN",
  "ELSE",
  "EXCEPT",
  "EXTENDS",
  "IF",
  "IN",
  "LET",
  "MODULE",
  "OTHER",
  "SUBSET",
  "THEN",
  "UNION",
  "VARIABLE",
  "VARIABLES",
  "Init",
  "Next",
  "Spec",
  "vars",
  "view",
]);

type Atom =
  | {
      kind: "Compare";
      binding: Binding;
      path: string[];
      operator: Comparison;
      literal: PrimitiveValue;
    }
  | { kind: "Truthy"; binding: Binding; path: string[] }
  | { kind: "Opaque"; value: SymbolicValue };

interface PlaceEntry {
  binding: Binding;
  path: string[];
  tests: PlaceTests;
}

export interface VariableTable {
  variables: Variable[];
  compile: (test: SymbolicValue) => Predicate;
  compileExisting: (test: SymbolicValue) => Predicate | null;
  getVariable: (binding: Binding, path: string[]) => Variable | null;
  getAbstract: (variable: Variable, label: string) => Abstract;
  addVariable: (variable: Variable) => void;
}

export const getPlaceKey = (bindingId: number, path: string[]): string =>
  [bindingId, ...path].join("\0");

const toAtom = (value: SymbolicValue): Atom | null => {
  if (value.kind === "Binding") return { kind: "Truthy", binding: value.binding, path: value.path };
  if (value.kind !== "BinaryExpression" || !COMPARISONS.has(value.operator)) return null;
  const operator = value.operator as Comparison;
  if (value.left.kind === "Binding" && value.right.kind === "Primitive")
    return {
      kind: "Compare",
      binding: value.left.binding,
      path: value.left.path,
      operator,
      literal: value.right.value,
    };
  if (value.right.kind === "Binding" && value.left.kind === "Primitive")
    return {
      kind: "Compare",
      binding: value.right.binding,
      path: value.right.path,
      operator: FLIPPED[operator],
      literal: value.left.value,
    };
  return null;
};

const forEachAtom = (test: SymbolicValue, visit: (atom: Atom) => void): void => {
  switch (test.kind) {
    case "Primitive":
      return;
    case "UnaryExpression":
      if (test.operator === "!") {
        forEachAtom(test.value, visit);
        return;
      }
      break;
    case "Conditional":
      forEachAtom(getTestExpression(test), visit);
      forEachAtom(test.consequent, visit);
      forEachAtom(test.alternate, visit);
      return;
    default:
      break;
  }
  visit(toAtom(test) ?? { kind: "Opaque", value: test });
};

const toIdentifier = (label: string): string => {
  const cleaned = label.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "value";
  const prefixed = /^[0-9]/.test(cleaned) ? `v_${cleaned}` : cleaned;
  return TLA_KEYWORDS.has(prefixed) ? `${prefixed}_` : prefixed;
};

const getVariableSource = (binding: Binding): VariableSource => {
  if (STATE_KINDS.has(binding.kind)) return "state";
  return DERIVED_KINDS.has(binding.kind) && binding.inputPlaces.length > 0 ? "derived" : "input";
};

const hasCountedLength = (receiver: Domain | null): boolean => {
  if (receiver?.kind === "Opaque") return receiver.isArrayLike || receiver.typeText === "string";
  if (receiver?.kind !== "Cases") return false;
  return receiver.cases.every((value) =>
    value.kind === "Literal"
      ? typeof value.value === "string"
      : value.isArrayLike || value.primitive === "string",
  );
};

const getInputBindingIds = (binding: Binding, bindingsById: Map<number, Binding>): number[] => {
  const ids = new Set<number>();
  const pending = binding.inputPlaces.map((place) => place.bindingId);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (ids.has(id)) continue;
    ids.add(id);
    for (const place of bindingsById.get(id)?.inputPlaces ?? []) pending.push(place.bindingId);
  }
  return [...ids];
};

const BOOLEAN_DOMAIN: Value[] = [
  { label: "false", abstract: { kind: "Exact", value: false } },
  { label: "true", abstract: { kind: "Exact", value: true } },
];

export const createVariableTable = (
  analysis: ComponentAnalysis,
  tests: SymbolicValue[],
): VariableTable => {
  const entries = new Map<string, PlaceEntry>();
  const variables: Variable[] = [];
  const variablesByPlace = new Map<string, Variable>();
  const variablesByName = new Map<string, Variable>();
  const opaqueVariables = new Map<string, Variable>();

  const createName = (label: string): string => {
    const base = toIdentifier(label);
    let name = base;
    for (let suffix = 2; variablesByName.has(name); suffix++) name = `${base}_${suffix}`;
    return name;
  };

  const addVariable = (variable: Variable): void => {
    variables.push(variable);
    variablesByName.set(variable.name, variable);
  };

  const record = (atom: Atom): void => {
    if (atom.kind === "Opaque") return;
    const key = getPlaceKey(atom.binding.id, atom.path);
    const entry = entries.get(key) ?? {
      binding: atom.binding,
      path: atom.path,
      tests: { literals: [], isTruthinessTested: false },
    };
    entries.set(key, entry);
    if (atom.kind === "Truthy") entry.tests.isTruthinessTested = true;
    else entry.tests.literals.push(atom.literal);
  };

  for (const test of tests) forEachAtom(test, record);

  const getPlaceDomain = (binding: Binding, path: string[]): Domain | null =>
    path.length === 0
      ? binding.domain
      : (analysis.placeDomains.get({ bindingId: binding.id, path }) ?? null);
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));

  for (const [key, entry] of entries) {
    const isLength =
      entry.path.at(-1) === "length" &&
      hasCountedLength(getPlaceDomain(entry.binding, entry.path.slice(0, -1)));
    const values = createDomain(getPlaceDomain(entry.binding, entry.path), entry.tests, isLength);
    const label = formatPlace(entry.binding, entry.path);
    const variable: Variable = {
      name: createName(label),
      label,
      source: getVariableSource(entry.binding),
      bindingKind: entry.binding.kind,
      bindingId: entry.binding.id,
      inputBindingIds: getInputBindingIds(entry.binding, bindingsById),
      path: entry.path,
      domain: values,
      initial: getValueLabels(values),
    };
    addVariable(variable);
    variablesByPlace.set(key, variable);
  }

  const getOpaqueVariable = (value: SymbolicValue): Variable => {
    const label = formatSymbolicValue(value);
    const existing = opaqueVariables.get(label);
    if (existing) return existing;
    const variable: Variable = {
      name: createName(`opaque_${label}`),
      label,
      source: "opaque",
      bindingKind: null,
      bindingId: null,
      inputBindingIds: [],
      path: [],
      domain: BOOLEAN_DOMAIN,
      initial: ["false", "true"],
    };
    addVariable(variable);
    opaqueVariables.set(label, variable);
    return variable;
  };

  const opaque = (value: SymbolicValue): Predicate => {
    const variable = getOpaqueVariable(value);
    return inValues(variable.name, ["true"], ["false", "true"]);
  };

  const selectValues = (
    variable: Variable,
    isSelected: (value: Value) => boolean | null,
  ): Predicate | null => {
    const selected: string[] = [];
    for (const value of variable.domain) {
      const result = isSelected(value);
      if (result === null) return null;
      if (result) selected.push(value.label);
    }
    return inValues(variable.name, selected, getValueLabels(variable.domain));
  };

  const compileAtom = (value: SymbolicValue): Predicate => {
    const atom = toAtom(value);
    if (!atom || atom.kind === "Opaque") return opaque(value);
    const variable = variablesByPlace.get(getPlaceKey(atom.binding.id, atom.path));
    if (!variable) return opaque(value);
    const predicate =
      atom.kind === "Truthy"
        ? selectValues(variable, (candidate) => getAbstractTruthiness(candidate.abstract))
        : selectValues(variable, (candidate) =>
            compareAbstract(candidate.abstract, atom.operator, atom.literal),
          );
    return predicate ?? opaque(value);
  };

  const compileConditional = (value: ConditionalValue): Predicate => {
    const test = compile(getTestExpression(value));
    return or([and([test, compile(value.consequent)]), and([not(test), compile(value.alternate)])]);
  };

  const compile = (test: SymbolicValue): Predicate => {
    switch (test.kind) {
      case "Primitive":
        return test.value ? TRUE : FALSE;
      case "UnaryExpression":
        return test.operator === "!" ? not(compile(test.value)) : compileAtom(test);
      case "Conditional":
        return compileConditional(test);
      case "JsxExpression":
      case "JsxFragment":
      case "ObjectExpression":
      case "ArrayExpression":
      case "Function":
      case "Setter":
      case "Dispatch":
      case "RegExp":
        return TRUE;
      default:
        return compileAtom(test);
    }
  };

  const compileExisting = (test: SymbolicValue): Predicate | null => {
    const count = variables.length;
    const predicate = compile(test);
    if (variables.length === count) return predicate;
    for (const variable of variables.splice(count)) {
      variablesByName.delete(variable.name);
      opaqueVariables.delete(variable.label);
    }
    return null;
  };

  const getVariable = (binding: Binding, path: string[]): Variable | null =>
    variablesByPlace.get(getPlaceKey(binding.id, path)) ?? null;

  const getAbstract = (variable: Variable, label: string): Abstract =>
    variable.domain.find((value) => value.label === label)?.abstract ?? { kind: "Any" };

  return { variables, compile, compileExisting, getVariable, getAbstract, addVariable };
};
