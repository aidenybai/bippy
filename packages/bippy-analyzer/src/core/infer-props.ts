import { dedupeSamples, getSampleOfValue } from "./type-samples";
import { getStringSamples } from "./string-samples";
import type {
  Binding,
  ComponentAnalysis,
  JsxExpressionValue,
  JsxProp,
  PrimitiveSymbolicValue,
  Sample,
  SymbolicValue,
} from "./types";
import { forEachJsxElement } from "./utils/traverse";
import { appendToGroup } from "./utils/group";
import { getBindingPlace } from "./utils/place";

const ARRAY_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "join",
  "map",
  "reduce",
  "some",
  "sort",
]);
const STRING_METHOD_NAMES = new Set([
  "charAt",
  "endsWith",
  "padEnd",
  "padStart",
  "replace",
  "replaceAll",
  "split",
  "startsWith",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
]);
const SHARED_MEMBER_NAMES = new Set(["at", "includes", "indexOf", "length", "slice"]);
const INDEX_PATTERN = /^\d+$/;
const STYLE_SAMPLE: Sample = { kind: "Object", fields: {}, isOpen: false };

const inferSampleFromReadPaths = (name: string, readPaths: string[][]): Sample => {
  const restPathsByField = new Map<string, string[][]>();
  for (const [field, ...restPath] of readPaths)
    if (field !== undefined) appendToGroup(restPathsByField, field, restPath);
  const fieldNames = [...restPathsByField.keys()];
  if (
    fieldNames.length === 0 ||
    fieldNames.some((field) => STRING_METHOD_NAMES.has(field)) ||
    fieldNames.every((field) => SHARED_MEMBER_NAMES.has(field))
  )
    return getStringSamples(name)[0] ?? { kind: "Undefined" };
  if (restPathsByField.has("props")) return { kind: "Element" };
  if (fieldNames.some((field) => ARRAY_METHOD_NAMES.has(field) || INDEX_PATTERN.test(field))) {
    const itemPaths = fieldNames.flatMap((field) =>
      INDEX_PATTERN.test(field) ? (restPathsByField.get(field) ?? []) : [],
    );
    return {
      kind: "Array",
      items: itemPaths.length > 0 ? [inferSampleFromReadPaths(name, itemPaths)] : [],
    };
  }
  return {
    kind: "Object",
    fields: Object.fromEntries(
      [...restPathsByField].map(([field, restPaths]) => [
        field,
        inferSampleFromReadPaths(
          field,
          restPaths.filter((restPath) => restPath.length > 0),
        ),
      ]),
    ),
    isOpen: false,
  };
};

const getStyleSourceValues = (styleValue: SymbolicValue): SymbolicValue[] =>
  styleValue.kind === "ObjectExpression" ? styleValue.spreads : [styleValue];

const getHostStyleBindingIds = (render: SymbolicValue): Set<number> => {
  const bindingIds = new Set<number>();
  forEachJsxElement(render, (element) => {
    if (element.tag.kind !== "BuiltinTag") return;
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || prop.name !== "style") continue;
      for (const sourceValue of getStyleSourceValues(prop.value))
        if (sourceValue.kind === "Binding" && sourceValue.path.length === 0)
          bindingIds.add(sourceValue.binding.id);
    }
  });
  return bindingIds;
};

const inferUntypedPropSample = (
  binding: Binding,
  readPaths: string[][] | undefined,
  hostStyleBindingIds: Set<number>,
): Sample | null => {
  if (readPaths) return inferSampleFromReadPaths(binding.propName ?? binding.name, readPaths);
  return hostStyleBindingIds.has(binding.id) ? STYLE_SAMPLE : null;
};

export const addSamplesFromReadPaths = (analysis: ComponentAnalysis): void => {
  const readPathsByBinding = new Map<number, string[][]>();
  for (const { bindingId, path } of analysis.placeDomains.places()) {
    if (path.length > 0) appendToGroup(readPathsByBinding, bindingId, path);
  }
  const hostStyleBindingIds = getHostStyleBindingIds(analysis.render);
  for (const binding of analysis.bindings) {
    if (binding.kind !== "prop" || binding.domain.kind !== "Unknown") continue;
    const inferredSample = inferUntypedPropSample(
      binding,
      readPathsByBinding.get(binding.id),
      hostStyleBindingIds,
    );
    if (inferredSample) binding.samples = [inferredSample, ...binding.samples];
  }
  for (const [contextKey, bindingId] of analysis.untypedContextBindingIds) {
    const readPaths = readPathsByBinding.get(bindingId);
    if (readPaths) analysis.contextSamples.set(contextKey, inferSampleFromReadPaths("", readPaths));
  }
};

const isPrimitive = (value: SymbolicValue | undefined): value is PrimitiveSymbolicValue =>
  value?.kind === "Primitive";

const getLiteralSample = (value: SymbolicValue | undefined): Sample | null => {
  if (value?.kind === "Primitive") return getSampleOfValue(value.value);
  if (value?.kind === "ArrayExpression" && value.spreads.length === 0) {
    const items = value.elements.flatMap((element): Sample[] => {
      const itemSample = getLiteralSample(element);
      return itemSample ? [itemSample] : [];
    });
    return items.length === value.elements.length ? { kind: "Array", items } : null;
  }
  if (value?.kind === "ObjectExpression" && value.spreads.length === 0) {
    const fields = value.properties.flatMap((property): Array<[string, Sample]> => {
      const fieldSample = getLiteralSample(property.value);
      return fieldSample ? [[property.key, fieldSample]] : [];
    });
    return fields.length === value.properties.length
      ? { kind: "Object", fields: Object.fromEntries(fields), isOpen: false }
      : null;
  }
  return null;
};

const narrowPropFromCallSites = (
  analysis: ComponentAnalysis,
  binding: Binding,
  callSites: JsxExpressionValue[],
): void => {
  const passedValues = callSites.map(
    (callSite) =>
      callSite.props.find(
        (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === binding.propName,
      )?.value,
  );
  if (!passedValues.every(isPrimitive)) {
    const literalSamples = passedValues.flatMap(
      (passedValue) => getLiteralSample(passedValue) ?? [],
    );
    binding.samples = [...dedupeSamples(literalSamples), ...binding.samples];
    return;
  }
  const literals = [...new Set(passedValues.map((passedValue) => passedValue.value))];
  binding.domain = {
    kind: "Cases",
    cases: literals.map((literal) => ({ kind: "Literal", value: literal })),
    origin: "call-sites",
  };
  binding.samples = literals.map(getSampleOfValue);
  analysis.placeDomains.set(getBindingPlace(binding), binding.domain);
  analysis.bailouts = analysis.bailouts.filter(
    (bailout) => !(bailout.reason === "untyped-prop" && bailout.loc === binding.loc),
  );
};

export const inferPropsFromCallSites = (analyses: ComponentAnalysis[]): void => {
  const callSitesByDeclaration = new Map<string | null, JsxExpressionValue[]>();
  for (const analysis of analyses)
    forEachJsxElement(analysis.render, (element) => {
      if (element.tag.kind === "Component")
        appendToGroup(callSitesByDeclaration, element.tag.declaration, element);
    });
  for (const analysis of analyses) {
    const callSites = callSitesByDeclaration.get(analysis.declaration);
    if (!callSites) continue;
    for (const binding of analysis.bindings)
      if (binding.kind === "prop" && binding.domain.kind === "Unknown")
        narrowPropFromCallSites(analysis, binding, callSites);
  }
};
