import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { ResolverConfigurationError } from "../errors.js";
import type { ModuleResolverOptions } from "../module-resolver.js";

interface ConfigImport {
  source: string;
  name: string;
}

export interface ResolverConfig {
  diagnostics?: string[];
  aliasOrder?: string[];
  aliasDirectory?: string;
  literalAliases?: boolean;
  recursiveAliases?: boolean;
  conditions?: string[];
  alias?: ModuleResolverOptions["alias"];
  extensions?: string[];
  mainFields?: string[];
  conditionNames?: string[];
}

export const readResolverConfig = (
  configFile: string,
  projectDirectory: string,
): ResolverConfig => {
  const source = ts.createSourceFile(
    configFile,
    readFileSync(configFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings = new Map<string, ts.Expression>();
  const imports = new Map<string, ConfigImport>();
  let exported: ts.Expression | undefined;
  const fail = (detail: string): never => {
    throw new ResolverConfigurationError(`${configFile}: ${detail}`);
  };
  const diagnostics = ts.transpileModule(source.text, {
    fileName: configFile,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).diagnostics;
  if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))
    fail("Invalid configuration syntax");
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const importSource = statement.moduleSpecifier.text;
      if (clause?.name) imports.set(clause.name.text, { source: importSource, name: "*" });
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        imports.set(clause.namedBindings.name.text, { source: importSource, name: "*" });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const binding of clause.namedBindings.elements)
          imports.set(binding.name.text, {
            source: importSource,
            name: binding.propertyName?.text ?? binding.name.text,
          });
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          bindings.set(declaration.name.text, declaration.initializer);
          const initializer = declaration.initializer;
          if (
            ts.isCallExpression(initializer) &&
            ts.isIdentifier(initializer.expression) &&
            initializer.expression.text === "require" &&
            initializer.arguments.length === 1 &&
            ts.isStringLiteral(initializer.arguments[0])
          )
            imports.set(declaration.name.text, {
              source: initializer.arguments[0].text,
              name: "*",
            });
        }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals)
      exported = statement.expression;
    if (
      ts.isExpressionStatement(statement) &&
      !ts.isStringLiteral(statement.expression) &&
      !ts.isBinaryExpression(statement.expression)
    )
      fail("Configuration side effects require an explicitly supplied resolution policy");
    if (
      ts.isIfStatement(statement) ||
      ts.isIterationStatement(statement, false) ||
      ts.isTryStatement(statement) ||
      ts.isSwitchStatement(statement)
    )
      fail("Configuration control flow requires an explicitly supplied resolution policy");
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const assignment = statement.expression;
      if (
        assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        assignment.left.getText(source) === "module.exports"
      )
        exported = assignment.right;
      else fail("Configuration mutations require an explicitly supplied resolution policy");
    }
  }
  const getImportedCall = (expression: ts.Expression) => {
    if (ts.isIdentifier(expression)) return imports.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const imported = imports.get(expression.expression.text);
      if (imported?.name === "*") return { source: imported.source, name: expression.name.text };
    }
    return undefined;
  };
  const unwrap = (expression: ts.Expression, visited = new Set<string>()): ts.Expression => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    )
      return unwrap(expression.expression, visited);
    if (ts.isIdentifier(expression) && bindings.has(expression.text)) {
      if (visited.has(expression.text))
        return fail(`Circular configuration binding: ${expression.text}`);
      visited.add(expression.text);
      const value = bindings.get(expression.text);
      if (value) return unwrap(value, visited);
    }
    if (ts.isCallExpression(expression)) {
      const imported = getImportedCall(expression.expression);
      if (
        imported?.name === "defineConfig" &&
        ["vite", "vite-plus", "rolldown", "@rspack/core"].includes(imported.source) &&
        expression.arguments.length === 1
      )
        return unwrap(expression.arguments[0], visited);
    }
    return expression;
  };
  const getString = (expression: ts.Expression): string => {
    const value = unwrap(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (ts.isIdentifier(value) && value.text === "__dirname") return dirname(configFile);
    if (ts.isIdentifier(value) && value.text === "__filename") return configFile;
    if (
      ts.isPropertyAccessExpression(value) &&
      value.name.text === "url" &&
      ts.isMetaProperty(value.expression) &&
      value.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    )
      return pathToFileURL(configFile).href;
    if (ts.isCallExpression(value)) {
      const imported = getImportedCall(value.expression);
      if (imported && ["path", "node:path"].includes(imported.source)) {
        const argumentsList = value.arguments.map(getString);
        if (imported.name === "resolve") {
          if (!argumentsList[0] || !isAbsolute(argumentsList[0]))
            return fail(
              "Relative path.resolve calls depend on the configuration process working directory",
            );
          return resolve(...argumentsList);
        }
        if (imported.name === "join") return join(...argumentsList);
        if (imported.name === "dirname" && argumentsList.length === 1)
          return dirname(argumentsList[0]);
      }
      if (
        imported &&
        ["url", "node:url"].includes(imported.source) &&
        imported.name === "fileURLToPath" &&
        value.arguments.length === 1
      ) {
        const argument = unwrap(value.arguments[0]);
        if (
          ts.isNewExpression(argument) &&
          ts.isIdentifier(argument.expression) &&
          argument.expression.text === "URL" &&
          !bindings.has("URL") &&
          !imports.has("URL") &&
          argument.arguments?.length === 2
        )
          return fileURLToPath(
            new URL(getString(argument.arguments[0]), getString(argument.arguments[1])),
          );
        return fileURLToPath(getString(argument));
      }
    }
    return fail(
      `Cannot statically read ${value.getText(source)}; supply the selected resolution policy explicitly`,
    );
  };
  const getProperties = (
    expression: ts.Expression,
    visited = new Set<ts.Expression>(),
  ): Map<string, ts.Expression> => {
    const value = unwrap(expression);
    if (visited.has(value)) return fail("Circular configuration object");
    const ancestors = new Set(visited);
    ancestors.add(value);
    if (!ts.isObjectLiteralExpression(value))
      return fail("Dynamic configuration requires an explicitly supplied resolution policy");
    const properties = new Map<string, ts.Expression>();
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        for (const [name, initializer] of getProperties(property.expression, ancestors))
          properties.set(name, initializer);
        continue;
      }
      const name = ts.isComputedPropertyName(property.name)
        ? getString(property.name.expression)
        : property.name.text;
      if (ts.isPropertyAssignment(property)) properties.set(name, property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) properties.set(name, property.name);
      else fail(`Dynamic ${name} configuration requires an explicitly supplied resolution policy`);
    }
    return properties;
  };
  const getStrings = (expression: ts.Expression): string[] => {
    const value = unwrap(expression);
    if (!ts.isArrayLiteralExpression(value)) return fail("Expected a static string array");
    const values = value.elements.map(getString);
    if (values.includes("..."))
      return fail("Inherited option placeholders require an explicitly supplied resolution policy");
    return values;
  };
  if (!exported) return fail("No static default export or module.exports configuration found");
  const configuration = getProperties(exported);
  for (const name of [
    "webpack",
    "externals",
    "external",
    "resolveLoader",
    "ssr",
    "environments",
    "root",
    "context",
    "conditions",
    "resolveExtensions",
    "mainFields",
  ])
    if (configuration.has(name))
      return fail(
        `Unsupported ${name} configuration; supply the selected resolution policy explicitly`,
      );
  const resolution = configuration.get("resolve");
  const properties = resolution ? getProperties(resolution) : new Map<string, ts.Expression>();
  for (const name of properties.keys())
    if (!["alias", "extensions", "mainFields", "conditionNames", "conditions"].includes(name))
      fail(`Unsupported resolve.${name}; supply the selected resolution policy explicitly`);
  const result: ResolverConfig = {
    diagnostics: configuration.has("plugins")
      ? [
          "Toolchain plugins were not executed; their configuration and virtual-module hooks are not represented",
        ]
      : [],
  };
  for (const name of ["extensions", "mainFields", "conditionNames"] as const) {
    const value = properties.get(name);
    if (value) result[name] = getStrings(value);
  }
  const conditions = properties.get("conditions");
  if (conditions) result.conditions = getStrings(conditions);
  let aliases = properties.get("alias") ?? configuration.get("alias");
  const turbopack = configuration.get("turbopack");
  const experimental = configuration.get("experimental");
  const turbo = experimental && getProperties(experimental).get("turbo");
  if (turbopack || turbo) {
    const turboConfig = turbopack ?? turbo;
    if (turboConfig) aliases = getProperties(turboConfig).get("resolveAlias") ?? aliases;
  }
  if (aliases) {
    const alias = new Map<string, Array<string | null>>();
    const getTargets = (expression: ts.Expression) => {
      const value = unwrap(expression);
      if (
        /^(vite|esbuild)\.config\./.test(basename(configFile)) &&
        (value.kind === ts.SyntaxKind.FalseKeyword || ts.isArrayLiteralExpression(value))
      )
        return fail("This toolchain requires a string alias replacement");
      if (value.kind === ts.SyntaxKind.FalseKeyword) return [null];
      return ts.isArrayLiteralExpression(value)
        ? value.elements.map((element) =>
            unwrap(element).kind === ts.SyntaxKind.FalseKeyword ? null : getString(element),
          )
        : [getString(value)];
    };
    const value = unwrap(aliases);
    if (ts.isArrayLiteralExpression(value)) {
      for (const entry of value.elements) {
        const entryProperties = getProperties(entry);
        if (entryProperties.has("customResolver"))
          return fail("Alias custom resolvers require their owning toolchain");
        const find = entryProperties.get("find");
        const replacement = entryProperties.get("replacement");
        if (!find || !replacement) return fail("Alias entries require find and replacement");
        const name = getString(find);
        if (alias.has(name)) return fail(`Duplicate ordered alias: ${name}`);
        alias.set(name, getTargets(replacement));
      }
    } else {
      for (const [name, target] of getProperties(value)) alias.set(name, getTargets(target));
    }
    result.alias = Object.fromEntries(alias);
    result.aliasOrder = [...alias.keys()];
    if (/^(vite|esbuild)\.config\./.test(basename(configFile))) {
      result.literalAliases = true;
      result.recursiveAliases = false;
    }
    if (basename(configFile).startsWith("esbuild.config.")) {
      result.aliasOrder.sort((first, second) => second.length - first.length);
      const workingDirectory = configuration.get("absWorkingDir");
      result.aliasDirectory = workingDirectory ? getString(workingDirectory) : projectDirectory;
      if (!isAbsolute(result.aliasDirectory)) return fail("absWorkingDir must be absolute");
    }
    if (turbopack || turbo) result.aliasDirectory = projectDirectory;
  }
  return result;
};
