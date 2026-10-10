import { SignatureKind, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { Sample } from "./model.ts";

const MAX_ALTERNATIVES = 6;
const MAX_DEPTH = 3;
const MAX_FIELDS = 24;
const RENDERABLE_TYPE_PATTERN = /ReactNode|ReactElement|JSX\.Element|ReactChild|ReactPortal/;
const TEXT_SAMPLE: Sample = { kind: "value", value: "text" };

const dedupeSamples = (samples: Sample[]): Sample[] => {
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = JSON.stringify(sample);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getObjectSample = (checker: Checker, type: Type, depth: number): Sample => {
  if (depth >= MAX_DEPTH) return { kind: "object", fields: {} };
  const fields: Record<string, Sample> = {};
  for (const property of checker.getPropertiesOfType(type).slice(0, MAX_FIELDS)) {
    const firstDefinedSample = getSamples(
      checker,
      checker.getTypeOfSymbol(property),
      depth + 1,
    ).find((sample) => sample.kind !== "undefined");
    if (firstDefinedSample) fields[property.name] = firstDefinedSample;
  }
  return { kind: "object", fields };
};

export const getSamples = (checker: Checker, type: Type | undefined, depth = 0): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown) return [TEXT_SAMPLE];
  if (RENDERABLE_TYPE_PATTERN.test(checker.typeToString(type))) return [TEXT_SAMPLE];
  if (type.isUnionType()) {
    return dedupeSamples(
      type.getTypes().flatMap((member) => getSamples(checker, member, depth)),
    ).slice(0, MAX_ALTERNATIVES);
  }
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "value", value: type.value }];
  if (type.isBooleanLiteralType())
    return [{ kind: "value", value: checker.typeToString(type) === "true" }];
  if (type.flags & TypeFlags.Null) return [{ kind: "value", value: null }];
  if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return [{ kind: "undefined" }];
  if (type.flags & TypeFlags.StringLike) return [TEXT_SAMPLE, { kind: "value", value: "" }];
  if (type.flags & (TypeFlags.NumberLike | TypeFlags.BigIntLike))
    return [
      { kind: "value", value: 0 },
      { kind: "value", value: 1 },
    ];
  if (type.flags & TypeFlags.BooleanLike)
    return [
      { kind: "value", value: true },
      { kind: "value", value: false },
    ];
  if (checker.getSignaturesOfType(type, SignatureKind.Call).length > 0)
    return [{ kind: "function" }];
  if (checker.isArrayType(type) && type.isTypeReference()) {
    const [elementType] = checker.getTypeArguments(type);
    const [elementSample] = depth < MAX_DEPTH ? getSamples(checker, elementType, depth + 1) : [];
    return elementSample
      ? [
          { kind: "array", items: [] },
          { kind: "array", items: [elementSample] },
        ]
      : [{ kind: "array", items: [] }];
  }
  if (type.isTupleType() && type.isTypeReference()) {
    const items = checker
      .getTypeArguments(type)
      .map((itemType) => getSamples(checker, itemType, depth + 1)[0] ?? TEXT_SAMPLE);
    return [{ kind: "array", items }];
  }
  if (type.flags & TypeFlags.Object) return [getObjectSample(checker, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSamplesFromCases = (cases: string[]): Sample[] =>
  cases.map((caseText): Sample => {
    if (caseText === "undefined") return { kind: "undefined" };
    try {
      const value: unknown = JSON.parse(caseText);
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        return { kind: "value", value };
    } catch {
      return TEXT_SAMPLE;
    }
    return TEXT_SAMPLE;
  });
