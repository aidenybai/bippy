import { compileFile } from "./compile";
import type { CompiledFunction } from "./compile";
import { CompilerTypeProvider } from "./type-provider";
import { DomainResolver } from "./infer-domains";
import type { ProjectHook } from "./interpret";
import { collectStoreActions } from "./store-actions";
import { enumerateStates } from "./enumerate-states";
import { dedupeSamples, getSampleOfValue } from "./infer-domains";
import { getStringSamples } from "./string-samples";
import type {
  ComponentAnalysis,
  ContextSetterFields,
  StoreActions,
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
import type { FileContext } from "./analyze-component";
import { collectDisplayNames, collectExportNames } from "./utils/typescript";
import { isProjectSourceFile, withProject } from "./utils/with-project";
import { createDeclarationKey, parseDeclarationKey } from "./utils/declaration-key";

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

interface CompiledComponent {
  reactFunction: CompiledFunction;
  fileContext: Omit<FileContext, "contextSetterFields">;
}

const inferSampleFromReadPaths = (name: string, readPaths: string[][]): Sample => {
  const restPathsByField = new Map<string, string[][]>();
  for (const [field, ...restPath] of readPaths)
    if (field !== undefined)
      restPathsByField.set(field, [...(restPathsByField.get(field) ?? []), restPath]);
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

const addSamplesFromReadPaths = (analysis: ComponentAnalysis): void => {
  const readPathsByBinding = new Map<number, string[][]>();
  for (const { bindingId, path } of analysis.placeDomains.places()) {
    if (path.length > 0)
      readPathsByBinding.set(bindingId, [...(readPathsByBinding.get(bindingId) ?? []), path]);
  }
  for (const binding of analysis.bindings) {
    const readPaths = readPathsByBinding.get(binding.id);
    if (binding.kind !== "prop" || binding.domain.kind !== "Unknown" || !readPaths) continue;
    binding.samples = [
      inferSampleFromReadPaths(binding.propName ?? binding.name, readPaths),
      ...binding.samples,
    ];
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

const inferPropsFromCallSites = (analyses: ComponentAnalysis[]): void => {
  const componentElements: JsxExpressionValue[] = [];
  for (const analysis of analyses)
    forEachJsxElement(analysis.render, (element) => {
      if (element.tag.kind === "Component") componentElements.push(element);
    });
  for (const analysis of analyses) {
    const callSites = componentElements.filter(
      (element) =>
        element.tag.kind === "Component" && element.tag.declaration === analysis.declaration,
    );
    if (callSites.length === 0) continue;
    for (const binding of analysis.bindings) {
      if (binding.kind !== "prop" || binding.domain.kind !== "Unknown") continue;
      const passedValues = callSites.map(
        (callSite) =>
          callSite.props.find(
            (prop): prop is JsxProp =>
              prop.kind === "JsxAttribute" && prop.name === binding.propName,
          )?.value,
      );
      if (!passedValues.every(isPrimitive)) {
        const literalSamples = passedValues.flatMap(
          (passedValue) => getLiteralSample(passedValue) ?? [],
        );
        binding.samples = [...dedupeSamples(literalSamples), ...binding.samples];
        continue;
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
    }
  }
};

const isSameSetterFields = (left: Map<string, string>, right: Map<string, string>): boolean =>
  left.size === right.size &&
  [...left].every(([setterName, stateField]) => right.get(setterName) === stateField);

const collectContextSetterFields = (analyses: ComponentAnalysis[]): ContextSetterFields => {
  const setterFieldsByContext: ContextSetterFields = new Map();
  const conflictingContextKeys = new Set<string>();
  const providedContexts = analyses.flatMap((analysis) => analysis.providedContexts);
  for (const { contextKey, value } of providedContexts) {
    if (value.kind !== "ObjectExpression") continue;
    const setterFields = new Map<string, string>();
    for (const property of value.properties) {
      if (property.value.kind !== "Setter") continue;
      const { binding } = property.value;
      const stateProperty = value.properties.find(
        (candidate) =>
          candidate.value.kind === "Binding" &&
          candidate.value.binding === binding &&
          candidate.value.path.length === 0,
      );
      if (stateProperty) setterFields.set(property.key, stateProperty.key);
    }
    const existingSetterFields = setterFieldsByContext.get(contextKey);
    if (existingSetterFields && !isSameSetterFields(existingSetterFields, setterFields))
      conflictingContextKeys.add(contextKey);
    else setterFieldsByContext.set(contextKey, setterFields);
  }
  for (const [contextKey, setterFields] of setterFieldsByContext)
    if (conflictingContextKeys.has(contextKey) || setterFields.size === 0)
      setterFieldsByContext.delete(contextKey);
  return setterFieldsByContext;
};

// HACK: the checker lowercases paths on case-insensitive file systems, so key by the declared file
// name.
const withContextFileNames = (
  analysis: ComponentAnalysis,
  fileNamesByPath: Map<string, string>,
): ComponentAnalysis => ({
  ...analysis,
  contextSamples: new Map(
    [...analysis.contextSamples].map(([contextKey, contextSample]) => {
      const { path, name } = parseDeclarationKey(contextKey);
      return [createDeclarationKey(fileNamesByPath.get(path) ?? path, name), contextSample];
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
    const projectHooksByDeclaration = new Map<string, ProjectHook>();
    const actionsByStore = new Map<string, StoreActions>();
    const loadProjectHook = (declarationKey: string): ProjectHook | null =>
      projectHooksByDeclaration.get(declarationKey) ?? null;
    const fileContexts = fileNames.flatMap((fileName) => {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) return [];
      const resolver = new DomainResolver(project.checker, sourceFile, isStrictNullChecks);
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
      for (const [storeKey, actions] of collectStoreActions(sourceFile))
        actionsByStore.set(storeKey, actions);
      for (const { functionType, hir, name } of compiled.functions)
        if (functionType === "Hook" && hir)
          projectHooksByDeclaration.set(createDeclarationKey(sourceFile.path, name), {
            hirFunction: hir,
            resolver,
            loadModuleFunction: compiled.loadModuleFunction,
          });
      return [
        {
          sourceFile,
          resolver,
          compiled,
          loadProjectHook,
          actionsByStore,
          exportNames: collectExportNames(sourceFile),
          displayNames: collectDisplayNames(sourceFile),
        },
      ];
    });
    const compiledComponents = fileContexts.flatMap((fileContext) =>
      fileContext.compiled.functions.flatMap((reactFunction): CompiledComponent[] =>
        reactFunction.functionType === "Component" ? [{ reactFunction, fileContext }] : [],
      ),
    );
    const analyzeCompiledComponent = (
      { reactFunction, fileContext }: CompiledComponent,
      contextSetterFields: ContextSetterFields,
    ): ComponentAnalysis =>
      analyzeComponent(reactFunction, { ...fileContext, contextSetterFields });
    const initialAnalyses = compiledComponents.map((component) => ({
      component,
      analysis: analyzeCompiledComponent(component, new Map()),
    }));
    const contextSetterFields = collectContextSetterFields(
      initialAnalyses.map(({ analysis }) => analysis),
    );
    const analyses = initialAnalyses.map(({ component, analysis }) =>
      analysis.bindings.some((binding) => binding.kind === "context")
        ? analyzeCompiledComponent(component, contextSetterFields)
        : analysis,
    );
    for (const analysis of analyses) addSamplesFromReadPaths(analysis);
    inferPropsFromCallSites(analyses);
    const fileNamesByPath = new Map(
      fileContexts.map(({ sourceFile }) => [sourceFile.path, sourceFile.fileName]),
    );
    const components = analyses
      .filter((analysis) => fileFilter === null || analysis.file.includes(fileFilter))
      .map((analysis) => withContextFileNames(analysis, fileNamesByPath))
      .map((analysis) => ({ analysis, report: enumerateStates(analysis) }));
    return { components, fileCount: fileNames.length };
  });
