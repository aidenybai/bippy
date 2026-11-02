import { TypeFlags } from "typescript/unstable/sync";
import type { Type } from "typescript/unstable/sync";
import type { AbstractValue, Domain, PrimitiveTypeName, PrimitiveValue } from "../types";
import { formatAbstractValue } from "../values/format";
import type { TypeTable } from "./type-table";

export const UNDEFINED_CASE: AbstractValue = { kind: "Literal", value: undefined };

const getPrimitiveTypeName = (type: Type): PrimitiveTypeName | null => {
  if (type.flags & TypeFlags.StringLike) return "string";
  if (type.flags & TypeFlags.NumberLike) return "number";
  if (type.flags & TypeFlags.BigIntLike) return "bigint";
  if (type.flags & TypeFlags.BooleanLike) return "boolean";
  return null;
};

export const getAbstractValue = (types: TypeTable, type: Type): AbstractValue => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return { kind: "Literal", value: type.value };
  if (type.isBooleanLiteralType()) return { kind: "Literal", value: type.value === true };
  if (type.flags & TypeFlags.Null) return { kind: "Literal", value: null };
  if (type.flags & TypeFlags.Undefined) return UNDEFINED_CASE;
  return { kind: "Type", text: types.getText(type), primitive: getPrimitiveTypeName(type) };
};

export const getDomainOfType = (types: TypeTable, type: Type | undefined): Domain => {
  if (!type || type.isErrorType()) return { kind: "Unknown", reason: "unresolved" };
  if (type.flags & TypeFlags.Any) return { kind: "Unknown", reason: "any" };
  if (type.flags & TypeFlags.Unknown) return { kind: "Unknown", reason: "unknown" };
  if (type.flags & TypeFlags.Never) return { kind: "Unknown", reason: "never" };
  if (type.isUnionType()) {
    const members = types.getUnionMembers(type);
    if (!members) return { kind: "Unknown", reason: "unresolved" };
    return {
      kind: "Cases",
      cases: members.map((member) => getAbstractValue(types, member)),
      origin: "type",
    };
  }
  if (type.isLiteralType() || type.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
    return { kind: "Cases", cases: [getAbstractValue(types, type)], origin: "type" };
  }
  const typeText = types.getText(type);
  return { kind: "Opaque", typeText };
};

export const getDomainWithUndefined = (types: TypeTable, type: Type | undefined): Domain => {
  const domain = getDomainOfType(types, type);
  if (domain.kind === "Cases")
    return domain.cases.some((value) => value.kind === "Literal" && value.value === undefined)
      ? domain
      : { ...domain, cases: [...domain.cases, UNDEFINED_CASE] };
  if (domain.kind === "Opaque" && type)
    return {
      kind: "Cases",
      cases: [getAbstractValue(types, type), UNDEFINED_CASE],
      origin: "type",
    };
  return domain;
};

export const describeCases = (cases: AbstractValue[]): string =>
  cases.map(formatAbstractValue).join(" | ");

const includesLiteral = (cases: AbstractValue[], value: PrimitiveValue): boolean =>
  cases.some((candidate) =>
    candidate.kind === "Literal"
      ? candidate.value === value
      : candidate.text === "any" || candidate.text === "unknown" || candidate.text === "{}",
  );

export const withNullishCases = (cases: AbstractValue[]): AbstractValue[] => [
  ...cases,
  ...[null, undefined]
    .filter((value) => !includesLiteral(cases, value))
    .map((value): AbstractValue => ({ kind: "Literal", value })),
];

const getCasePrimitive = (value: AbstractValue): PrimitiveTypeName | null => {
  if (value.kind === "Type") return value.primitive;
  if (value.kind !== "Literal") return null;
  if (typeof value.value === "number") return "number";
  return typeof value.value === "string" ? "string" : null;
};

export const getDomainPrimitive = (domain: Domain): PrimitiveTypeName | null => {
  if (domain.kind === "Opaque")
    return domain.typeText === "number" || domain.typeText === "string" ? domain.typeText : null;
  if (domain.kind !== "Cases") return null;
  const [first, ...rest] = domain.cases.map(getCasePrimitive);
  return first !== undefined && rest.every((primitive) => primitive === first) ? first : null;
};
