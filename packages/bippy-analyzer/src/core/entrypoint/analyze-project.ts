import { dirname, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import type { Project } from "typescript/unstable/sync";
import { ScopeManager } from "../hir/scope.js";
import { enumerateStates } from "../inference/enumerate-states.js";
import { getSampleOfValue } from "../inference/infer-domains.js";
import type {
  ComponentAnalysis,
  JsxExpressionValue,
  JsxProp,
  PrimitiveSymbolicValue,
  ProjectAnalysis,
  SymbolicValue,
} from "../inference/types.js";
import { forEachJsxElement, getPlaceKey } from "../inference/values.js";
import { analyzeComponent } from "./analyze-component.js";
import { collectDisplayNames, collectExportNames, findReactFunctions } from "./program.js";

const SOURCE_FILE_PATTERN = /\.[jt]sx?$/;

/**
 * Whether a file belongs to the project itself, not to its dependencies or declarations.
 */
export const isProjectSourceFile = (fileName: string): boolean =>
  !fileName.includes(`${sep}node_modules${sep}`) &&
  !fileName.endsWith(".d.ts") &&
  SOURCE_FILE_PATTERN.test(fileName);

/**
 * Opens the TypeScript project for a tsconfig, runs `callback` on it, and closes it.
 */
export const withProject = <Result>(
  configPath: string,
  callback: (project: Project) => Result,
): Result => {
  const api = new API({ cwd: dirname(configPath) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
    return callback(project);
  } finally {
    api.close();
  }
};

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
        scopes: new ScopeManager(sourceFile),
        exportNames: collectExportNames(sourceFile),
        displayNames: collectDisplayNames(sourceFile),
      };
      for (const reactFunction of findReactFunctions(sourceFile)) {
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

const serializeValue = (_key: string, value: unknown): unknown => {
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === "symbol") return "generated";
  return value;
};

export const serializeProjectAnalysis = (analysis: ProjectAnalysis): string =>
  JSON.stringify(analysis.components, serializeValue, 2);
