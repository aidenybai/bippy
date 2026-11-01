import type {
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "../types";
import { formatPlace, formatSymbolicValue } from "../values/format";
import { getTestExpression } from "../values/get-test-expression";
import { COMPARISONS, compareAbstract, getAbstractTruthiness, type Comparison } from "./abstract";
import { createCells, type PlaceTests } from "./cells";
import { FALSE, TRUE, and, inCells, not, or } from "./conditions";
import type { Cell, Condition, Lane, LaneSource } from "./types";

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
  "screen",
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

export interface LaneTable {
  lanes: Lane[];
  compile: (test: SymbolicValue) => Condition;
  getLane: (binding: Binding, path: string[]) => Lane | null;
  getCellValue: (lane: Lane, label: string) => Cell["value"];
  addLane: (lane: Lane) => void;
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

export const forEachAtom = (test: SymbolicValue, visit: (atom: Atom) => void): void => {
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

const getLaneSource = (binding: Binding): LaneSource => {
  if (STATE_KINDS.has(binding.kind)) return "state";
  return DERIVED_KINDS.has(binding.kind) && binding.inputPlaces.length > 0 ? "derived" : "input";
};

const BOOLEAN_CELLS: Cell[] = [
  { label: "false", value: { kind: "Exact", value: false } },
  { label: "true", value: { kind: "Exact", value: true } },
];

export const createLaneTable = (analysis: ComponentAnalysis, tests: SymbolicValue[]): LaneTable => {
  const entries = new Map<string, PlaceEntry>();
  const lanes: Lane[] = [];
  const lanesByPlace = new Map<string, Lane>();
  const lanesByName = new Map<string, Lane>();
  const opaqueLanes = new Map<string, Lane>();

  const createName = (label: string): string => {
    const base = toIdentifier(label);
    let name = base;
    for (let suffix = 2; lanesByName.has(name); suffix++) name = `${base}_${suffix}`;
    return name;
  };

  const addLane = (lane: Lane): void => {
    lanes.push(lane);
    lanesByName.set(lane.name, lane);
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

  for (const [key, { binding, path, tests: placeTests }] of entries) {
    const domain =
      path.length === 0
        ? binding.domain
        : (analysis.placeDomains.get({ bindingId: binding.id, path }) ?? null);
    const cells = createCells(domain, placeTests, path.at(-1) === "length");
    const label = formatPlace(binding, path);
    const lane: Lane = {
      name: createName(label),
      label,
      source: getLaneSource(binding),
      bindingKind: binding.kind,
      bindingId: binding.id,
      inputBindingIds: [...new Set(binding.inputPlaces.map((place) => place.bindingId))],
      path,
      cells,
      initial: cells.map((cell) => cell.label),
    };
    addLane(lane);
    lanesByPlace.set(key, lane);
  }

  const getOpaqueLane = (value: SymbolicValue): Lane => {
    const label = formatSymbolicValue(value);
    const existing = opaqueLanes.get(label);
    if (existing) return existing;
    const lane: Lane = {
      name: createName(`test_${label}`),
      label,
      source: "test",
      bindingKind: null,
      bindingId: null,
      inputBindingIds: [],
      path: [],
      cells: BOOLEAN_CELLS,
      initial: ["false", "true"],
    };
    addLane(lane);
    opaqueLanes.set(label, lane);
    return lane;
  };

  const opaque = (value: SymbolicValue): Condition => {
    const lane = getOpaqueLane(value);
    return inCells(lane.name, ["true"], ["false", "true"]);
  };

  const selectCells = (
    lane: Lane,
    predicate: (cell: Cell) => boolean | null,
  ): Condition | null => {
    const selected: string[] = [];
    for (const cell of lane.cells) {
      const result = predicate(cell);
      if (result === null) return null;
      if (result) selected.push(cell.label);
    }
    return inCells(
      lane.name,
      selected,
      lane.cells.map((cell) => cell.label),
    );
  };

  const compileAtom = (value: SymbolicValue): Condition => {
    const atom = toAtom(value);
    if (!atom || atom.kind === "Opaque") return opaque(value);
    const lane = lanesByPlace.get(getPlaceKey(atom.binding.id, atom.path));
    if (!lane) return opaque(value);
    const condition =
      atom.kind === "Truthy"
        ? selectCells(lane, (cell) => getAbstractTruthiness(cell.value))
        : selectCells(lane, (cell) => compareAbstract(cell.value, atom.operator, atom.literal));
    return condition ?? opaque(value);
  };

  const compileConditional = (value: ConditionalValue): Condition => {
    const test = compile(getTestExpression(value));
    return or([
      and([test, compile(value.consequent)]),
      and([not(test), compile(value.alternate)]),
    ]);
  };

  const compile = (test: SymbolicValue): Condition => {
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

  const getLane = (binding: Binding, path: string[]): Lane | null =>
    lanesByPlace.get(getPlaceKey(binding.id, path)) ?? null;

  const getCellValue = (lane: Lane, label: string): Cell["value"] =>
    lane.cells.find((cell) => cell.label === label)?.value ?? { kind: "Any" };

  return { lanes, compile, getLane, getCellValue, addLane };
};
