import { compileFile } from "../compile/compile";
import type { CompiledFunction } from "../compile/compile";
import { CompilerTypeProvider } from "../type-checker/type-provider";
import { SourceFileResolver } from "../type-checker/source-file-resolver";
import type { ProjectHook, ProjectLoaders, ProjectModuleDeclaration } from "../interpret/interpret";
import type {
  ImportUse,
  ImportUseLoader,
  ImportedNames,
  ModuleDeclarationLoader,
} from "../compile/module-values";
import type { ModuleFunctionLoader } from "../compile/function-registry";
import type { HIRFunction } from "../../react-compiler/HIR/HIR";
import { getMutatedParameters } from "./get-mutated-parameters";
import { collectStoreModels } from "../interpret/store-actions";
import { enumerateStates } from "../states/enumerate-states";
import { linkComponents, type ReportLoader } from "../linking/link-components";
import { addSamplesFromReadPaths, inferPropsFromCallSites } from "../linking/infer-props";
import { collectContextSetterFields } from "../interpret/context-setter-fields";
import type {
  ComponentAnalysis,
  ContextSetterFields,
  SymbolicValue,
  StoreModel,
  ProjectAnalysis,
} from "../types";
import { analyzeComponent } from "./analyze-component";
import type { FileContext } from "./analyze-component";
import { collectDisplayNames } from "./collect-display-names";
import { collectExportNames } from "./collect-export-names";
import { isProjectSourceFile } from "./is-project-source-file";
import { withProject } from "./with-project";
import { NO_TRACER } from "./tracer";
import type { Tracer } from "./tracer";
import type { Project } from "typescript/unstable/sync";
import { createDeclarationKey, parseDeclarationKey } from "./declaration-key";
import { createImportIndex } from "./create-import-index";
import type { ImportIndex } from "./create-import-index";
import {
  ALL_HELD_PROPS,
  ALL_PROPS,
  NO_HELD_PROPS,
  getPropHolds,
  isPropHeld,
  isSpreadHeld,
} from "../interpret/get-prop-holds";
import type { HeldProps } from "../interpret/get-prop-holds";
import { memoizeByIdentity } from "../shared/memoize-by-identity";

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
  const componentsByDeclaration = new Map<string, HIRFunction>();
  const comparedDeclarations = new Set<string>();
  const heldNamesByDeclaration = new Map<string, ReadonlySet<string>>();
  const heldPropsByDeclaration = new Map<string, HeldProps>();
  const loadersByPath = new Map<string, Omit<ProjectHook, "hirFunction">>();
  const declarationLoadersByPath = new Map<string, ModuleDeclarationLoader>();
  const importUseLoadersByPath = new Map<string, ImportUseLoader>();
  const importedNamesByPath = new Map<string, ImportedNames>();
  const readOnlyByDeclaration = new Map<string, boolean>();
  let importIndex: ImportIndex | null = null;
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
  const getContextLocs = (declarationKey: string): ReadonlyMap<string, unknown> => {
    const hirFunction = componentsByDeclaration.get(declarationKey);
    return hirFunction ? getPropHolds(hirFunction).contextLocs : new Map();
  };
  const toHeldProps = (declarationKey: string, names: ReadonlySet<string>): HeldProps => {
    if (names.has(ALL_PROPS)) return ALL_HELD_PROPS;
    const contextLocs = getContextLocs(declarationKey);
    return { kind: "Some", names: new Set([...names].filter((name) => !contextLocs.has(name))) };
  };
  const getHeldNames = (declarationKey: string, visited: Set<string>): ReadonlySet<string> => {
    if (comparedDeclarations.has(declarationKey)) return new Set([ALL_PROPS]);
    const hirFunction = componentsByDeclaration.get(declarationKey);
    if (!hirFunction || visited.has(declarationKey)) return new Set();
    visited.add(declarationKey);
    const holds = getPropHolds(hirFunction);
    const resolver = loadersByPath.get(parseDeclarationKey(declarationKey).path)?.resolver;
    const forwarded = holds.forwards.filter((forward) => {
      const tagKey = resolver?.getDeclarationKey(forward.tagLoc);
      const tagHeld = tagKey ? toHeldProps(tagKey, getHeldNames(tagKey, visited)) : NO_HELD_PROPS;
      return forward.attribute === ALL_PROPS
        ? isSpreadHeld(tagHeld)
        : isPropHeld(tagHeld, forward.attribute);
    });
    return new Set([...holds.held, ...forwarded.map((forward) => forward.name)]);
  };
  const loadHeldNames = (declarationKey: string): ReadonlySet<string> => {
    const cached = heldNamesByDeclaration.get(declarationKey);
    if (cached) return cached;
    const held = getHeldNames(declarationKey, new Set());
    heldNamesByDeclaration.set(declarationKey, held);
    return held;
  };
  const loadHeldProps = (declarationKey: string): HeldProps => {
    const cached = heldPropsByDeclaration.get(declarationKey);
    if (cached) return cached;
    const heldProps = toHeldProps(declarationKey, loadHeldNames(declarationKey));
    heldPropsByDeclaration.set(declarationKey, heldProps);
    return heldProps;
  };
  const getHeldContexts = (): ReadonlySet<string> =>
    new Set(
      [...componentsByDeclaration].flatMap(([declarationKey, hirFunction]) => {
        const resolver = loadersByPath.get(parseDeclarationKey(declarationKey).path)?.resolver;
        const contextLocs = getPropHolds(hirFunction).contextLocs;
        return [...loadHeldNames(declarationKey)].flatMap((name) => {
          const loc = contextLocs.get(name);
          return (loc && resolver?.getDeclarationKey(loc)) || [];
        });
      }),
    );
  let heldContexts: ReadonlySet<string> | null = null;
  const loadHeldContexts = (): ReadonlySet<string> => (heldContexts ??= getHeldContexts());
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
  const loadImportUse = (declarationKey: string): ImportUse => {
    const { path, name } = parseDeclarationKey(declarationKey);
    return importUseLoadersByPath.get(path)?.(name) ?? "read";
  };
  const getImportIndex = (): ImportIndex => {
    importIndex ??= createImportIndex(
      importedNamesByPath,
      (path) => loadersByPath.get(path)?.resolver,
    );
    return importIndex;
  };
  const isImportedReadOnly = (declarationKey: string, value: SymbolicValue): boolean =>
    (getImportIndex().importers.get(declarationKey) ?? []).every(
      ({ path, localName }) => importedNamesByPath.get(path)?.isReadOnly(localName, value) ?? false,
    );
  const isReadOnlyDeclaration = (declarationKey: string): boolean => {
    const cached = readOnlyByDeclaration.get(declarationKey);
    if (cached !== undefined) return cached;
    const { path, name } = parseDeclarationKey(declarationKey);
    const declaration = declarationLoadersByPath.get(path)?.(name);
    const isReadOnly =
      declaration?.isReadOnly === true &&
      declaration.initial !== null &&
      !getImportIndex().exposedPaths.has(path) &&
      isImportedReadOnly(declarationKey, declaration.initial);
    readOnlyByDeclaration.set(declarationKey, isReadOnly);
    return isReadOnly;
  };
  const projectLoaders: ProjectLoaders = {
    loadProjectHook,
    loadProjectFunction,
    loadProjectComponent: (declarationKey) => componentsByDeclaration.get(declarationKey) ?? null,
    loadHeldProps,
    loadHeldContexts,
    loadMutatedParameters,
    loadModuleDeclaration,
    loadImportUse,
    isReadOnlyDeclaration,
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
    importUseLoadersByPath.set(sourceFile.path, compiled.loadImportUse);
    const exportNames = collectExportNames(sourceFile);
    for (const name of compiled.comparedComponents)
      for (const key of new Set([name, exportNames.get(name) ?? name]))
        comparedDeclarations.add(createDeclarationKey(sourceFile.path, key));
    for (const { functionType, hir, name } of compiled.functions)
      if (functionType === "Component" && hir)
        for (const key of new Set([name, exportNames.get(name) ?? name]))
          componentsByDeclaration.set(createDeclarationKey(sourceFile.path, key), hir);
    importedNamesByPath.set(sourceFile.path, compiled.importedNames);
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
        exportNames,
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
    initial.analysis.readContextKeys.some((contextKey) => contextSetterFields.has(contextKey))
      ? analyzeCompiledComponent(initial.component, contextSetterFields, tracer)
      : initial.analysis,
  );
  tracer.span("props", "infer props", () => {
    for (const analysis of analyses) addSamplesFromReadPaths(analysis);
    inferPropsFromCallSites(analyses);
  });
  return analyses;
};

const createReportLoader = (tracer: Tracer): ReportLoader =>
  memoizeByIdentity((analysis: ComponentAnalysis) =>
    tracer.span("enumerate", analysis.name, () => enumerateStates(analysis), {
      file: analysis.file,
    }),
  );

export interface InterpretedProject {
  analyses: ComponentAnalysis[];
  fileCount: number;
  unparsedFiles: string[];
}

export const interpretProject = (
  configPath: string,
  tracer: Tracer = NO_TRACER,
): InterpretedProject =>
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
      const unparsedFiles = fileContexts.flatMap(({ compiled, sourceFile }) =>
        compiled.parseError === null ? [] : [sourceFile.fileName],
      );
      return { analyses, fileCount: fileNames.length, unparsedFiles };
    },
    tracer,
  );

export const reportProject = (
  { analyses, fileCount, unparsedFiles }: InterpretedProject,
  fileFilter: string | null = null,
  tracer: Tracer = NO_TRACER,
): ProjectAnalysis => {
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
  return { components, fileCount, unparsedFiles };
};

export const analyzeProject = (
  configPath: string,
  fileFilter: string | null = null,
  tracer: Tracer = NO_TRACER,
): ProjectAnalysis => reportProject(interpretProject(configPath, tracer), fileFilter, tracer);
