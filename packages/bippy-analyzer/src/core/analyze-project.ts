import { compileFile } from "./compile.js";
import { CompilerTypeProvider } from "./type-provider.js";
import { DomainResolver } from "./infer-domains.js";
import type { ProjectHook } from "./interpret.js";
import { enumerateStates } from "./enumerate-states.js";
import { getSampleOfValue } from "./infer-domains.js";
import type {
  ComponentAnalysis,
  ContextModels,
  JsxExpressionValue,
  JsxProp,
  PrimitiveSymbolicValue,
  ProjectAnalysis,
  Sample,
  SymbolicValue,
} from "./types.js";
import { forEachJsxElement } from "./utils/traverse.js";
import { getPlaceKey } from "./utils/place-key.js";
import { analyzeComponent } from "./analyze-component.js";
import { collectDisplayNames, collectExportNames } from "./utils/typescript.js";
import { isProjectSourceFile, withProject } from "./utils/with-project.js";

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
    const loadProjectHook = (declarationKey: string): ProjectHook | null =>
      projectHooks.get(declarationKey) ?? null;
    const contexts = fileNames.flatMap((fileName) => {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) return [];
      const resolver = new DomainResolver(project.checker, sourceFile);
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
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
    inferPropsFromCallSites(analyses);
    const components = analyses
      .filter((analysis) => fileFilter === null || analysis.file.includes(fileFilter))
      .map((analysis) => ({ analysis, report: enumerateStates(analysis) }));
    return { components, fileCount: fileNames.length };
  });
