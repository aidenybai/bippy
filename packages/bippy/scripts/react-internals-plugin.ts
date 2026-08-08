import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ReactDevToolsCore from "react-devtools-core";
import type {
  InternalReactConstants,
  ReactBuildTypeMap,
  ReactDevToolsCore as ReactDevToolsCoreModule,
  ReactSymbolsMap,
  ReactTypeOfSideEffectMap,
  ReactWorkTagMap,
  ReactWorkTagVersionRange,
} from "react-devtools-core";
import { format } from "vite-plus/fmt";
import type { Plugin } from "vite-plus";
import ts from "typescript";
import { z } from "zod";
import { compareSemver } from "../src/semver.js";

interface ReactInternalsPluginOptions {
  mode: "check" | "generate";
}

interface ReactInternalsGenerationOptions extends ReactInternalsPluginOptions {
  generatedModulePath?: string;
  reactDevToolsCore?: unknown;
}

interface GeneratedReactInternals {
  declarationModule: string;
  runtimeModule: string;
}

interface GeneratedReactInternalsPaths {
  declarationModulePath: string;
  runtimeModulePath: string;
}

const semanticVersionSchema = z
  .string()
  .refine((version) => compareSemver(version, version) === 0, "Expected a valid semantic version");

const reactBuildTypeSchema: z.ZodType<ReactBuildTypeMap> = z
  .object({
    Development: z.literal(1),
    Production: z.literal(0),
  })
  .strict();

const reactSymbolsSchema: z.ZodType<ReactSymbolsMap> = z
  .object({
    CONCURRENT_MODE_NUMBER: z.number().int(),
    CONCURRENT_MODE_SYMBOL_DESCRIPTION: z.string(),
    CONCURRENT_MODE_SYMBOL_STRING: z.string(),
    DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION: z.string(),
    DEPRECATED_ASYNC_MODE_SYMBOL_STRING: z.string(),
    ELEMENT_SYMBOL_STRING: z.string(),
    LEGACY_ELEMENT_SYMBOL_STRING: z.string(),
  })
  .strict();

const reactTypeOfSideEffectSchema: z.ZodType<ReactTypeOfSideEffectMap> = z
  .object({
    ChildDeletion: z.number().int().nonnegative(),
    Cloned: z.number().int().nonnegative(),
    ContentReset: z.number().int().nonnegative(),
    Hydrating: z.number().int().nonnegative(),
    PerformedWork: z.number().int().nonnegative(),
    Placement: z.number().int().nonnegative(),
    Snapshot: z.number().int().nonnegative(),
    Update: z.number().int().nonnegative(),
    Visibility: z.number().int().nonnegative(),
  })
  .strict();

const reactWorkTagMapSchema: z.ZodType<ReactWorkTagMap> = z.record(
  z.string().regex(/^[A-Za-z_$][\w$]*$/, "Expected a valid JavaScript property name"),
  z.number().int().min(-1),
);

const reactWorkTagVersionRangeSchema: z.ZodType<ReactWorkTagVersionRange> = z
  .object({
    isMinimumExcluded: z.boolean().optional(),
    minimumVersion: semanticVersionSchema.optional(),
    version: semanticVersionSchema,
  })
  .strict();

const internalReactConstantsSchema: z.ZodType<InternalReactConstants> = z.object({
  ReactTypeOfWork: reactWorkTagMapSchema,
});

const reactDevToolsCoreSchema: z.ZodType<ReactDevToolsCoreModule> = z.object({
  ReactBuildType: reactBuildTypeSchema,
  ReactSymbols: reactSymbolsSchema,
  ReactTypeOfSideEffect: reactTypeOfSideEffectSchema,
  ReactWorkTagVersionRanges: z.array(reactWorkTagVersionRangeSchema).nonempty(),
  getInternalReactConstants: z.custom<ReactDevToolsCoreModule["getInternalReactConstants"]>(
    (value) => typeof value === "function",
  ),
});

interface ReactWorkTagBaseline extends ReactWorkTagVersionRange {
  workTags: ReactWorkTagMap;
}

interface ValidatedReactInternals {
  baselines: ReactWorkTagBaseline[];
  reactDevToolsCore: ReactDevToolsCoreModule;
  workTagNames: string[];
}

const futureReactVersion = "999999999999999999999999999999.0.0";
const requiredReactWorkTags = [
  "ClassComponent",
  "ContextConsumer",
  "ContextProvider",
  "DehydratedSuspenseComponent",
  "ForwardRef",
  "Fragment",
  "FunctionComponent",
  "HostComponent",
  "HostPortal",
  "HostRoot",
  "HostText",
  "LazyComponent",
  "MemoComponent",
  "OffscreenComponent",
  "SimpleMemoComponent",
  "SuspenseComponent",
  "SuspenseListComponent",
];

const readReactWorkTags = (
  getInternalReactConstants: ReactDevToolsCoreModule["getInternalReactConstants"],
  reactVersion: string,
): ReactWorkTagMap =>
  internalReactConstantsSchema.parse(getInternalReactConstants(reactVersion)).ReactTypeOfWork;

const areWorkTagMapsEqual = (
  leftWorkTags: ReactWorkTagMap,
  rightWorkTags: ReactWorkTagMap,
): boolean => {
  const leftEntries = Object.entries(leftWorkTags);
  return (
    leftEntries.length === Object.keys(rightWorkTags).length &&
    leftEntries.every(([workTagName, value]) => rightWorkTags[workTagName] === value)
  );
};

const validateReactSymbols = (reactSymbols: ReactSymbolsMap): void => {
  if (
    reactSymbols.CONCURRENT_MODE_SYMBOL_STRING !==
      `Symbol(${reactSymbols.CONCURRENT_MODE_SYMBOL_DESCRIPTION})` ||
    reactSymbols.DEPRECATED_ASYNC_MODE_SYMBOL_STRING !==
      `Symbol(${reactSymbols.DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION})` ||
    reactSymbols.ELEMENT_SYMBOL_STRING === reactSymbols.LEGACY_ELEMENT_SYMBOL_STRING
  ) {
    throw new Error("React DevTools returned inconsistent React symbols");
  }
};

const validateReactFiberFlags = (reactFiberFlags: ReactTypeOfSideEffectMap): void => {
  const flagValues = Object.values(reactFiberFlags);
  if (
    flagValues.some((flagValue) => flagValue === 0 || !Number.isInteger(Math.log2(flagValue))) ||
    new Set(flagValues).size !== flagValues.length
  ) {
    throw new Error("React DevTools returned invalid or overlapping Fiber flags");
  }
};

const validateReactWorkTagVersionRanges = (versionRanges: ReactWorkTagVersionRange[]): void => {
  const seenVersions = new Set<string>();
  for (let rangeIndex = 0; rangeIndex < versionRanges.length; rangeIndex++) {
    const versionRange = versionRanges[rangeIndex];
    if (!versionRange) throw new Error("React DevTools returned an empty version range");
    if (seenVersions.has(versionRange.version)) {
      throw new Error(`React DevTools returned duplicate work-tag version ${versionRange.version}`);
    }
    seenVersions.add(versionRange.version);

    if (rangeIndex === 0) {
      if (versionRange.minimumVersion !== undefined || versionRange.isMinimumExcluded === true) {
        throw new Error("The first React work-tag range must be unbounded");
      }
    } else {
      const minimumVersion = versionRange.minimumVersion;
      if (!minimumVersion) {
        throw new Error(`React work-tag range ${versionRange.version} is missing its minimum`);
      }
      const previousRange = versionRanges[rangeIndex - 1];
      const previousMinimumVersion = previousRange?.minimumVersion;
      if (previousMinimumVersion && compareSemver(minimumVersion, previousMinimumVersion) !== 1) {
        throw new Error("React work-tag range minimums must be strictly increasing");
      }
      const representativeComparison = compareSemver(versionRange.version, minimumVersion);
      if (
        representativeComparison === -1 ||
        (representativeComparison === 0 && versionRange.isMinimumExcluded === true)
      ) {
        throw new Error(
          `React work-tag version ${versionRange.version} does not belong to its declared range`,
        );
      }
    }

    const nextRange = versionRanges[rangeIndex + 1];
    if (nextRange?.minimumVersion) {
      const nextBoundaryComparison = compareSemver(versionRange.version, nextRange.minimumVersion);
      if (
        nextBoundaryComparison === 1 ||
        (nextBoundaryComparison === 0 && nextRange.isMinimumExcluded !== true)
      ) {
        throw new Error(
          `React work-tag version ${versionRange.version} overlaps the following range`,
        );
      }
    }
  }
};

const validateWorkTags = (
  baselines: ReactWorkTagBaseline[],
  futureWorkTags: ReactWorkTagMap,
): string[] => {
  const firstBaseline = baselines[0];
  if (!firstBaseline) throw new Error("React DevTools returned no work-tag tables");
  const workTagNames = Object.keys(firstBaseline.workTags).sort();
  const tables = [...baselines.map((baseline) => baseline.workTags), futureWorkTags];
  if (workTagNames.length === 0) {
    throw new Error("React DevTools returned an empty work-tag table");
  }
  for (const requiredReactWorkTag of requiredReactWorkTags) {
    if (!workTagNames.includes(requiredReactWorkTag)) {
      throw new Error(`React DevTools work-tag tables are missing ${requiredReactWorkTag}`);
    }
  }
  if (
    tables.some((workTags) => {
      const names = Object.keys(workTags).sort();
      return (
        names.length !== workTagNames.length ||
        names.some((workTagName, workTagIndex) => workTagName !== workTagNames[workTagIndex])
      );
    })
  ) {
    throw new Error("React DevTools work-tag tables have mismatched keys");
  }
  for (const workTags of tables) {
    const activeWorkTagValues = Object.values(workTags).filter((workTag) => workTag >= 0);
    if (new Set(activeWorkTagValues).size !== activeWorkTagValues.length) {
      throw new Error("React DevTools returned overlapping active work tags");
    }
  }
  const latestBaseline = baselines[baselines.length - 1];
  if (!latestBaseline) throw new Error("React DevTools returned no latest work-tag table");
  if (
    workTagNames.some(
      (workTagName) => futureWorkTags[workTagName] !== latestBaseline.workTags[workTagName],
    )
  ) {
    throw new Error(
      `react-devtools-core added a work-tag range after React ${latestBaseline.version}; add its version boundary before regenerating React internals`,
    );
  }
  return workTagNames;
};

const readReactWorkTagBaselines = (
  reactDevToolsCore: ReactDevToolsCoreModule,
): ReactWorkTagBaseline[] => {
  validateReactWorkTagVersionRanges(reactDevToolsCore.ReactWorkTagVersionRanges);
  const baselines = reactDevToolsCore.ReactWorkTagVersionRanges.map((definition) => ({
    ...definition,
    workTags: readReactWorkTags(reactDevToolsCore.getInternalReactConstants, definition.version),
  }));

  for (let rangeIndex = 1; rangeIndex < baselines.length; rangeIndex++) {
    const baseline = baselines[rangeIndex];
    const previousBaseline = baselines[rangeIndex - 1];
    if (!baseline?.minimumVersion || !previousBaseline) continue;
    const boundaryWorkTags = readReactWorkTags(
      reactDevToolsCore.getInternalReactConstants,
      baseline.minimumVersion,
    );
    const expectedWorkTags =
      baseline.isMinimumExcluded === true ? previousBaseline.workTags : baseline.workTags;
    if (!areWorkTagMapsEqual(boundaryWorkTags, expectedWorkTags)) {
      throw new Error(`React DevTools selects the wrong work tags at ${baseline.minimumVersion}`);
    }
  }
  return baselines;
};

const readValidatedReactInternals = (value: unknown): ValidatedReactInternals => {
  const reactDevToolsCore = reactDevToolsCoreSchema.parse(value);
  validateReactSymbols(reactDevToolsCore.ReactSymbols);
  validateReactFiberFlags(reactDevToolsCore.ReactTypeOfSideEffect);
  const baselines = readReactWorkTagBaselines(reactDevToolsCore);
  const futureWorkTags = readReactWorkTags(
    reactDevToolsCore.getInternalReactConstants,
    futureReactVersion,
  );
  const workTagNames = validateWorkTags(baselines, futureWorkTags);
  return { baselines, reactDevToolsCore, workTagNames };
};

const renderWorkTagMap = (
  reactVersion: string,
  workTagNames: string[],
  workTags: ReactWorkTagMap,
): string =>
  [
    `  "${reactVersion}": {`,
    ...workTagNames.map((workTagName) => `    ${workTagName}: ${workTags[workTagName]},`),
    "  },",
  ].join("\n");

const renderNumericMap = (
  name: string,
  values: ReactBuildTypeMap | ReactTypeOfSideEffectMap,
): string[] => [
  `export const ${name} = {`,
  ...Object.entries(values).map(([propertyName, value]) => `  ${propertyName}: ${value},`),
  "} as const;",
];

const renderSymbolMap = (values: ReactSymbolsMap): string[] => [
  "export const ReactSymbols = {",
  ...Object.entries(values).map(
    ([propertyName, value]) => `  ${propertyName}: ${JSON.stringify(value)},`,
  ),
  "} as const;",
];

const renderGeneratedModule = (
  workTagNames: string[],
  baselines: ReactWorkTagBaseline[],
  reactBuildType: ReactBuildTypeMap,
  reactFiberFlags: ReactTypeOfSideEffectMap,
  reactSymbols: ReactSymbolsMap,
): string => {
  const firstBaseline = baselines[0];
  const latestBaseline = baselines[baselines.length - 1];
  if (!firstBaseline || !latestBaseline) {
    throw new Error("Cannot render React internals without work-tag tables");
  }
  const workTagRanges = baselines
    .filter((baseline) => baseline.minimumVersion !== undefined)
    .reverse()
    .map((baseline) =>
      [
        "  {",
        `    isMinimumExcluded: ${baseline.isMinimumExcluded === true},`,
        `    minimumVersion: ${JSON.stringify(baseline.minimumVersion)},`,
        `    workTags: reactWorkTagsByVersion[${JSON.stringify(baseline.version)}],`,
        "  },",
      ].join("\n"),
    );

  return [
    'import { compareSemver } from "../semver.js";',
    "",
    ...renderNumericMap("ReactBuildType", reactBuildType),
    "",
    ...renderNumericMap("ReactFiberFlags", reactFiberFlags),
    "",
    ...renderSymbolMap(reactSymbols),
    "",
    "export interface ReactWorkTagMap {",
    ...workTagNames.map((workTagName) => `  ${workTagName}: number;`),
    "}",
    "",
    "const defineReactWorkTags = <const VersionedWorkTags extends Record<string, ReactWorkTagMap>>(",
    "  workTags: VersionedWorkTags,",
    "): VersionedWorkTags => workTags;",
    "",
    "const reactWorkTagsByVersion = defineReactWorkTags({",
    ...baselines.map((baseline) =>
      renderWorkTagMap(baseline.version, workTagNames, baseline.workTags),
    ),
    "});",
    "",
    "export type ReactWorkTagVersion = keyof typeof reactWorkTagsByVersion;",
    "",
    "export interface GetReactWorkTags {",
    "  <Version extends ReactWorkTagVersion>(",
    "    reactVersion: Version,",
    "  ): Readonly<(typeof reactWorkTagsByVersion)[Version]>;",
    "  (reactVersion: string): Readonly<ReactWorkTagMap>;",
    "}",
    "",
    "export type ReactWorkTag = Exclude<",
    "  (typeof reactWorkTagsByVersion)[ReactWorkTagVersion][keyof ReactWorkTagMap],",
    "  -1",
    ">;",
    "",
    "export type HostWorkTag = Exclude<",
    '  | (typeof reactWorkTagsByVersion)[ReactWorkTagVersion]["HostComponent"]',
    '  | (typeof reactWorkTagsByVersion)[ReactWorkTagVersion]["HostHoistable"]',
    '  | (typeof reactWorkTagsByVersion)[ReactWorkTagVersion]["HostSingleton"]',
    '  | (typeof reactWorkTagsByVersion)[ReactWorkTagVersion]["HostText"],',
    "  -1",
    ">;",
    "",
    "interface ReactWorkTagRange {",
    "  isMinimumExcluded: boolean;",
    "  minimumVersion: string;",
    "  workTags: Readonly<ReactWorkTagMap>;",
    "}",
    "",
    "const reactWorkTagRanges: ReactWorkTagRange[] = [",
    ...workTagRanges,
    "];",
    "",
    "export const getReactWorkTags: GetReactWorkTags = (reactVersion: string) => {",
    "  for (const range of reactWorkTagRanges) {",
    "    const comparison = compareSemver(reactVersion, range.minimumVersion);",
    `    if (comparison === null) return reactWorkTagsByVersion[${JSON.stringify(latestBaseline.version)}];`,
    "    if (comparison === 1 || (comparison === 0 && !range.isMinimumExcluded)) {",
    "      return range.workTags;",
    "    }",
    "  }",
    `  return reactWorkTagsByVersion[${JSON.stringify(firstBaseline.version)}];`,
    "};",
    "",
  ].join("\n");
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultGeneratedModulePath = resolve(scriptDirectory, "../src/generated/react-work-tags.ts");

const removeEmptyExportDeclaration = (declarationModule: string): string => {
  const sourceFile = ts.createSourceFile(
    "react-work-tags.d.ts",
    declarationModule,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements = sourceFile.statements.filter(
    (statement) =>
      !(
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier === undefined &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.length === 0
      ),
  );
  return ts.createPrinter().printFile(ts.factory.updateSourceFile(sourceFile, statements));
};

let nextTemporaryFileId = 0;

export const createGeneratedReactInternals = async (
  reactDevToolsCoreValue: unknown,
): Promise<GeneratedReactInternals> => {
  const { baselines, reactDevToolsCore, workTagNames } =
    readValidatedReactInternals(reactDevToolsCoreValue);
  const typescriptModule = renderGeneratedModule(
    workTagNames,
    baselines,
    reactDevToolsCore.ReactBuildType,
    reactDevToolsCore.ReactTypeOfSideEffect,
    reactDevToolsCore.ReactSymbols,
  );
  const compilerOptions: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmitOnError: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const generatedModuleBasePath = defaultGeneratedModulePath.slice(0, -3);
  const generatedDeclarationModulePath = `${generatedModuleBasePath}.d.ts`;
  const generatedRuntimeModulePath = `${generatedModuleBasePath}.js`;
  let declarationModule: string | undefined;
  let runtimeModule: string | undefined;
  const defaultCompilerHost = ts.createCompilerHost(compilerOptions);
  const compilerHost: ts.CompilerHost = {
    ...defaultCompilerHost,
    fileExists: (fileName) =>
      resolve(fileName) === defaultGeneratedModulePath || defaultCompilerHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      resolve(fileName) === defaultGeneratedModulePath
        ? ts.createSourceFile(fileName, typescriptModule, languageVersion, true)
        : defaultCompilerHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
          ),
    readFile: (fileName) =>
      resolve(fileName) === defaultGeneratedModulePath
        ? typescriptModule
        : defaultCompilerHost.readFile(fileName),
    writeFile: (fileName, content) => {
      if (resolve(fileName) === generatedDeclarationModulePath) declarationModule = content;
      if (resolve(fileName) === generatedRuntimeModulePath) runtimeModule = content;
    },
  };
  const program = ts.createProgram([defaultGeneratedModulePath], compilerOptions, compilerHost);
  const emitResult = program.emit();
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(
      ts.formatDiagnostics(errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      }),
    );
  }
  if (declarationModule === undefined || runtimeModule === undefined) {
    throw new Error("TypeScript did not emit the generated React internals artifacts");
  }
  const [declarationResult, runtimeResult] = await Promise.all([
    format(generatedDeclarationModulePath, removeEmptyExportDeclaration(declarationModule), {
      semi: true,
      singleQuote: false,
    }),
    format(generatedRuntimeModulePath, runtimeModule, { semi: true, singleQuote: false }),
  ]);
  const formattingErrors = [...declarationResult.errors, ...runtimeResult.errors];
  if (formattingErrors.length > 0) {
    throw new Error(formattingErrors.map((error) => error.message).join("\n"));
  }
  return {
    declarationModule: declarationResult.code,
    runtimeModule: runtimeResult.code,
  };
};

const getGeneratedReactInternalsPaths = (
  generatedModulePath: string,
): GeneratedReactInternalsPaths => {
  const moduleBasePath = generatedModulePath.endsWith(".ts")
    ? generatedModulePath.slice(0, -3)
    : generatedModulePath;
  return {
    declarationModulePath: `${moduleBasePath}.d.ts`,
    runtimeModulePath: `${moduleBasePath}.js`,
  };
};

const writeGeneratedModule = (generatedModulePath: string, generatedModule: string): void => {
  mkdirSync(dirname(generatedModulePath), { recursive: true });
  const temporaryFileId = nextTemporaryFileId++;
  const temporaryModulePath = resolve(
    dirname(generatedModulePath),
    `.${basename(generatedModulePath)}.${process.pid}.${temporaryFileId}.tmp`,
  );
  try {
    writeFileSync(temporaryModulePath, generatedModule, { flag: "wx" });
    renameSync(temporaryModulePath, generatedModulePath);
  } finally {
    rmSync(temporaryModulePath, { force: true });
  }
};

export const generateReactInternals = async ({
  generatedModulePath = defaultGeneratedModulePath,
  mode,
  reactDevToolsCore = ReactDevToolsCore,
}: ReactInternalsGenerationOptions): Promise<void> => {
  const generatedModules = await createGeneratedReactInternals(reactDevToolsCore);
  const { declarationModulePath, runtimeModulePath } =
    getGeneratedReactInternalsPaths(generatedModulePath);
  const existingDeclarationModule = existsSync(declarationModulePath)
    ? readFileSync(declarationModulePath, "utf8")
    : undefined;
  const existingRuntimeModule = existsSync(runtimeModulePath)
    ? readFileSync(runtimeModulePath, "utf8")
    : undefined;

  if (
    existingDeclarationModule === generatedModules.declarationModule &&
    existingRuntimeModule === generatedModules.runtimeModule &&
    !existsSync(generatedModulePath)
  ) {
    return;
  }
  if (mode === "check") {
    throw new Error("Generated React internals are stale; run nr build and commit the result");
  }
  writeGeneratedModule(declarationModulePath, generatedModules.declarationModule);
  writeGeneratedModule(runtimeModulePath, generatedModules.runtimeModule);
  rmSync(generatedModulePath, { force: true });
};

export const reactInternalsPlugin = (options: ReactInternalsPluginOptions): Plugin => ({
  name: "bippy-react-internals",
  buildStart: () => generateReactInternals(options),
});
