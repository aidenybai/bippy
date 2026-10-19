import { formatAbstractValue } from "./format";
import type { AbstractValue } from "./types";

type LiteralValue = Extract<AbstractValue, { kind: "Literal" }>;
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";

export type Membership = "in" | "out" | "maybe";

export const describeCases = (cases: AbstractValue[]): string =>
  cases.map(formatAbstractValue).join(" | ");

const includesLiteral = (cases: AbstractValue[], value: LiteralValue["value"]): boolean =>
  cases.some((candidate) =>
    candidate.kind === "Literal"
      ? candidate.value === value
      : canTypeEqualLiteral(candidate, value),
  );

export const classify = (value: AbstractValue, cases: AbstractValue[]): Membership => {
  if (value.kind === "Literal") return includesLiteral(cases, value.value) ? "in" : "out";
  if (cases.some((candidate) => candidate.kind === "Type" && candidate.text === value.text))
    return "in";
  const mayEqual = cases.some(
    (candidate) => candidate.kind === "Literal" && canTypeEqualLiteral(value, candidate.value),
  );
  return mayEqual ? "maybe" : "out";
};

export const isPrimitiveDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" || value.primitive !== null);

export const isBooleanDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" && typeof value.value === "boolean");
