import { compileFile } from "./compile.js";
import { CompilerTypeProvider } from "./type-provider.js";
import { enumerateStates } from "./enumerate-states.js";
import { getSampleOfValue } from "./infer-domains.js";
import type {
  ComponentAnalysis,
  JsxExpressionValue,
  JsxProp,
  PrimitiveSymbolicValue,
  ProjectAnalysis,
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
 * Gives untyped props, as in plain JavaScript, the literal values their call sites pass.
 * A prop is narrowed only when every call site in the project passes a literal for it.
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
      if (!passedValues.every(isPrimitive)) continue;
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
 * Analyzes every component in a TypeScript project: lowers each to HIR, runs the compiler
 * passes and ours, and lists its states.
 */
export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
): ProjectAnalysis =>
  withProject(configPath, (project) => {
    const fileNames = project.program.getSourceFileNames().filter(isProjectSourceFile);
    const analyses: ComponentAnalysis[] = [];
    for (const fileName of fileNames) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const context = {
        sourceFile,
        checker: project.checker,
        compiled: compileFile(fileName, sourceFile.text, {
          typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
        }),
        exportNames: collectExportNames(sourceFile),
        displayNames: collectDisplayNames(sourceFile),
      };
      for (const reactFunction of context.compiled.functions) {
        if (reactFunction.fnType === "Component")
          analyses.push(analyzeComponent(reactFunction, context));
      }
    }
    inferPropsFromCallSites(analyses);
    const components = analyses
      .filter((analysis) => fileFilter === null || analysis.file.includes(fileFilter))
      .map((analysis) => ({ analysis, report: enumerateStates(analysis) }));
    return { components, fileCount: fileNames.length };
  });
