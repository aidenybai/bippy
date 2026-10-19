import { compileFile } from "./compile";
import type { CompiledFunction } from "./compile";
import { CompilerTypeProvider } from "./type-provider";
import { SourceFileResolver } from "./source-file-resolver";
import type { ProjectHook, ProjectLoaders } from "./interpret";
import type { ModuleFunctionLoader } from "./function-registry";
import { getMutatedParameters } from "./utils/get-mutated-parameters";
import { collectStoreActions } from "./store-actions";
import { enumerateStates } from "./enumerate-states";
import { linkComponents, type ReportLoader } from "./link-components";
import { addSamplesFromReadPaths, inferPropsFromCallSites } from "./infer-props";
import { collectContextSetterFields } from "./context-setter-fields";
import type {
  ComponentAnalysis,
  ContextSetterFields,
  StoreActions,
  ProjectAnalysis,
  StateReport,
} from "./types";
import { analyzeComponent } from "./analyze-component";
import type { FileContext } from "./analyze-component";
import { collectDisplayNames } from "./utils/collect-display-names";
import { collectExportNames } from "./utils/collect-export-names";
import { isProjectSourceFile } from "./utils/is-project-source-file";
import { withProject } from "./utils/with-project";
import type { Project } from "typescript/unstable/sync";
import { createDeclarationKey, parseDeclarationKey } from "./utils/declaration-key";

interface CompiledComponent {
  reactFunction: CompiledFunction;
  fileContext: FileContext;
}

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

const compileProjectFiles = (project: Project, fileNames: string[]): FileContext[] => {
  const { strict, strictNullChecks } = project.compilerOptions;
  const isStrictNullChecks = strictNullChecks ?? strict ?? false;
  const projectHooksByDeclaration = new Map<string, ProjectHook>();
  const projectFunctionsByDeclaration = new Map<string, ProjectHook | null>();
  const loadersByPath = new Map<string, Omit<ProjectHook, "hirFunction">>();
  const lowerersByPath = new Map<string, ModuleFunctionLoader>();
  const mutatedParametersByDeclaration = new Map<string, Set<number>>();
  const actionsByStore = new Map<string, StoreActions>();
  const loadProjectHook = (declarationKey: string): ProjectHook | null =>
    projectHooksByDeclaration.get(declarationKey) ?? null;
  const lowerProjectFunction = (declarationKey: string): ProjectHook | null => {
    const { path, name } = parseDeclarationKey(declarationKey);
    const loader = loadersByPath.get(path);
    const hirFunction = loader?.loadModuleFunction(name) ?? null;
    return loader && hirFunction ? { ...loader, hirFunction } : null;
  };
  const loadProjectFunction = (declarationKey: string): ProjectHook | null => {
    if (!projectFunctionsByDeclaration.has(declarationKey))
      projectFunctionsByDeclaration.set(declarationKey, lowerProjectFunction(declarationKey));
    return projectFunctionsByDeclaration.get(declarationKey) ?? null;
  };
  const summarizeMutatedParameters = (declarationKey: string): Set<number> => {
    const { path, name } = parseDeclarationKey(declarationKey);
    const hirFunction = lowerersByPath.get(path)?.(name);
    return hirFunction ? getMutatedParameters(hirFunction) : new Set();
  };
  const loadMutatedParameters = (declarationKey: string): Set<number> => {
    const cached = mutatedParametersByDeclaration.get(declarationKey);
    if (cached) return cached;
    const mutated = summarizeMutatedParameters(declarationKey);
    mutatedParametersByDeclaration.set(declarationKey, mutated);
    return mutated;
  };
  const projectLoaders: ProjectLoaders = {
    loadProjectHook,
    loadProjectFunction,
    loadMutatedParameters,
  };
  return fileNames.flatMap((fileName): FileContext[] => {
    const sourceFile = project.program.getSourceFile(fileName);
    if (!sourceFile) return [];
    const resolver = new SourceFileResolver(project.checker, sourceFile, isStrictNullChecks);
    const compiled = compileFile(fileName, sourceFile.text, {
      typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
    });
    for (const [storeKey, actions] of collectStoreActions(sourceFile))
      actionsByStore.set(storeKey, actions);
    loadersByPath.set(sourceFile.path, {
      resolver,
      loadModuleFunction: compiled.loadModuleFunction,
    });
    lowerersByPath.set(sourceFile.path, compiled.lowerModuleFunction);
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
        projectLoaders,
        actionsByStore,
        exportNames: collectExportNames(sourceFile),
        displayNames: collectDisplayNames(sourceFile),
      },
    ];
  });
};

const analyzeCompiledComponent = (
  component: CompiledComponent,
  contextSetterFields: ContextSetterFields,
): ComponentAnalysis =>
  analyzeComponent(component.reactFunction, component.fileContext, contextSetterFields);

const analyzeComponents = (fileContexts: FileContext[]): ComponentAnalysis[] => {
  const compiledComponents = fileContexts.flatMap((fileContext) =>
    fileContext.compiled.functions.flatMap((reactFunction): CompiledComponent[] =>
      reactFunction.functionType === "Component" ? [{ reactFunction, fileContext }] : [],
    ),
  );
  const initialAnalyses = compiledComponents.map((component) => ({
    component,
    analysis: analyzeCompiledComponent(component, new Map()),
  }));
  const contextSetterFields = collectContextSetterFields(
    initialAnalyses.map((initial) => initial.analysis),
  );
  const analyses = initialAnalyses.map((initial) =>
    initial.analysis.bindings.some((binding) => binding.kind === "context")
      ? analyzeCompiledComponent(initial.component, contextSetterFields)
      : initial.analysis,
  );
  for (const analysis of analyses) addSamplesFromReadPaths(analysis);
  inferPropsFromCallSites(analyses);
  return analyses;
};

const createReportLoader = (): ReportLoader => {
  const reports = new Map<ComponentAnalysis, StateReport>();
  return (analysis) => {
    const cached = reports.get(analysis);
    if (cached) return cached;
    const report = enumerateStates(analysis);
    reports.set(analysis, report);
    return report;
  };
};

export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
): ProjectAnalysis =>
  withProject(configPath, (project) => {
    const fileNames = project.program.getSourceFileNames().filter(isProjectSourceFile);
    const fileContexts = compileProjectFiles(project, fileNames);
    const fileNamesByPath = new Map(
      fileContexts.map((fileContext) => [
        fileContext.sourceFile.path,
        fileContext.sourceFile.fileName,
      ]),
    );
    const analyses = analyzeComponents(fileContexts).map((analysis) =>
      withContextFileNames(analysis, fileNamesByPath),
    );
    const loadReport = createReportLoader();
    const linked = linkComponents(analyses, loadReport);
    const components = analyses
      .filter((analysis) => fileFilter === null || analysis.file.includes(fileFilter))
      .map((analysis) => ({
        analysis,
        report: loadReport(analysis),
        ...(linked.get(analysis.declaration) ?? { links: [], instances: [] }),
      }));
    return { components, fileCount: fileNames.length };
  });
