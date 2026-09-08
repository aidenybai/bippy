import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";

export type ProgramVariant = "full" | "reachable" | "language-service";

export const PROGRAM_VARIANTS: ProgramVariant[] = ["full", "reachable", "language-service"];

export interface LoadedTsconfig {
  tsconfigPath: string;
  options: ts.CompilerOptions;
  fileNames: string[];
  configErrors: string[];
}

export interface SourceFileCounts {
  total: number;
  project: number;
  nodeModules: number;
  declarations: number;
  lib: number;
}

export interface ProgramBuild {
  program: ts.Program;
  checker: ts.TypeChecker;
  rootNames: string[];
  createProgramMs: number;
  createCheckerMs: number;
  counts: SourceFileCounts;
}

export interface Timed<Result> {
  result: Result;
  elapsedMs: number;
}

export const timeSync = <Result>(run: () => Result): Timed<Result> => {
  const startedAt = performance.now();
  const result = run();
  return { result, elapsedMs: performance.now() - startedAt };
};

export const loadTsconfig = (tsconfigPath: string): LoadedTsconfig => {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const configErrors: string[] = [];
  if (configFile.error)
    configErrors.push(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config ?? {},
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  for (const diagnostic of parsed.errors) {
    configErrors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }
  return {
    tsconfigPath,
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
    fileNames: parsed.fileNames,
    configErrors,
  };
};

export const isLibFile = (fileName: string): boolean =>
  /\/typescript\/lib\/lib\..*\.d\.ts$/.test(fileName);

export const isNodeModulesFile = (fileName: string): boolean => fileName.includes("/node_modules/");

export const countSourceFiles = (program: ts.Program): SourceFileCounts => {
  const counts: SourceFileCounts = {
    total: 0,
    project: 0,
    nodeModules: 0,
    declarations: 0,
    lib: 0,
  };
  for (const sourceFile of program.getSourceFiles()) {
    counts.total += 1;
    if (isLibFile(sourceFile.fileName)) counts.lib += 1;
    else if (isNodeModulesFile(sourceFile.fileName)) counts.nodeModules += 1;
    else if (sourceFile.isDeclarationFile) counts.declarations += 1;
    else counts.project += 1;
  }
  return counts;
};

const createLanguageServiceHost = (
  rootNames: string[],
  options: ts.CompilerOptions,
): ts.LanguageServiceHost => {
  const versions = new Map<string, string>();
  return {
    getScriptFileNames: () => rootNames,
    getScriptVersion: (fileName) => versions.get(fileName) ?? "0",
    getScriptSnapshot: (fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => options,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
};

export const buildProgram = (
  variant: ProgramVariant,
  config: LoadedTsconfig,
  entryFile: string,
): ProgramBuild => {
  const rootNames = variant === "full" ? config.fileNames : [entryFile];
  const built = timeSync((): ts.Program => {
    if (variant === "language-service") {
      const service = ts.createLanguageService(
        createLanguageServiceHost(rootNames, config.options),
        ts.createDocumentRegistry(),
      );
      const program = service.getProgram();
      if (!program) throw new Error("language service produced no program");
      return program;
    }
    return ts.createProgram({ rootNames, options: config.options });
  });
  const checker = timeSync(() => built.result.getTypeChecker());
  return {
    program: built.result,
    checker: checker.result,
    rootNames,
    createProgramMs: built.elapsedMs,
    createCheckerMs: checker.elapsedMs,
    counts: countSourceFiles(built.result),
  };
};

export const getPeakRssMb = (): number => process.resourceUsage().maxRSS / 1024;

export const getHeapUsedMb = (): number => process.memoryUsage().heapUsed / (1024 * 1024);

export interface SpanMatch {
  node: ts.Node;
  isExact: boolean;
}

export const findNodeAtSpan = (
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): SpanMatch | null => {
  let exact: ts.Node | null = null;
  let smallestContaining: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    const nodeStart = node.getStart(sourceFile);
    if (nodeStart > start || node.end < end) return;
    smallestContaining = node;
    if (nodeStart === start && node.end === end) exact = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (exact) return { node: exact, isExact: true };
  return smallestContaining ? { node: smallestContaining, isExact: false } : null;
};
