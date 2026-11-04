import type { AbstractValue, Domain, PrimitiveValue } from "../types";
import { isSameValue } from "./abstract";
import type { Abstract, Value } from "./types";
import { createUniqueLabel } from "./unique-label";

export interface PlaceTests {
  literals: PrimitiveValue[];
  isTruthinessTested: boolean;
}

interface NumberBounds {
  min: number;
  isInteger: boolean;
}

const formatBound = (value: number): string => String(value);

const formatAbstract = (value: Abstract): string => {
  switch (value.kind) {
    case "Exact":
      if (value.value === "") return "empty";
      return String(value.value);
    case "Range": {
      if (value.min === -Infinity && value.max === Infinity) return "any number";
      if (value.min === -Infinity)
        return `${value.isMaxIncluded ? "<=" : "<"}${formatBound(value.max)}`;
      if (value.max === Infinity)
        return `${value.isMinIncluded ? ">=" : ">"}${formatBound(value.min)}`;
      return `${value.isMinIncluded ? "[" : "("}${value.min}, ${value.max}${value.isMaxIncluded ? "]" : ")"}`;
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

const isSameExact = (left: Abstract, right: Abstract): boolean =>
  left.kind === "Exact" && right.kind === "Exact" && isSameValue(left.value, right.value);

const createNumberValues = (literals: PrimitiveValue[], bounds: NumberBounds): Abstract[] => {
  const points = [
    ...new Set(
      literals.filter(
        (literal): literal is number =>
          typeof literal === "number" && Number.isFinite(literal) && literal >= bounds.min,
      ),
    ),
  ].sort((left, right) => left - right);
  const values: Abstract[] = [];
  let lower = bounds.min;
  let isLowerIncluded = true;
  for (const point of points) {
    const isEmptyGap =
      lower === point ||
      (bounds.isInteger && (isLowerIncluded ? point - lower < 1 : point - lower <= 1));
    if (!isEmptyGap)
      values.push({
        kind: "Range",
        min: lower,
        max: point,
        isMinIncluded: isLowerIncluded,
        isMaxIncluded: false,
      });
    values.push(exact(point));
    lower = point;
    isLowerIncluded = false;
  }
  values.push({
    kind: "Range",
    min: lower,
    max: Infinity,
    isMinIncluded: isLowerIncluded,
    isMaxIncluded: !bounds.isInteger,
  });
  return bounds.isInteger ? values : [...values, exact(NaN)];
};

const createStringValues = (literals: PrimitiveValue[]): Abstract[] => {
  const strings = [
    ...new Set(literals.filter((literal): literal is string => typeof literal === "string")),
  ].sort();
  return [...strings.map(exact), { kind: "Other", type: "string", excluded: strings }];
};

const withTruthinessLiterals = (tests: PlaceTests, falsy: PrimitiveValue): PrimitiveValue[] =>
  tests.isTruthinessTested ? [...tests.literals, falsy] : tests.literals;

const createPrimitiveValues = (
  primitive: "string" | "number" | "bigint" | "boolean",
  tests: PlaceTests,
  isLength: boolean,
): Abstract[] => {
  switch (primitive) {
    case "number":
      return createNumberValues(withTruthinessLiterals(tests, 0), {
        min: isLength ? 0 : -Infinity,
        isInteger: isLength,
      });
    case "string":
      return createStringValues(withTruthinessLiterals(tests, ""));
    case "boolean":
      return [exact(false), exact(true)];
    case "bigint":
      return [{ kind: "Other", type: "any", excluded: [] }];
  }
};

const createCaseValues = (value: AbstractValue, tests: PlaceTests): Abstract[] => {
  switch (value.kind) {
    case "Literal":
      return [exact(value.value)];
    case "Type":
      return value.primitive
        ? createPrimitiveValues(value.primitive, tests, false)
        : [{ kind: "Object", typeText: value.text }];
  }
};

const createUnknownValues = (tests: PlaceTests): Abstract[] => {
  const literals = [...new Set(tests.literals)];
  if (literals.length === 0)
    return tests.isTruthinessTested ? [{ kind: "Truthy" }, { kind: "Falsy" }] : [{ kind: "Any" }];
  return [...literals.map(exact), { kind: "Other", type: "any", excluded: literals }];
};

const createAbstractValues = (
  typeDomain: Domain | null,
  tests: PlaceTests,
  isLength: boolean,
): Abstract[] => {
  if (isLength) return createPrimitiveValues("number", tests, true);
  if (!typeDomain) return createUnknownValues(tests);
  switch (typeDomain.kind) {
    case "Cases":
      return typeDomain.cases.flatMap((value) => createCaseValues(value, tests));
    case "Unknown":
      return createUnknownValues(tests);
  }
};

export const createDomain = (
  typeDomain: Domain | null,
  tests: PlaceTests,
  isLength: boolean,
): Value[] => {
  const usedLabels = new Set<string>();
  const values: Value[] = [];
  for (const abstract of createAbstractValues(typeDomain, tests, isLength)) {
    if (values.some((value) => isSameExact(value.abstract, abstract))) continue;
    const baseLabel = formatAbstract(abstract);
    const label = createUniqueLabel(baseLabel, usedLabels, (suffix) => ` ${suffix}`);
    usedLabels.add(label);
    values.push({ label, abstract });
  }
  return values;
};

export const getValueLabels = (values: Value[]): string[] => values.map((value) => value.label);
