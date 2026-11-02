import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Type } from "typescript/unstable/sync";
import { isLibraryType, isReactType } from "./type-table";
import type { TypeTable } from "./type-table";
import type { PrimitiveValue, Sample } from "../types";
import { SAMPLE_DATE, TEXT_SAMPLE, getStringSamples } from "./string-samples";

const MAX_SAMPLE_ALTERNATIVES = 6;
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const ELEMENT_TYPE_PATTERN = /^(?:ReactElement|Element|ReactNode|ReactChild|ReactPortal)$/;
const PROMISE_TYPE_PATTERN = /^Promise$/;
const DATE_TYPE_PATTERN = /^Date$/;
const SET_TYPE_NAMES = new Set(["Set", "ReadonlySet"]);
const MAP_TYPE_NAMES = new Set(["Map", "ReadonlyMap"]);
const UNSAMPLED_FIELDS = new Set(["dangerouslySetInnerHTML"]);
const DOM_NODE_TYPE_PATTERN =
  /^(?:Node|Element|HTML\w*Element|SVG\w*Element|DocumentFragment|Document|ShadowRoot)$/;

const getSampleKey = (sample: Sample): string => JSON.stringify(sample);

export const dedupeSamples = (samples: Sample[]): Sample[] => [
  ...new Map(samples.map((sample) => [getSampleKey(sample), sample])).values(),
];

const TRUNCATED_OBJECT_SAMPLE: Sample = { kind: "Object", fields: {}, isOpen: true };

const getObjectSample = (types: TypeTable, type: Type, depth: number): Sample => {
  if (depth >= MAX_SAMPLE_DEPTH) return TRUNCATED_OBJECT_SAMPLE;
  const properties = types.checker
    .getPropertiesOfType(type)
    .filter((property) => !UNSAMPLED_FIELDS.has(property.name));
  const sampledProperties = properties.slice(0, MAX_SAMPLE_FIELDS);
  const propertyTypes = types.getTypesOfSymbols(sampledProperties);
  const fields: Record<string, Sample> = {};
  sampledProperties.forEach((property, index) => {
    const definedSample = getSamples(types, propertyTypes[index], depth + 1, property.name).find(
      (sample) => sample.kind !== "Undefined",
    );
    const isTruncatedOptional =
      (property.flags & SymbolFlags.Optional) !== 0 && definedSample === TRUNCATED_OBJECT_SAMPLE;
    if (definedSample && !isTruncatedOptional) fields[property.name] = definedSample;
  });
  return { kind: "Object", fields, isOpen: properties.length > MAX_SAMPLE_FIELDS };
};

const getPrimitiveSamples = (type: Type, name: string | null): Sample[] | null => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "Value", value: type.value }];
  if (type.isBooleanLiteralType()) return [{ kind: "Value", value: type.value === true }];
  if (type.flags & TypeFlags.Null) return [{ kind: "Value", value: null }];
  if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return [{ kind: "Undefined" }];
  if (type.flags & TypeFlags.StringLike) return getStringSamples(name);
  if (type.flags & (TypeFlags.NumberLike | TypeFlags.BigIntLike))
    return [
      { kind: "Value", value: 0 },
      { kind: "Value", value: 1 },
    ];
  if (type.flags & TypeFlags.BooleanLike)
    return [
      { kind: "Value", value: true },
      { kind: "Value", value: false },
    ];
  return null;
};

const getFirstSample = (
  types: TypeTable,
  type: Type | undefined,
  depth: number,
): Sample | undefined =>
  depth < MAX_SAMPLE_DEPTH ? getSamples(types, type, depth + 1)[0] : undefined;

const getCollectionSamples = (types: TypeTable, type: Type, depth: number): Sample[] | null => {
  if (isLibraryType(type, DATE_TYPE_PATTERN)) return [{ kind: "Date", value: SAMPLE_DATE }];
  if (!type.isTypeReference()) return null;
  const typeArguments = types.getTypeArguments(type);
  if (types.isArrayType(type)) {
    const itemSample = getFirstSample(types, typeArguments[0], depth);
    return itemSample
      ? [
          { kind: "Array", items: [] },
          { kind: "Array", items: [itemSample] },
        ]
      : [{ kind: "Array", items: [] }];
  }
  const symbolName = type.getSymbol()?.name;
  if (symbolName && SET_TYPE_NAMES.has(symbolName)) {
    const itemSample = getFirstSample(types, typeArguments[0], depth);
    return [{ kind: "Set", items: itemSample ? [itemSample] : [] }];
  }
  if (symbolName && MAP_TYPE_NAMES.has(symbolName)) {
    const keySample = getFirstSample(types, typeArguments[0], depth);
    const valueSample = getFirstSample(types, typeArguments[1], depth);
    return [{ kind: "Map", entries: keySample && valueSample ? [[keySample, valueSample]] : [] }];
  }
  if (isLibraryType(type, PROMISE_TYPE_PATTERN)) {
    const resolvedSample = getFirstSample(types, typeArguments[0], depth);
    return [{ kind: "Promise", value: resolvedSample ?? { kind: "Undefined" } }];
  }
  if (type.isTupleType())
    return [
      {
        kind: "Array",
        items: typeArguments.map(
          (itemType) => getSamples(types, itemType, depth + 1)[0] ?? TEXT_SAMPLE,
        ),
      },
    ];
  return null;
};

export const getSamples = (
  types: TypeTable,
  type: Type | undefined,
  depth = 0,
  name: string | null = null,
): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown)
    return getStringSamples(name).slice(0, 1);
  if (isLibraryType(type, DOM_NODE_TYPE_PATTERN)) return [{ kind: "Undefined" }];
  if (isReactType(type, ELEMENT_TYPE_PATTERN)) return [{ kind: "Element" }];
  if (type.isUnionType()) {
    const memberSamples = dedupeSamples(
      (types.getUnionMembers(type) ?? []).flatMap((member) =>
        getSamples(types, member, depth, name),
      ),
    );
    return [
      ...memberSamples.filter((sample) => sample.kind !== "Undefined"),
      ...memberSamples.filter((sample) => sample.kind === "Undefined"),
    ].slice(0, MAX_SAMPLE_ALTERNATIVES);
  }
  const primitiveSamples = getPrimitiveSamples(type, name);
  if (primitiveSamples) return primitiveSamples;
  if (type.isIntersectionType())
    for (const member of types.getIntersectionMembers(type)) {
      const brandedSamples =
        getPrimitiveSamples(member, name) ?? getCollectionSamples(types, member, depth);
      if (brandedSamples) return brandedSamples;
    }
  const [signature] = types.getCallSignatures(type);
  if (signature)
    return [
      {
        kind: "Function",
        returns: getFirstSample(types, types.getReturnType(signature), depth) ?? null,
      },
    ];
  if (types.checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0)
    return [{ kind: "Function", returns: null }];
  const collectionSamples = getCollectionSamples(types, type, depth);
  if (collectionSamples) return collectionSamples;
  if (type.flags & (TypeFlags.Object | TypeFlags.Intersection))
    return [getObjectSample(types, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSampleOfValue = (value: PrimitiveValue): Sample =>
  value === undefined ? { kind: "Undefined" } : { kind: "Value", value };
