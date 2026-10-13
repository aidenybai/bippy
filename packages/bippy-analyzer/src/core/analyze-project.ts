import { compileFile } from "./compile";
import { CompilerTypeProvider } from "./type-provider";
import { DomainResolver } from "./infer-domains";
import type { ProjectHook } from "./interpret";
import { collectStoreModels } from "./store-models";
import { enumerateStates } from "./enumerate-states";
import { getSampleOfValue } from "./infer-domains";
import { getStringSamples } from "./string-samples";
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
} from "./types";
import { forEachJsxElement } from "./utils/traverse";
import { getBindingPlace } from "./utils/place";
import { analyzeComponent } from "./analyze-component";
import { collectDisplayNames, collectExportNames } from "./utils/typescript";
import { isProjectSourceFile, withProject } from "./utils/with-project";

const ARRAY_MEMBERS = new Set([
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
const SHARED_MEMBERS = new Set(["at", "includes", "indexOf", "length", "slice"]);
const INDEX_PATTERN = /^\d+$/;

const getShapeSample = (name: string, paths: string[][]): Sample => {
  const fields = new Map<string, string[][]>();
  for (const [field, ...rest] of paths)
    if (field !== undefined) fields.set(field, [...(fields.get(field) ?? []), rest]);
  const names = [...fields.keys()];
  if (
    names.length === 0 ||
    names.some((field) => STRING_MEMBERS.has(field)) ||
    names.every((field) => SHARED_MEMBERS.has(field))
  )
    return getStringSamples(name)[0] ?? { kind: "Undefined" };
  if (fields.has("props")) return { kind: "Element" };
  if (names.some((field) => ARRAY_MEMBERS.has(field) || INDEX_PATTERN.test(field))) {
    const itemPaths = names.flatMap((field) =>
      INDEX_PATTERN.test(field) ? (fields.get(field) ?? []) : [],
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

const inferPropShapes = (analysis: ComponentAnalysis): void => {
  const paths = new Map<number, string[][]>();
  for (const { bindingId, path } of analysis.placeDomains.places()) {
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

const inferPropsFromCallSites = (analyses: ComponentAnalysis[]): void => {
  const usages: JsxExpressionValue[] = [];
  for (const analysis of analyses)
    forEachJsxElement(analysis.render, (element) => {
      if (element.tag.kind === "Component") usages.push(element);
    });
  for (const analysis of analyses) {
    const componentUsages = usages.filter(
      (usage) => usage.tag.kind === "Component" && usage.tag.declaration === analysis.declaration,
    );
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
      analysis.placeDomains.set(getBindingPlace(binding), binding.domain);
      analysis.bailouts = analysis.bailouts.filter(
        (bailout) => !(bailout.reason === "untyped-prop" && bailout.loc === binding.loc),
      );
    }
  }
};

const isSamePairing = (left: Map<string, string>, right: Map<string, string>): boolean =>
  left.size === right.size && [...left].every(([setter, state]) => right.get(setter) === state);

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
    if (existing && !isSamePairing(existing, setters)) conflicting.add(contextKey);
    else models.set(contextKey, setters);
  }
  for (const [contextKey, setters] of models)
    if (conflicting.has(contextKey) || setters.size === 0) models.delete(contextKey);
  return models;
};

// HACK: the checker lowercases paths on case-insensitive file systems, so key by the declared file
// name.
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

export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
): ProjectAnalysis =>
  withProject(configPath, (project) => {
    const fileNames = project.program.getSourceFileNames().filter(isProjectSourceFile);
    const { strict, strictNullChecks } = project.compilerOptions;
    const isStrictNullChecks = strictNullChecks ?? strict ?? false;
    const projectHooks = new Map<string, ProjectHook>();
    const storeModels = new Map<string, StoreModel>();
    const loadProjectHook = (declarationKey: string): ProjectHook | null =>
      projectHooks.get(declarationKey) ?? null;
    const contexts = fileNames.flatMap((fileName) => {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) return [];
      const resolver = new DomainResolver(project.checker, sourceFile, isStrictNullChecks);
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
      for (const [storeKey, model] of collectStoreModels(sourceFile))
        storeModels.set(storeKey, model);
      for (const { fnType, hir, name } of compiled.functions)
        if (fnType === "Hook" && hir)
          projectHooks.set(`${sourceFile.path}#${name}`, {
            fn: hir,
            resolver,
            loadModuleFunction: compiled.compileModuleFunction,
          });
      return [
        {
          sourceFile,
          resolver,
          compiled,
          loadProjectHook,
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
    const analyze = (
      { reactFunction, context }: (typeof compiledComponents)[number],
      contextModels: ContextModels,
    ) => analyzeComponent(reactFunction, { ...context, contextModels });
    const initialAnalyses = compiledComponents.map((component) => ({
      component,
      analysis: analyze(component, new Map()),
    }));
    const contextModels = collectContextModels(initialAnalyses.map(({ analysis }) => analysis));
    const analyses = initialAnalyses.map(({ component, analysis }) =>
      analysis.bindings.some((binding) => binding.kind === "context")
        ? analyze(component, contextModels)
        : analysis,
    );
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
