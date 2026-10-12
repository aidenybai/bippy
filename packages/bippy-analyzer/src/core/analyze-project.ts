import { compileFile } from "./compile.js";
import { CompilerTypeProvider } from "./type-provider.js";
import { DomainResolver } from "./infer-domains.js";
import type { ProjectHook } from "./interpret.js";
import { collectStoreModels } from "./store-models.js";
import { enumerateStates } from "./enumerate-states.js";
import { getSampleOfValue, getStringSamples } from "./infer-domains.js";
import type {
  ComponentAnalysis,
  ContextModels,
  StoreModel,
  JsxExpressionValue,
  JsxProp,
  PrimitiveSymbolicValue,
  ProjectAnalysis,
  Sample,
  SymbolicValue,
} from "./types.js";
import { forEachJsxElement } from "./utils/traverse.js";
import { getPlaceKey, parsePlaceKey } from "./utils/place-key.js";
import { analyzeComponent } from "./analyze-component.js";
import { collectDisplayNames, collectExportNames } from "./utils/typescript.js";
import { isProjectSourceFile, withProject } from "./utils/with-project.js";

const ARRAY_MEMBERS = new Set([
  "at",
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "length",
  "map",
  "reduce",
  "slice",
  "some",
  "sort",
]);
const STRING_MEMBERS = new Set([
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
const INDEX_PATTERN = /^\d+$/;

/**
 * A sample of an untyped value named `name`, shaped by the paths a component reads from it,
 * like `{ guests: { fullName: "text" } }` for `booking.guests.fullName`. A value read with an
 * array's member or an index, like `bookings.reduce` or `items[0]`, is an array, one read
 * through `props`, like `children.props.id`, is an element, and a string, read with no
 * member or a string's own, like `status.replace`, is one its name suggests, like a date for
 * `startDate`.
 */
const getShapeSample = (name: string, paths: string[][]): Sample => {
  const fields = new Map<string, string[][]>();
  for (const [field, ...rest] of paths)
    if (field !== undefined) fields.set(field, [...(fields.get(field) ?? []), rest]);
  const names = [...fields.keys()];
  if (names.length === 0 || names.some((field) => STRING_MEMBERS.has(field)))
    return getStringSamples(name)[0] ?? { kind: "Undefined" };
  if (fields.has("props")) return { kind: "Element" };
  if (names.some((name) => ARRAY_MEMBERS.has(name) || INDEX_PATTERN.test(name))) {
    const itemPaths = names.flatMap((name) =>
      INDEX_PATTERN.test(name) ? (fields.get(name) ?? []) : [],
    );
    return { kind: "Array", items: itemPaths.length > 0 ? [getShapeSample(name, itemPaths)] : [] };
  }
  return {
    kind: "Object",
    fields: Object.fromEntries(
      [...fields].map(([field, rest]) => [
        field,
        getShapeSample(
          field,
          rest.filter((path) => path.length > 0),
        ),
      ]),
    ),
    isOpen: false,
  };
};

/**
 * Gives an untyped prop, as in plain JavaScript, a sample shaped by what the component reads
 * from it, to mount with before the literals its call sites pass, and an untyped context a
 * sample its provider mounts with.
 */
const inferPropShapes = (analysis: ComponentAnalysis): void => {
  const paths = new Map<number, string[][]>();
  for (const placeKey of analysis.placeDomains.keys()) {
    const { bindingId, path } = parsePlaceKey(placeKey);
    if (path.length > 0) paths.set(bindingId, [...(paths.get(bindingId) ?? []), path]);
  }
  for (const binding of analysis.bindings) {
    const bindingPaths = paths.get(binding.id);
    if (binding.kind !== "prop" || binding.domain.kind !== "Unknown" || !bindingPaths) continue;
    binding.samples = [
      getShapeSample(binding.propName ?? binding.name, bindingPaths),
      ...binding.samples,
    ];
  }
  for (const [contextKey, bindingId] of analysis.untypedContexts) {
    const bindingPaths = paths.get(bindingId);
    if (bindingPaths) analysis.contextSamples.set(contextKey, getShapeSample("", bindingPaths));
  }
};

const isPrimitive = (value: SymbolicValue | undefined): value is PrimitiveSymbolicValue =>
  value?.kind === "Primitive";

/**
 * A literal a call site passes, as a sample, like the options array of a `<Select>`. Null
 * when any part of it is computed.
 */
const getLiteralSample = (value: SymbolicValue | undefined): Sample | null => {
  if (value?.kind === "Primitive") return getSampleOfValue(value.value);
  if (value?.kind === "ArrayExpression" && value.spreads.length === 0) {
    const items = value.elements.flatMap((element): Sample[] => {
      const sample = getLiteralSample(element);
      return sample ? [sample] : [];
    });
    return items.length === value.elements.length ? { kind: "Array", items } : null;
  }
  if (value?.kind === "ObjectExpression" && value.spreads.length === 0) {
    const fields = value.properties.flatMap(({ key, value: field }): Array<[string, Sample]> => {
      const sample = getLiteralSample(field);
      return sample ? [[key, sample]] : [];
    });
    return fields.length === value.properties.length
      ? { kind: "Object", fields: Object.fromEntries(fields), isOpen: false }
      : null;
  }
  return null;
};

/**
 * Gives untyped props, as in plain JavaScript, the literal values their call sites pass.
 * A prop is narrowed only when every call site in the project passes a primitive literal
 * for it. Otherwise the literals some call sites pass, like arrays of options, are only
 * samples to mount it with.
 */
const inferPropsFromCallSites = (analyses: ComponentAnalysis[]): void => {
  const usages: JsxExpressionValue[] = [];
  for (const analysis of analyses)
    forEachJsxElement(analysis.render, (element) => {
      if (element.tag.kind === "Component") usages.push(element);
    });
  for (const analysis of analyses) {
    const componentUsages = usages.filter((usage) => usage.tag.name === analysis.name);
    if (componentUsages.length === 0) continue;
    for (const binding of analysis.bindings) {
      if (binding.kind !== "prop" || binding.domain.kind !== "Unknown") continue;
      const passedValues = componentUsages.map(
        (usage) =>
          usage.props.find(
            (candidate): candidate is JsxProp =>
              candidate.kind === "JsxAttribute" && candidate.name === binding.propName,
          )?.value,
      );
      if (!passedValues.every(isPrimitive)) {
        const literalSamples = new Map(
          passedValues.flatMap((passedValue): Array<[string, Sample]> => {
            const sample = getLiteralSample(passedValue);
            return sample ? [[JSON.stringify(sample), sample]] : [];
          }),
        );
        binding.samples = [...literalSamples.values(), ...binding.samples];
        continue;
      }
      const literals = [...new Set(passedValues.map((passedValue) => passedValue.value))];
      binding.domain = {
        kind: "Cases",
        cases: literals.map((value) => ({ kind: "Literal", value })),
        origin: "call-sites",
      };
      binding.samples = literals.map(getSampleOfValue);
      analysis.placeDomains.set(getPlaceKey(binding, []), binding.domain);
      analysis.bailouts = analysis.bailouts.filter(
        (bailout) => !(bailout.reason === "untyped-prop" && bailout.message === binding.name),
      );
    }
  }
};

/**
 * The setters each context's providers put in it, paired with the state fields they set,
 * like `setOpen` with `open` in `value={{ open, setOpen }}`. A context provided with
 * different pairings in different places has none.
 */
const collectContextModels = (analyses: ComponentAnalysis[]): ContextModels => {
  const models: ContextModels = new Map();
  const conflicting = new Set<string>();
  for (const { contextKey, value } of analyses.flatMap((analysis) => analysis.providedContexts)) {
    if (value.kind !== "ObjectExpression") continue;
    const setters = new Map<string, string>();
    for (const property of value.properties) {
      if (property.value.kind !== "Setter") continue;
      const { binding } = property.value;
      const state = value.properties.find(
        (candidate) =>
          candidate.value.kind === "Binding" &&
          candidate.value.binding === binding &&
          candidate.value.path.length === 0,
      );
      if (state) setters.set(property.key, state.key);
    }
    const existing = models.get(contextKey);
    if (existing && JSON.stringify([...existing]) !== JSON.stringify([...setters]))
      conflicting.add(contextKey);
    else if (setters.size > 0) models.set(contextKey, setters);
  }
  for (const contextKey of conflicting) models.delete(contextKey);
  return models;
};

/**
 * Keys a component's context samples by the file name a context is declared in, as a test
 * imports it, rather than the checker's path, which is lowercase where file names ignore case.
 */
const withContextFileNames = (
  analysis: ComponentAnalysis,
  fileNames: Map<string, string>,
): ComponentAnalysis => ({
  ...analysis,
  contextSamples: new Map(
    [...analysis.contextSamples].map(([contextKey, sample]) => {
      const [path = "", name = ""] = contextKey.split("#");
      return [`${fileNames.get(path) ?? path}#${name}`, sample];
    }),
  ),
});

/**
 * Analyzes every component in a TypeScript project: lowers each to HIR, runs the compiler
 * passes and ours, and lists its states.
 */
export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
): ProjectAnalysis =>
  withProject(configPath, (project) => {
    const fileNames = project.program.getSourceFileNames().filter(isProjectSourceFile);
    const projectHooks = new Map<string, ProjectHook>();
    const contextModels: ContextModels = new Map();
    const storeModels = new Map<string, StoreModel>();
    const loadProjectHook = (declarationKey: string): ProjectHook | null =>
      projectHooks.get(declarationKey) ?? null;
    const contexts = fileNames.flatMap((fileName) => {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) return [];
      const resolver = new DomainResolver(project.checker, sourceFile);
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
      for (const [storeKey, model] of collectStoreModels(sourceFile))
        storeModels.set(storeKey, model);
      for (const { fnType, hir, name } of compiled.functions)
        if (fnType === "Hook" && hir)
          projectHooks.set(`${sourceFile.path}#${name}`, { fn: hir, resolver });
      return [
        {
          sourceFile,
          resolver,
          compiled,
          loadProjectHook,
          contextModels,
          storeModels,
          exportNames: collectExportNames(sourceFile),
          displayNames: collectDisplayNames(sourceFile),
        },
      ];
    });
    const compiledComponents = contexts.flatMap((context) =>
      context.compiled.functions.flatMap((reactFunction) =>
        reactFunction.fnType === "Component" ? [{ reactFunction, context }] : [],
      ),
    );
    const firstAnalyses = compiledComponents.map(({ reactFunction, context }) =>
      analyzeComponent(reactFunction, context),
    );
    for (const [contextKey, setters] of collectContextModels(firstAnalyses))
      contextModels.set(contextKey, setters);
    const analyses = firstAnalyses.map((analysis, index) => {
      const compiled = compiledComponents[index];
      return compiled && analysis.bindings.some((binding) => binding.kind === "context")
        ? analyzeComponent(compiled.reactFunction, compiled.context)
        : analysis;
    });
    for (const analysis of analyses) inferPropShapes(analysis);
    inferPropsFromCallSites(analyses);
    const fileNamesByPath = new Map(
      contexts.map(({ sourceFile }) => [sourceFile.path, sourceFile.fileName]),
    );
    const components = analyses
      .filter((analysis) => fileFilter === null || analysis.file.includes(fileFilter))
      .map((analysis) => withContextFileNames(analysis, fileNamesByPath))
      .map((analysis) => ({ analysis, report: enumerateStates(analysis) }));
    return { components, fileCount: fileNames.length };
  });
