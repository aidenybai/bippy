import { TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { AbstractValue, Domain, PrimitiveTypeName, PrimitiveValue } from "./types";
import { formatAbstractValue } from "./format";
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";
import { getUnionMembers } from "./utils/get-union-members";

export const UNDEFINED_CASE: AbstractValue = { kind: "Literal", value: undefined };

const getPrimitiveTypeName = (type: Type): PrimitiveTypeName | null => {
  if (type.flags & TypeFlags.StringLike) return "string";
  if (type.flags & TypeFlags.NumberLike) return "number";
  if (type.flags & TypeFlags.BigIntLike) return "bigint";
  if (type.flags & TypeFlags.BooleanLike) return "boolean";
  return null;
};

export const getAbstractValue = (checker: Checker, type: Type): AbstractValue => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return { kind: "Literal", value: type.value };
  if (type.isBooleanLiteralType())
    return { kind: "Literal", value: checker.typeToString(type) === "true" };
  if (type.flags & TypeFlags.Null) return { kind: "Literal", value: null };
  if (type.flags & TypeFlags.Undefined) return UNDEFINED_CASE;
  return { kind: "Type", text: checker.typeToString(type), primitive: getPrimitiveTypeName(type) };
};

export const getDomainOfType = (checker: Checker, type: Type | undefined): Domain => {
  if (!type || type.isErrorType()) return { kind: "Unknown", reason: "unresolved" };
  if (type.flags & TypeFlags.Any) return { kind: "Unknown", reason: "any" };
  if (type.flags & TypeFlags.Unknown) return { kind: "Unknown", reason: "unknown" };
  if (type.flags & TypeFlags.Never) return { kind: "Unknown", reason: "never" };
  if (type.isUnionType()) {
    const members = getUnionMembers(type);
    if (!members) return { kind: "Unknown", reason: "unresolved" };
    return {
      kind: "Cases",
      cases: members.map((member) => getAbstractValue(checker, member)),
      origin: "type",
    };
  }
  if (type.isLiteralType() || type.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
    return { kind: "Cases", cases: [getAbstractValue(checker, type)], origin: "type" };
  }
  return { kind: "Opaque", typeText: checker.typeToString(type) };
};

export const getDomainWithUndefined = (checker: Checker, type: Type | undefined): Domain => {
  const domain = getDomainOfType(checker, type);
  if (domain.kind === "Cases")
    return domain.cases.some((value) => value.kind === "Literal" && value.value === undefined)
      ? domain
      : { ...domain, cases: [...domain.cases, UNDEFINED_CASE] };
  if (domain.kind === "Opaque" && type)
    return {
      kind: "Cases",
      cases: [getAbstractValue(checker, type), UNDEFINED_CASE],
      origin: "type",
    };
  return domain;
};

export type Membership = "in" | "out" | "maybe";

export const describeCases = (cases: AbstractValue[]): string =>
  cases.map(formatAbstractValue).join(" | ");

const includesLiteral = (cases: AbstractValue[], value: PrimitiveValue): boolean =>
  cases.some((candidate) =>
    candidate.kind === "Literal"
      ? candidate.value === value
      : canTypeEqualLiteral(candidate, value, "==="),
  );

export const classify = (value: AbstractValue, cases: AbstractValue[]): Membership => {
  if (value.kind === "Literal") return includesLiteral(cases, value.value) ? "in" : "out";
  if (cases.some((candidate) => candidate.kind === "Type" && candidate.text === value.text))
    return "in";
  const mayEqual = cases.some(
    (candidate) =>
      candidate.kind === "Literal" && canTypeEqualLiteral(value, candidate.value, "==="),
  );
  return mayEqual ? "maybe" : "out";
};

const NULLISH_CASES: AbstractValue[] = [
  { kind: "Literal", value: null },
  { kind: "Literal", value: undefined },
];

export const withNullishCases = (cases: AbstractValue[]): AbstractValue[] => [
  ...cases,
  ...NULLISH_CASES.filter((nullish) => classify(nullish, cases) !== "in"),
];

export const isPrimitiveDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" || value.primitive !== null);

export const isBooleanDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" && typeof value.value === "boolean");
