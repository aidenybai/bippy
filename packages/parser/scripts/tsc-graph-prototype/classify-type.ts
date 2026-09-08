import ts from "typescript";

export type TypeVerdict =
  | "literal"
  | "literal-union"
  | "always-truthy"
  | "always-falsy"
  | "nullable-object"
  | "broad-primitive"
  | "broad-object"
  | "any-or-unknown"
  | "error";

export interface TypeClassification {
  verdict: TypeVerdict;
  typeText: string;
  literals: (string | number | boolean | null | undefined)[];
  decidesTruthiness: boolean;
  isFunctionType: boolean;
}

const FALSY_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;

const describeIntrinsic = (type: ts.Type): string | null =>
  "intrinsicName" in type && typeof type.intrinsicName === "string" ? type.intrinsicName : null;

const literalValueOf = (type: ts.Type): string | number | boolean | null | undefined => {
  if (type.flags & ts.TypeFlags.Undefined || type.flags & ts.TypeFlags.Void) return undefined;
  if (type.flags & ts.TypeFlags.Null) return null;
  if (type.isStringLiteral()) return type.value;
  if (type.isNumberLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.BooleanLiteral) return describeIntrinsic(type) === "true";
  throw new Error(`not a literal type: ${type.flags}`);
};

const isLiteralLike = (type: ts.Type): boolean =>
  (type.flags &
    (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral)) !==
    0 || (type.flags & FALSY_FLAGS) !== 0;

const isDefinitelyTruthy = (type: ts.Type): boolean => {
  if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive | ts.TypeFlags.ESSymbolLike))
    return true;
  if (type.isStringLiteral()) return type.value.length > 0;
  if (type.isNumberLiteral()) return type.value !== 0 && !Number.isNaN(type.value);
  if (type.flags & ts.TypeFlags.BooleanLiteral) return describeIntrinsic(type) === "true";
  return false;
};

const isDefinitelyFalsy = (type: ts.Type): boolean => {
  if (type.flags & FALSY_FLAGS) return true;
  if (type.isStringLiteral()) return type.value.length === 0;
  if (type.isNumberLiteral()) return type.value === 0 || Number.isNaN(type.value);
  if (type.flags & ts.TypeFlags.BooleanLiteral) return describeIntrinsic(type) === "false";
  return false;
};

const constituentsOf = (type: ts.Type): ts.Type[] => (type.isUnion() ? type.types : [type]);

const hasBothBooleanLiterals = (constituents: ts.Type[]): boolean => {
  const booleanNames = new Set(
    constituents
      .filter((constituent) => constituent.flags & ts.TypeFlags.BooleanLiteral)
      .map((constituent) => describeIntrinsic(constituent)),
  );
  return booleanNames.has("true") && booleanNames.has("false");
};

export const classifyType = (checker: ts.TypeChecker, type: ts.Type): TypeClassification => {
  const typeText = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const constituents = constituentsOf(type);
  const isFunctionType = constituents.every(
    (constituent) =>
      constituent.getCallSignatures().length > 0 || constituent.getConstructSignatures().length > 0,
  );
  const base = { typeText, literals: [], decidesTruthiness: false, isFunctionType };
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return { ...base, verdict: describeIntrinsic(type) === "error" ? "error" : "any-or-unknown" };
  }
  if (type.flags & ts.TypeFlags.Boolean || hasBothBooleanLiterals(constituents)) {
    return { ...base, verdict: "broad-primitive" };
  }
  if (constituents.every(isLiteralLike)) {
    const literals = constituents.map(literalValueOf);
    const allTruthy = constituents.every(isDefinitelyTruthy);
    const allFalsy = constituents.every(isDefinitelyFalsy);
    return {
      ...base,
      verdict: constituents.length === 1 ? "literal" : "literal-union",
      literals,
      decidesTruthiness: allTruthy || allFalsy,
    };
  }
  if (constituents.every(isDefinitelyTruthy))
    return { ...base, verdict: "always-truthy", decidesTruthiness: true };
  if (constituents.every(isDefinitelyFalsy))
    return { ...base, verdict: "always-falsy", decidesTruthiness: true };
  const hasObject = constituents.some((constituent) => constituent.flags & ts.TypeFlags.Object);
  const hasNullish = constituents.some((constituent) => constituent.flags & FALSY_FLAGS);
  if (hasObject && hasNullish) return { ...base, verdict: "nullable-object" };
  if (hasObject) return { ...base, verdict: "broad-object" };
  return { ...base, verdict: "broad-primitive" };
};
