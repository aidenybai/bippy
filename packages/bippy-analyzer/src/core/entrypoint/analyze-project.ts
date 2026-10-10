import { dirname, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import { ScopeManager } from "../hir/scope.js";
import { enumerateStates } from "../inference/enumerate-states.js";
import { getSampleOfValue } from "../inference/infer-domains.js";
import type {
  AbstractValue,
  ComponentAnalysis,
  JsxProp,
  JsxSpreadProp,
  ProjectAnalysis,
  SymbolicValue,
} from "../inference/types.js";
import { getPlaceKey } from "../inference/values.js";
import { analyzeComponent } from "./analyze-component.js";
import { collectDisplayNames, collectExportNames, findReactFunctions } from "./program.js";

const SOURCE_FILE_PATTERN = /\.[jt]sx?$/;

interface ComponentUsage {
  tag: string;
  props: Array<JsxProp | JsxSpreadProp>;
}

const isProjectSourceFile = (fileName: string): boolean =>
  !fileName.includes(`${sep}node_modules${sep}`) &&
  !fileName.endsWith(".d.ts") &&
  SOURCE_FILE_PATTERN.test(fileName);

const collectUsages = (value: SymbolicValue, usages: ComponentUsage[]): void => {
  switch (value.kind) {
    case "JsxExpression":
      if (value.tag.kind === "Component") usages.push({ tag: value.tag.name, props: value.props });
      for (const child of value.children) collectUsages(child, usages);
      return;
    case "JsxFragment":
      for (const child of value.children) collectUsages(child, usages);
      return;
    case "Conditional":
      collectUsages(value.consequent, usages);
      collectUsages(value.alternate, usages);
      return;
    case "ArrayMap":
      collectUsages(value.item, usages);
      return;
    default:
      return;
  }
};

/**
 * Gives untyped props, as in plain JavaScript, the literal values their call sites pass.
 * A prop is narrowed only when every call site in the project passes a literal for it.
 */
const inferPropsFromCallSites = (analyses: ComponentAnalysis[]): void => {
  const usages: ComponentUsage[] = [];
  for (const analysis of analyses) collectUsages(analysis.render, usages);
  for (const analysis of analyses) {
    const componentUsages = usages.filter((usage) => usage.tag === analysis.name);
    if (componentUsages.length === 0) continue;
    for (const binding of analysis.bindings) {
      if (binding.kind !== "prop" || binding.domain.kind !== "Unknown") continue;
      const literals = componentUsages.map((usage) => {
        const prop = usage.props.find(
          (candidate): candidate is JsxProp =>
            candidate.kind === "JsxAttribute" && candidate.name === binding.propName,
        );
        return prop?.value.kind === "Primitive" ? prop.value : null;
      });
      if (literals.some((literal) => literal === null)) continue;
      const cases = [
        ...new Map(
          literals
            .flatMap((literal): AbstractValue[] =>
              literal ? [{ kind: "Literal", value: literal.value }] : [],
            )
            .map((value) => [JSON.stringify(value), value]),
        ).values(),
      ];
      binding.domain = { kind: "Cases", cases, origin: "call-sites" };
      binding.samples = cases.flatMap((value) =>
        value.kind === "Literal" ? [getSampleOfValue(value.value)] : [],
      );
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
): ProjectAnalysis => {
  const api = new API({ cwd: dirname(configPath) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
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
  } finally {
    api.close();
  }
};

const serializeValue = (_key: string, value: unknown): unknown => {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  if (typeof value === "symbol") return "generated";
  return value;
};

export const serializeProjectAnalysis = (analysis: ProjectAnalysis): string =>
  JSON.stringify(analysis.components, serializeValue, 2);
