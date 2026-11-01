import type { AbstractValue, Domain, PrimitiveValue } from "../types";
import type { Abstract, Cell } from "./types";

export interface PlaceTests {
  literals: PrimitiveValue[];
  isTruthinessTested: boolean;
}

interface NumberBounds {
  min: number;
  isInteger: boolean;
}

const formatBound = (value: number): string => String(value);

export const formatAbstract = (value: Abstract): string => {
  switch (value.kind) {
    case "Exact":
      if (value.value === "") return "empty";
      return String(value.value);
    case "Range": {
      const { min, max, isMinIncluded, isMaxIncluded } = value;
      if (min === -Infinity && max === Infinity) return "any number";
      if (min === -Infinity) return `${isMaxIncluded ? "<=" : "<"}${formatBound(max)}`;
      if (max === Infinity) return `${isMinIncluded ? ">=" : ">"}${formatBound(min)}`;
      return `${isMinIncluded ? "[" : "("}${min}, ${max}${isMaxIncluded ? "]" : ")"}`;
    }
    case "Other":
      return value.type === "string" ? "other string" : "other";
    case "Object":
      return value.typeText;
    case "Truthy":
      return "truthy";
    case "Falsy":
      return "falsy";
    case "Any":
      return "any";
  }
};

const exact = (value: PrimitiveValue): Abstract => ({ kind: "Exact", value });

const createNumberCells = (literals: PrimitiveValue[], bounds: NumberBounds): Abstract[] => {
  const points = [
    ...new Set(
      literals.filter(
        (literal): literal is number =>
          typeof literal === "number" && Number.isFinite(literal) && literal >= bounds.min,
      ),
    ),
  ].sort((left, right) => left - right);
  const cells: Abstract[] = [];
  let lower = bounds.min;
  let isLowerIncluded = Number.isFinite(bounds.min);
  for (const point of points) {
    const isEmptyGap =
      lower === point ||
      (bounds.isInteger && (isLowerIncluded ? point - lower < 1 : point - lower <= 1));
    if (!isEmptyGap)
      cells.push({
        kind: "Range",
        min: lower,
        max: point,
        isMinIncluded: isLowerIncluded,
        isMaxIncluded: false,
      });
    cells.push(exact(point));
    lower = point;
    isLowerIncluded = false;
  }
  cells.push({
    kind: "Range",
    min: lower,
    max: Infinity,
    isMinIncluded: isLowerIncluded,
    isMaxIncluded: false,
  });
  return cells;
};

const createStringCells = (literals: PrimitiveValue[]): Abstract[] => {
  const strings = [
    ...new Set(literals.filter((literal): literal is string => typeof literal === "string")),
  ].sort();
  return [...strings.map(exact), { kind: "Other", type: "string", excluded: strings }];
};

const withTruthinessLiterals = (tests: PlaceTests, falsy: PrimitiveValue): PrimitiveValue[] =>
  tests.isTruthinessTested ? [...tests.literals, falsy] : tests.literals;

const createPrimitiveCells = (
  primitive: "string" | "number" | "bigint" | "boolean",
  tests: PlaceTests,
  isLength: boolean,
): Abstract[] => {
  switch (primitive) {
    case "number":
      return createNumberCells(withTruthinessLiterals(tests, 0), {
        min: isLength ? 0 : -Infinity,
        isInteger: isLength,
      });
    case "string":
      return createStringCells(withTruthinessLiterals(tests, ""));
    case "boolean":
      return [exact(false), exact(true)];
    case "bigint":
      return [{ kind: "Other", type: "any", excluded: [] }];
  }
};

const createCaseCells = (value: AbstractValue, tests: PlaceTests): Abstract[] => {
  switch (value.kind) {
    case "Literal":
      return [exact(value.value)];
    case "Type":
      return value.primitive
        ? createPrimitiveCells(value.primitive, tests, false)
        : [{ kind: "Object", typeText: value.text }];
    case "Collection":
      return [{ kind: "Object", typeText: value.collection }];
  }
};

const getPrimitiveName = (typeText: string): "string" | "number" | "boolean" | null => {
  if (typeText === "string" || typeText === "number" || typeText === "boolean") return typeText;
  return null;
};

const createUnknownCells = (tests: PlaceTests): Abstract[] => {
  const literals = [...new Set(tests.literals)];
  if (literals.length === 0)
    return tests.isTruthinessTested ? [{ kind: "Truthy" }, { kind: "Falsy" }] : [{ kind: "Any" }];
  return [...literals.map(exact), { kind: "Other", type: "any", excluded: literals }];
};

const createAbstractCells = (
  domain: Domain | null,
  tests: PlaceTests,
  isLength: boolean,
): Abstract[] => {
  if (isLength) return createPrimitiveCells("number", tests, true);
  if (!domain) return createUnknownCells(tests);
  switch (domain.kind) {
    case "Cases":
      return domain.cases.flatMap((value) => createCaseCells(value, tests));
    case "Opaque": {
      const primitive = getPrimitiveName(domain.typeText);
      return primitive
        ? createPrimitiveCells(primitive, tests, false)
        : [{ kind: "Object", typeText: domain.typeText }];
    }
    case "Unknown":
      return createUnknownCells(tests);
  }
};

export const createCells = (
  domain: Domain | null,
  tests: PlaceTests,
  isLength: boolean,
): Cell[] => {
  const usedLabels = new Set<string>();
  const cells: Cell[] = [];
  for (const value of createAbstractCells(domain, tests, isLength)) {
    const baseLabel = formatAbstract(value);
    if (usedLabels.has(baseLabel) && value.kind === "Exact") continue;
    let label = baseLabel;
    for (let suffix = 2; usedLabels.has(label); suffix++) label = `${baseLabel} ${suffix}`;
    usedLabels.add(label);
    cells.push({ label, value });
  }
  return cells;
};
