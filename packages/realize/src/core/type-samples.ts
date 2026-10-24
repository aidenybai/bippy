import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Symbol, Type } from "typescript/unstable/sync";
import { isLibraryType, isReactType } from "./utils/typescript";
import { getTypeArguments } from "./utils/get-type-arguments";
import { getUnionMembers } from "./utils/get-union-members";
import type { PrimitiveValue, Sample } from "./types";
import { SAMPLE_DATE, TEXT_SAMPLE, getStringSamples } from "./string-samples";

const MAX_SAMPLE_ALTERNATIVES = 6;
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const ELEMENT_TYPE_PATTERN = /^(?:ReactElement|Element)$/;
const PROMISE_TYPE_PATTERN = /^Promise$/;
const DATE_TYPE_PATTERN = /^Date$/;
const SET_TYPE_NAMES = new Set(["Set", "ReadonlySet"]);
const MAP_TYPE_NAMES = new Set(["Map", "ReadonlyMap"]);
const UNSAMPLED_FIELDS = new Set(["dangerouslySetInnerHTML"]);
const DOM_NODE_TYPE_PATTERN =
  /^(?:Node|Element|HTML\w*Element|SVG\w*Element|DocumentFragment|Document|ShadowRoot)$/;
const NODE_TYPE_PATTERN = /^(?:ReactNode|ReactChild|ReactPortal)$/;

const getSampleKey = (sample: Sample): string => JSON.stringify(sample);

export const dedupeSamples = (samples: Sample[]): Sample[] => [
  ...new Map(samples.map((sample) => [getSampleKey(sample), sample])).values(),
];

const TRUNCATED_OBJECT_SAMPLE: Sample = { kind: "Object", fields: {}, isOpen: true };

const isTruncatedOptionalField = (property: Symbol, sample: Sample): boolean =>
  (property.flags & SymbolFlags.Optional) !== 0 && sample === TRUNCATED_OBJECT_SAMPLE;

const getObjectSample = (checker: Checker, type: Type, depth: number): Sample => {
  if (depth >= MAX_SAMPLE_DEPTH) return TRUNCATED_OBJECT_SAMPLE;
  const properties = checker
    .getPropertiesOfType(type)
    .filter((property) => !UNSAMPLED_FIELDS.has(property.name));
  const fields: Record<string, Sample> = {};
  for (const property of properties.slice(0, MAX_SAMPLE_FIELDS)) {
    const definedSample = getPropertySamples(checker, property, depth + 1).find(
      (sample) => sample.kind !== "Undefined",
    );
    if (definedSample && !isTruncatedOptionalField(property, definedSample))
      fields[property.name] = definedSample;
  }
  return { kind: "Object", fields, isOpen: properties.length > MAX_SAMPLE_FIELDS };
};

const getPrimitiveSamples = (
  checker: Checker,
  type: Type,
  name: string | null,
): Sample[] | null => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "Value", value: type.value }];
  if (type.isBooleanLiteralType())
    return [{ kind: "Value", value: checker.typeToString(type) === "true" }];
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
  checker: Checker,
  type: Type | undefined,
  depth: number,
): Sample | undefined =>
  depth < MAX_SAMPLE_DEPTH ? getSamples(checker, type, depth + 1)[0] : undefined;

const getCollectionSamples = (checker: Checker, type: Type, depth: number): Sample[] | null => {
  if (isLibraryType(type, DATE_TYPE_PATTERN)) return [{ kind: "Date", value: SAMPLE_DATE }];
  if (!type.isTypeReference()) return null;
  const typeArguments = getTypeArguments(checker, type);
  if (checker.isArrayType(type)) {
    const itemSample = getFirstSample(checker, typeArguments[0], depth);
    return itemSample
      ? [
          { kind: "Array", items: [] },
          { kind: "Array", items: [itemSample] },
        ]
      : [{ kind: "Array", items: [] }];
  }
  const symbolName = type.getSymbol()?.name;
  if (symbolName && SET_TYPE_NAMES.has(symbolName)) {
    const itemSample = getFirstSample(checker, typeArguments[0], depth);
    return [{ kind: "Set", items: itemSample ? [itemSample] : [] }];
  }
  if (symbolName && MAP_TYPE_NAMES.has(symbolName)) {
    const keySample = getFirstSample(checker, typeArguments[0], depth);
    const valueSample = getFirstSample(checker, typeArguments[1], depth);
    return [{ kind: "Map", entries: keySample && valueSample ? [[keySample, valueSample]] : [] }];
  }
  if (isLibraryType(type, PROMISE_TYPE_PATTERN)) {
    const resolvedSample = getFirstSample(checker, typeArguments[0], depth);
    return [{ kind: "Promise", value: resolvedSample ?? { kind: "Undefined" } }];
  }
  if (type.isTupleType())
    return [
      {
        kind: "Array",
        items: typeArguments.map(
          (itemType) => getSamples(checker, itemType, depth + 1)[0] ?? TEXT_SAMPLE,
        ),
      },
    ];
  return null;
};

const getBrandedSamples = (
  checker: Checker,
  members: readonly Type[],
  depth: number,
  name: string | null,
): Sample[] | null => {
  for (const member of members) {
    const samples =
      getPrimitiveSamples(checker, member, name) ?? getCollectionSamples(checker, member, depth);
    if (samples) return samples;
  }
  return null;
};

export const getSamples = (
  checker: Checker,
  type: Type | undefined,
  depth = 0,
  name: string | null = null,
): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown)
    return getStringSamples(name).slice(0, 1);
  if (isLibraryType(type, DOM_NODE_TYPE_PATTERN)) return [{ kind: "Undefined" }];
  if (isReactType(type, ELEMENT_TYPE_PATTERN)) return [{ kind: "Element" }];
  if (isReactType(type, NODE_TYPE_PATTERN)) return [{ kind: "Element" }];
  if (type.isUnionType()) {
    const memberSamples = dedupeSamples(
      (getUnionMembers(type) ?? []).flatMap((member) => getSamples(checker, member, depth, name)),
    );
    return [
      ...memberSamples.filter((sample) => sample.kind !== "Undefined"),
      ...memberSamples.filter((sample) => sample.kind === "Undefined"),
    ].slice(0, MAX_SAMPLE_ALTERNATIVES);
  }
  const primitiveSamples = getPrimitiveSamples(checker, type, name);
  if (primitiveSamples) return primitiveSamples;
  const brandedSamples = type.isIntersectionType()
    ? getBrandedSamples(checker, type.getTypes() ?? [], depth, name)
    : null;
  if (brandedSamples) return brandedSamples;
  const [signature] = checker.getSignaturesOfType(type, SignatureKind.Call);
  if (signature) {
    const returnSample = getFirstSample(
      checker,
      checker.getReturnTypeOfSignature(signature),
      depth,
    );
    return [{ kind: "Function", returns: returnSample ?? null }];
  }
  if (checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0)
    return [{ kind: "Function", returns: null }];
  const collectionSamples = getCollectionSamples(checker, type, depth);
  if (collectionSamples) return collectionSamples;
  if (type.flags & (TypeFlags.Object | TypeFlags.Intersection))
    return [getObjectSample(checker, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSampleOfValue = (value: PrimitiveValue): Sample =>
  value === undefined ? { kind: "Undefined" } : { kind: "Value", value };

export const getPropertySamples = (checker: Checker, property: Symbol, depth: number): Sample[] =>
  getSamples(checker, checker.getTypeOfSymbol(property), depth, property.name);
