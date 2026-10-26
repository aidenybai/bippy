import { compileFile } from "./compile";
import type { CompiledFunction } from "./compile";
import { CompilerTypeProvider } from "./type-provider";
import { SourceFileResolver } from "./source-file-resolver";
import type { ProjectHook, ProjectLoaders, ProjectModuleDeclaration } from "./interpret";
import type { ModuleDeclarationLoader, WrittenImportLoader } from "./module-values";
import type { ModuleFunctionLoader } from "./function-registry";
import { getMutatedParameters } from "./utils/get-mutated-parameters";
import { collectStoreModels } from "./store-actions";
import { enumerateStates } from "./enumerate-states";
import { linkComponents, type ReportLoader } from "./link-components";
import { addSamplesFromReadPaths, inferPropsFromCallSites } from "./infer-props";
import { collectContextSetterFields } from "./context-setter-fields";
import type {
  ComponentAnalysis,
  ContextSetterFields,
  StoreModel,
  ProjectAnalysis,
  StateReport,
} from "./types";
import { analyzeComponent } from "./analyze-component";
import type { FileContext } from "./analyze-component";
import { collectDisplayNames } from "./utils/collect-display-names";
import { collectExportNames } from "./utils/collect-export-names";
import { isProjectSourceFile } from "./utils/is-project-source-file";
import { withProject } from "./utils/with-project";
import { NO_TRACER } from "./tracer";
import type { Tracer } from "./tracer";
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

const compileProjectFiles = (
  project: Project,
  fileNames: string[],
  tracer: Tracer,
): FileContext[] => {
  const { strict, strictNullChecks } = project.compilerOptions;
  const isStrictNullChecks = strictNullChecks ?? strict ?? false;
  const projectHooksByDeclaration = new Map<string, ProjectHook>();
  const projectFunctionsByDeclaration = new Map<string, ProjectHook | null>();
  const loadersByPath = new Map<string, Omit<ProjectHook, "hirFunction">>();
  const declarationLoadersByPath = new Map<string, ModuleDeclarationLoader>();
  const writtenImportLoadersByPath = new Map<string, WrittenImportLoader>();
  const lowerersByPath = new Map<string, ModuleFunctionLoader>();
  const mutatedParametersByDeclaration = new Map<string, Map<number, boolean>>();
  const modelsByStore = new Map<string, StoreModel>();
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
  const summarizeMutatedParameters = (declarationKey: string): Map<number, boolean> => {
    const { path, name } = parseDeclarationKey(declarationKey);
    const hirFunction = lowerersByPath.get(path)?.(name);
    return hirFunction ? getMutatedParameters(hirFunction) : new Map();
  };
  const loadMutatedParameters = (declarationKey: string): Map<number, boolean> => {
    const cached = mutatedParametersByDeclaration.get(declarationKey);
    if (cached) return cached;
    const mutated = summarizeMutatedParameters(declarationKey);
    mutatedParametersByDeclaration.set(declarationKey, mutated);
    return mutated;
  };
  const loadModuleDeclaration = (declarationKey: string): ProjectModuleDeclaration | null => {
    const { path, name } = parseDeclarationKey(declarationKey);
    const resolver = loadersByPath.get(path)?.resolver;
    const declaration = declarationLoadersByPath.get(path)?.(name);
    return resolver && declaration ? { ...declaration, name, resolver } : null;
  };
  const isWrittenImport = (declarationKey: string): boolean => {
    const { path, name } = parseDeclarationKey(declarationKey);
    return writtenImportLoadersByPath.get(path)?.(name) ?? false;
  };
  const projectLoaders: ProjectLoaders = {
    loadProjectHook,
    loadProjectFunction,
    loadMutatedParameters,
    loadModuleDeclaration,
    isWrittenImport,
  };
  return fileNames.flatMap((fileName): FileContext[] => {
    const sourceFile = project.program.getSourceFile(fileName);
    if (!sourceFile) return [];
    const resolver = new SourceFileResolver(project.checker, sourceFile, isStrictNullChecks);
    const compiled = tracer.span("compile", fileName, () =>
      compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      }),
    );
    for (const [storeKey, model] of collectStoreModels(sourceFile))
      modelsByStore.set(storeKey, model);
    loadersByPath.set(sourceFile.path, {
      resolver,
      loadModuleFunction: compiled.loadModuleFunction,
    });
    lowerersByPath.set(sourceFile.path, compiled.lowerModuleFunction);
    declarationLoadersByPath.set(sourceFile.path, compiled.loadModuleDeclaration);
    writtenImportLoadersByPath.set(sourceFile.path, compiled.isWrittenImport);
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
        modelsByStore,
        exportNames: collectExportNames(sourceFile),
        displayNames: collectDisplayNames(sourceFile),
      },
    ];
  });
};

const analyzeCompiledComponent = (
  component: CompiledComponent,
  contextSetterFields: ContextSetterFields,
  tracer: Tracer,
): ComponentAnalysis =>
  tracer.span(
    "interpret",
    component.reactFunction.name,
    () => analyzeComponent(component.reactFunction, component.fileContext, contextSetterFields),
    { file: component.fileContext.sourceFile.fileName },
  );

const analyzeComponents = (fileContexts: FileContext[], tracer: Tracer): ComponentAnalysis[] => {
  const compiledComponents = fileContexts.flatMap((fileContext) =>
    fileContext.compiled.functions.flatMap((reactFunction): CompiledComponent[] =>
      reactFunction.functionType === "Component" ? [{ reactFunction, fileContext }] : [],
    ),
  );
  const initialAnalyses = compiledComponents.map((component) => ({
    component,
    analysis: analyzeCompiledComponent(component, new Map(), tracer),
  }));
  const contextSetterFields = collectContextSetterFields(
    initialAnalyses.map((initial) => initial.analysis),
  );
  const analyses = initialAnalyses.map((initial) =>
    initial.analysis.bindings.some((binding) => binding.kind === "context")
      ? analyzeCompiledComponent(initial.component, contextSetterFields, tracer)
      : initial.analysis,
  );
  tracer.span("props", "infer props", () => {
    for (const analysis of analyses) addSamplesFromReadPaths(analysis);
    inferPropsFromCallSites(analyses);
  });
  return analyses;
};

const createReportLoader = (tracer: Tracer): ReportLoader => {
  const reports = new Map<ComponentAnalysis, StateReport>();
  return (analysis) => {
    const cached = reports.get(analysis);
    if (cached) return cached;
    const report = tracer.span("enumerate", analysis.name, () => enumerateStates(analysis), {
      file: analysis.file,
    });
    reports.set(analysis, report);
    return report;
  };
};

export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
  tracer: Tracer = NO_TRACER,
): ProjectAnalysis =>
  withProject(
    configPath,
    (project) => {
      const fileNames = project.program.getSourceFileNames().filter(isProjectSourceFile);
      const fileContexts = compileProjectFiles(project, fileNames, tracer);
      const fileNamesByPath = new Map(
        fileContexts.map((fileContext) => [
          fileContext.sourceFile.path,
          fileContext.sourceFile.fileName,
        ]),
      );
      const analyses = analyzeComponents(fileContexts, tracer).map((analysis) =>
        withContextFileNames(analysis, fileNamesByPath),
      );
      const isSelected = (analysis: ComponentAnalysis): boolean =>
        fileFilter === null || analysis.file.includes(fileFilter);
      const loadReport = createReportLoader(tracer);
      const linked = tracer.span("link", "link components", () =>
        linkComponents(analyses, loadReport, isSelected),
      );
      const components = analyses.filter(isSelected).map((analysis) => ({
        analysis,
        report: loadReport(analysis),
        ...(linked.get(analysis.declaration) ?? { links: [], instances: [] }),
      }));
      return { components, fileCount: fileNames.length };
    },
    tracer,
  );
