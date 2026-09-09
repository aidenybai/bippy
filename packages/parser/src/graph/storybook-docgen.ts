import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Expression, ObjectExpression, Statement } from "@oxc-project/types";
import { parseSync } from "oxc-parser";
import { z } from "zod";
import { globAbsolute } from "../evaluate/import-glob.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { getMemberChain, isStringLiteralNode, unwrapExpression } from "../parse/ast-walk.js";
import type { ProjectContext, SourceTransform } from "../types.js";

// Storybook's webpack frameworks run `@storybook/react-docgen-typescript-plugin`
// over every built `.tsx` module: react-docgen-typescript finds the components
// the module exports from their TypeScript types, and the plugin appends
// `<Component>.displayName = "<Component>"` for each of them. The transform
// runs the project's own react-docgen-typescript over the same modules, in
// builds whose entry is one of the configured stories.

const STORYBOOK_MAIN_FILES = ["js", "mjs", "cjs", "ts", "mts", "cts"].map(
  (extension) => `.storybook/main.${extension}`,
);
const WEBPACK_FRAMEWORK_PACKAGES = new Set(["@storybook/react-webpack5", "@storybook/nextjs"]);
const DOCGEN_PACKAGE = "react-docgen-typescript";
const TYPESCRIPT_PACKAGE = "typescript";
const DOCGEN_TYPESCRIPT_OPTION = "react-docgen-typescript";
/** Storybook 8 switched the `typescript.reactDocgen` default to `react-docgen`. */
const LAST_DOCGEN_TYPESCRIPT_DEFAULT_MAJOR = 7;
const TSX_EXTENSION = ".tsx";
const TSCONFIG_FILE = "tsconfig.json";
/** Storybook's `files` default for a `{ directory }` stories entry. */
const DEFAULT_STORY_FILES = "**/*.@(mdx|stories.@(js|jsx|mjs|ts|tsx))";

// From `@storybook/react-docgen-typescript-plugin`'s `getIdentifier`: names
// react-docgen-typescript gives an expression it could not name.
const DEFAULT_COMPONENT_TYPES = new Set([
  "default",
  "__function",
  "StatelessComponent",
  "Stateless",
  "StyledComponentClass",
  "StyledComponent",
  "FunctionComponent",
  "ForwardRefExoticComponent",
  "MemoExoticComponent",
]);

interface UnknownCall {
  (...args: unknown[]): unknown;
}

interface TypeScriptSystem {
  readFile: UnknownCall;
}

const isCallable = (value: unknown): value is UnknownCall => typeof value === "function";
const callableSchema = z.custom<UnknownCall>(isCallable);

const typescriptModuleSchema = z.object({
  sys: z.custom<TypeScriptSystem>(
    (value) =>
      typeof value === "object" && value !== null && isCallable(Reflect.get(value, "readFile")),
  ),
  readConfigFile: callableSchema,
  parseJsonConfigFileContent: callableSchema,
  createProgram: callableSchema,
  JsxEmit: z.object({ React: z.number() }),
  ModuleKind: z.object({ CommonJS: z.number() }),
  ScriptTarget: z.object({ Latest: z.number() }),
});

const docgenModuleSchema = z.object({ withCompilerOptions: callableSchema });
const docgenParserSchema = z.object({ parseWithProgramProvider: callableSchema });
const readConfigResultSchema = z.object({ config: z.unknown().optional() });
const parsedTsconfigSchema = z.object({
  options: z.record(z.string(), z.unknown()),
  fileNames: z.array(z.string()),
});

interface ParsedTsconfig {
  options: Record<string, unknown>;
  fileNames: string[];
}
const componentDocSchema = z.object({
  displayName: z.string(),
  expression: z.object({ getName: callableSchema }).optional(),
});
const componentDocsSchema = z.array(componentDocSchema);

interface StorybookMainConfig {
  frameworkPackage: string | null;
  reactDocgen: string | false | undefined | null;
  /** Story globs relative to the config directory; `null` when the file computes them. */
  storyPatterns: string[] | null;
}

const getObjectMember = (object: ObjectExpression, key: string): Expression | null => {
  for (const property of object.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const name =
      property.key.type === "Identifier"
        ? property.key.name
        : isStringLiteralNode(property.key)
          ? property.key.value
          : null;
    if (name === key) return unwrapExpression(property.value);
  }
  return null;
};

const getTopLevelInitializer = (statements: Statement[], name: string): Expression | null => {
  for (const statement of statements) {
    const declaration =
      statement.type === "VariableDeclaration"
        ? statement
        : statement.type === "ExportNamedDeclaration" &&
            statement.declaration?.type === "VariableDeclaration"
          ? statement.declaration
          : null;
    for (const declarator of declaration?.declarations ?? []) {
      if (declarator.id.type === "Identifier" && declarator.id.name === name && declarator.init) {
        return unwrapExpression(declarator.init);
      }
    }
  }
  return null;
};

/** The object `.storybook/main` exports: `export default config`, `export default {}` or `module.exports = {}`. */
const getExportedConfig = (statements: Statement[]): ObjectExpression | null => {
  let exported: Expression | null = null;
  for (const statement of statements) {
    if (statement.type === "ExportDefaultDeclaration") {
      exported =
        statement.declaration.type === "FunctionDeclaration" ||
        statement.declaration.type === "ClassDeclaration" ||
        statement.declaration.type === "TSInterfaceDeclaration"
          ? null
          : unwrapExpression(statement.declaration);
    } else if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      statement.expression.left.type === "MemberExpression" &&
      getMemberChain(statement.expression.left)?.join(".") === "module.exports"
    ) {
      exported = unwrapExpression(statement.expression.right);
    }
  }
  if (exported?.type === "Identifier") exported = getTopLevelInitializer(statements, exported.name);
  return exported?.type === "ObjectExpression" ? exported : null;
};

const readStringOption = (expression: Expression | null): string | null =>
  isStringLiteralNode(expression) ? expression.value : null;

/** A `stories` entry: a glob, or `{ directory, files? }` whose files glob is relative to the directory. */
const readStoryPattern = (element: Expression): string | null => {
  if (element.type !== "ObjectExpression") return readStringOption(element);
  const directory = readStringOption(getObjectMember(element, "directory"));
  const files = getObjectMember(element, "files");
  const filesPattern = files === null ? DEFAULT_STORY_FILES : readStringOption(files);
  return directory === null || filesPattern === null ? null : `${directory}/${filesPattern}`;
};

const readStoryPatterns = (stories: Expression | null): string[] | null => {
  if (stories?.type !== "ArrayExpression") return null;
  const patterns: string[] = [];
  for (const element of stories.elements) {
    if (element === null || element.type === "SpreadElement") return null;
    const pattern = readStoryPattern(unwrapExpression(element));
    if (pattern === null) return null;
    patterns.push(pattern);
  }
  return patterns;
};

const readReactDocgenOption = (
  typescriptOptions: Expression | null,
): StorybookMainConfig["reactDocgen"] => {
  if (typescriptOptions === null) return undefined;
  if (typescriptOptions.type !== "ObjectExpression") return null;
  const reactDocgen = getObjectMember(typescriptOptions, "reactDocgen");
  if (reactDocgen === null) return undefined;
  if (reactDocgen.type === "Literal" && reactDocgen.value === false) return false;
  return readStringOption(reactDocgen);
};

const readMainConfig = (mainPath: string): StorybookMainConfig | null => {
  const { program } = parseSync(mainPath, readFileSync(mainPath, "utf8"), {
    sourceType: "module",
  });
  const config = getExportedConfig(program.body);
  if (!config) return null;
  const framework = getObjectMember(config, "framework");
  return {
    frameworkPackage:
      framework?.type === "ObjectExpression"
        ? readStringOption(getObjectMember(framework, "name"))
        : readStringOption(framework),
    reactDocgen: readReactDocgenOption(getObjectMember(config, "typescript")),
    storyPatterns: readStoryPatterns(getObjectMember(config, "stories")),
  };
};

const usesDocgenTypescript = (project: ProjectContext, config: StorybookMainConfig): boolean => {
  if (
    config.frameworkPackage === null ||
    !WEBPACK_FRAMEWORK_PACKAGES.has(config.frameworkPackage)
  ) {
    return false;
  }
  if (config.reactDocgen !== undefined) return config.reactDocgen === DOCGEN_TYPESCRIPT_OPTION;
  const version = project.readPackageVersion(config.frameworkPackage);
  return version !== null && Number(version.split(".")[0]) <= LAST_DOCGEN_TYPESCRIPT_DEFAULT_MAJOR;
};

/** The story modules Storybook builds, by the config's `stories` globs. */
const listStoryFiles = (configDirectory: string, storyPatterns: string[]): Set<string> =>
  new Set(storyPatterns.flatMap((pattern) => globAbsolute(path.join(configDirectory, pattern))));

/** The binding the plugin assigns `displayName` on: the exported expression's name unless docgen only knows its kind. */
export const getStorybookDocgenIdentifier = (
  displayName: string,
  expressionName: unknown,
): string =>
  typeof expressionName !== "string" || DEFAULT_COMPONENT_TYPES.has(expressionName)
    ? displayName
    : expressionName;

export const generateStorybookDisplayNameBlock = (identifier: string): string =>
  `\ntry {\n    ${identifier}.displayName = ${JSON.stringify(identifier)};\n} catch (__react_docgen_typescript_loader_error) {}`;

const createTransform = (
  rootDirectory: string,
  isStoryFile: (filePath: string) => boolean,
): SourceTransform | null => {
  const installed = getInstalledModules(rootDirectory);
  const docgenModule = installed.load(DOCGEN_PACKAGE);
  const typescriptModule = installed.load(TYPESCRIPT_PACKAGE, DOCGEN_PACKAGE);
  if (docgenModule === null || typescriptModule === null) return null;
  const docgen = docgenModuleSchema.parse(docgenModule);
  const typescript = typescriptModuleSchema.parse(typescriptModule);
  const tsconfigPath = path.join(rootDirectory, TSCONFIG_FILE);
  const { config } = readConfigResultSchema.parse(
    typescript.readConfigFile(tsconfigPath, typescript.sys.readFile),
  );
  const tsconfig: ParsedTsconfig =
    config === undefined
      ? { options: {}, fileNames: [] }
      : parsedTsconfigSchema.parse(
          typescript.parseJsonConfigFileContent(
            config,
            typescript.sys,
            rootDirectory,
            {},
            tsconfigPath,
          ),
        );
  const compilerOptions = {
    jsx: typescript.JsxEmit.React,
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.Latest,
    ...tsconfig.options,
  };
  const parser = docgenParserSchema.parse(
    docgen.withCompilerOptions(compilerOptions, {
      shouldIncludeExpression: true,
      savePropValueAsString: true,
    }),
  );
  const rootNames = new Set(
    tsconfig.fileNames.filter((fileName) => fileName.endsWith(TSX_EXTENSION)),
  );
  let program: unknown = undefined;
  const getProgram = (filePath: string): unknown => {
    if (program !== undefined && rootNames.has(filePath)) return program;
    rootNames.add(filePath);
    program = typescript.createProgram({
      rootNames: [...rootNames],
      options: compilerOptions,
      oldProgram: program,
    });
    return program;
  };
  return {
    extension: TSX_EXTENSION,
    appliesToEntry: isStoryFile,
    transform: (filePath, sourceText) => {
      const docs = componentDocsSchema.parse(
        parser.parseWithProgramProvider(filePath, () => getProgram(filePath)),
      );
      if (docs.length === 0) return null;
      const displayNames = docs.map((doc) =>
        generateStorybookDisplayNameBlock(
          getStorybookDocgenIdentifier(doc.displayName, doc.expression?.getName()),
        ),
      );
      return { sourceText: sourceText + displayNames.join(""), lang: "tsx" };
    },
  };
};

export const createStorybookDocgenTransform = (
  project: ProjectContext,
  rootDirectory: string,
): SourceTransform | null => {
  const mainPath = STORYBOOK_MAIN_FILES.map((fileName) => path.join(rootDirectory, fileName)).find(
    (candidate) => existsSync(candidate),
  );
  if (mainPath === undefined) return null;
  const config = readMainConfig(mainPath);
  if (config === null || config.storyPatterns === null || !usesDocgenTypescript(project, config)) {
    return null;
  }
  const { storyPatterns } = config;
  let storyFiles: Set<string> | null = null;
  return createTransform(rootDirectory, (filePath) => {
    storyFiles ??= listStoryFiles(path.dirname(mainPath), storyPatterns);
    return storyFiles.has(filePath);
  });
};
