import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  TaggedTemplateExpression,
} from "oxc-parser";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { forEachChildNode } from "../parse/ast-walk.js";
import type { ModuleRecord, StaticValue, StyledComponentsTransformOptions } from "../types.js";
import {
  getObjectProperty,
  getTruthiness,
  isKnownString,
  jsonValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

export const STYLED_COMPONENTS_MACRO_SPECIFIER = "styled-components/macro";

/** The babel-plugin-macros config key `styled-components/macro` reads its plugin options from. */
export const STYLED_COMPONENTS_MACRO_CONFIG_NAME = "styledComponents";

export const DEFAULT_STYLED_COMPONENTS_TRANSFORM: StyledComponentsTransformOptions = {
  fileName: true,
  meaninglessFileNames: ["index"],
  topLevelImportPaths: [],
};

/**
 * The macro adds `styled-components` (its `importModuleName`) to the plugin's
 * `topLevelImportPaths` after rewriting the macro import to it; the static side
 * still sees the macro specifier, so both name styled calls.
 */
export const styledComponentsMacroTransform = (
  options: StyledComponentsTransformOptions,
): StyledComponentsTransformOptions => ({
  ...options,
  topLevelImportPaths: [
    ...options.topLevelImportPaths,
    "styled-components",
    STYLED_COMPONENTS_MACRO_SPECIFIER,
  ],
});

// babel-plugin-macros resolves its config with cosmiconfig from the compiled
// file's directory upward: `babelMacros` in package.json, then the rc files
// (YAML for the bare and .yaml/.yml names, JSON for .json, a module for .js).
const BABEL_MACROS_PACKAGE_PROP = "babelMacros";
const BABEL_MACROS_DATA_CONFIG_FILES = [
  ".babel-plugin-macrosrc",
  ".babel-plugin-macrosrc.json",
  ".babel-plugin-macrosrc.yaml",
  ".babel-plugin-macrosrc.yml",
];
const BABEL_MACROS_MODULE_CONFIG_FILES = [
  ".babel-plugin-macrosrc.js",
  "babel-plugin-macros.config.js",
];

const packageMacrosSchema = z.object({ [BABEL_MACROS_PACKAGE_PROP]: z.json().optional() });

export interface BabelMacrosDataConfig {
  kind: "data";
  filePath: string;
  option: StaticValue;
}

export interface BabelMacrosModuleConfig {
  kind: "module";
  filePath: string;
}

export type BabelMacrosConfig = BabelMacrosDataConfig | BabelMacrosModuleConfig;

const readJsonConfigOption = (filePath: string): StaticValue => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return unknownValue(`${path.basename(filePath)} is not JSON (YAML configs are not read)`);
  }
  return jsonValue(parseWithSchema(z.json(), parsed, filePath));
};

const readPackageMacrosOption = (packageJsonPath: string): StaticValue | undefined => {
  const manifest = parseWithSchema(
    packageMacrosSchema,
    JSON.parse(readFileSync(packageJsonPath, "utf8")),
    packageJsonPath,
  );
  const macros = manifest[BABEL_MACROS_PACKAGE_PROP];
  return macros === undefined ? undefined : jsonValue(macros);
};

export const readStyledMacroOption = (config: StaticValue): StaticValue =>
  config.kind === "object"
    ? getObjectProperty(config, STYLED_COMPONENTS_MACRO_CONFIG_NAME)
    : config.kind === "primitive"
      ? UNDEFINED_VALUE
      : config;

/** The babel-plugin-macros config governing a compiled file, searched upward to the project root as cosmiconfig does. */
export const findBabelMacrosConfig = (
  filePath: string,
  stopDirectory: string,
): BabelMacrosConfig | null => {
  let directory = path.dirname(filePath);
  for (;;) {
    const packageJsonPath = path.join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const option = readPackageMacrosOption(packageJsonPath);
      if (option !== undefined) {
        return { kind: "data", filePath: packageJsonPath, option: readStyledMacroOption(option) };
      }
    }
    for (const fileName of BABEL_MACROS_DATA_CONFIG_FILES) {
      const configPath = path.join(directory, fileName);
      if (existsSync(configPath)) {
        return {
          kind: "data",
          filePath: configPath,
          option: readStyledMacroOption(readJsonConfigOption(configPath)),
        };
      }
    }
    for (const fileName of BABEL_MACROS_MODULE_CONFIG_FILES) {
      const configPath = path.join(directory, fileName);
      if (existsSync(configPath)) return { kind: "module", filePath: configPath };
    }
    if (directory === stopDirectory || path.dirname(directory) === directory) return null;
    directory = path.dirname(directory);
  }
};

const readBoolean = (value: StaticValue, fallback: boolean): boolean | null => {
  if (value.kind === "primitive" && value.value === undefined) return fallback;
  return getTruthiness(value);
};

const readStringList = (value: StaticValue, fallback: string[]): string[] | null => {
  if (value.kind === "primitive" && value.value === undefined) return fallback;
  if (value.kind !== "list") return null;
  const strings = value.items.flatMap((item) => (isKnownString(item) ? [item.value] : []));
  return strings.length === value.items.length ? strings : null;
};

/**
 * babel-plugin-styled-components' options as a config object declares them
 * (`displayName` on by default, as in development); `null` when the transform
 * names nothing, `undefined` when the analysis cannot read them.
 */
export const readStyledComponentsOption = (
  option: StaticValue,
): StyledComponentsTransformOptions | null | undefined => {
  if (option.kind !== "object") {
    const isEnabled = getTruthiness(option);
    if (isEnabled === null) return undefined;
    return isEnabled ? DEFAULT_STYLED_COMPONENTS_TRANSFORM : null;
  }
  const defaults = DEFAULT_STYLED_COMPONENTS_TRANSFORM;
  const displayName = readBoolean(getObjectProperty(option, "displayName"), true);
  const fileName = readBoolean(getObjectProperty(option, "fileName"), defaults.fileName);
  const meaninglessFileNames = readStringList(
    getObjectProperty(option, "meaninglessFileNames"),
    defaults.meaninglessFileNames,
  );
  const topLevelImportPaths = readStringList(
    getObjectProperty(option, "topLevelImportPaths"),
    defaults.topLevelImportPaths,
  );
  if (displayName === null || fileName === null || !meaninglessFileNames || !topLevelImportPaths) {
    return undefined;
  }
  return displayName ? { fileName, meaninglessFileNames, topLevelImportPaths } : null;
};

const HELPER_EXPORTS = [
  "css",
  "createGlobalStyle",
  "injectGlobal",
  "useTheme",
  "keyframes",
  "withTheme",
];

const IDENTITY_CONFIG_KEYS = new Set(["displayName", "componentId"]);

interface StyledImports {
  styledLocalName: string;
  helperLocalNames: Set<string>;
}

const isStyledSpecifier = (
  specifier: string,
  options: StyledComponentsTransformOptions,
): boolean =>
  options.topLevelImportPaths.length > 0
    ? options.topLevelImportPaths.includes(specifier)
    : specifier === "styled-components" || specifier.startsWith("styled-components/");

const collectStyledImports = (
  module: ModuleRecord,
  options: StyledComponentsTransformOptions,
): StyledImports | null => {
  let defaultLocalName: string | null = null;
  let namedDefaultLocalName: string | null = null;
  let namedStyledLocalName: string | null = null;
  let namespaceLocalName: string | null = null;
  const helperLocalNames = new Set<string>();
  for (const binding of module.imports) {
    if (binding.isTypeOnly || !isStyledSpecifier(binding.specifier, options)) continue;
    switch (binding.imported.kind) {
      case "default":
        defaultLocalName = binding.localName;
        break;
      case "namespace":
        namespaceLocalName = binding.localName;
        break;
      case "named":
        if (binding.imported.name === "default") namedDefaultLocalName = binding.localName;
        else if (binding.imported.name === "styled") namedStyledLocalName = binding.localName;
        else if (HELPER_EXPORTS.includes(binding.imported.name)) {
          helperLocalNames.add(binding.localName);
        }
        break;
    }
  }
  if (namespaceLocalName !== null) for (const name of HELPER_EXPORTS) helperLocalNames.add(name);
  const styledLocalName =
    defaultLocalName ?? namedDefaultLocalName ?? namedStyledLocalName ?? namespaceLocalName;
  return styledLocalName === null ? null : { styledLocalName, helperLocalNames };
};

const getStaticPropertyName = (node: Expression): string | null =>
  node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : null;

const isStyled = (node: Expression, imports: StyledImports): boolean => {
  if (node.type === "CallExpression") {
    if (node.callee.type === "MemberExpression") {
      const propertyName = getStaticPropertyName(node.callee);
      return (
        propertyName !== null && propertyName !== "default" && isStyled(node.callee.object, imports)
      );
    }
    return node.callee.type === "Identifier" && node.callee.name === imports.styledLocalName;
  }
  if (node.type !== "MemberExpression") return false;
  const propertyName = getStaticPropertyName(node);
  return (
    propertyName !== null &&
    node.object.type === "Identifier" &&
    node.object.name === imports.styledLocalName &&
    !imports.helperLocalNames.has(propertyName)
  );
};

const hasIdentityConfig = (config: ObjectExpression): boolean =>
  config.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      property.key.type === "Identifier" &&
      IDENTITY_CONFIG_KEYS.has(property.key.name),
  );

/** `X.withConfig(config)` whose config the transform leaves alone: not an object literal, or one already naming the component. */
const keepsOwnConfig = (callee: Expression): boolean => {
  if (callee.type !== "CallExpression" || getStaticPropertyName(callee.callee) !== "withConfig") {
    return false;
  }
  const [config] = callee.arguments;
  return config?.type !== "ObjectExpression" || hasIdentityConfig(config);
};

const isTransformedStyledCall = (
  node: Node,
  imports: StyledImports,
): node is CallExpression | TaggedTemplateExpression => {
  if (node.type === "TaggedTemplateExpression") return isStyled(node.tag, imports);
  if (node.type !== "CallExpression" || !isStyled(node.callee, imports)) return false;
  return getStaticPropertyName(node.callee) !== "withConfig" && !keepsOwnConfig(node.callee);
};

const getBlockName = (filePath: string, meaninglessFileNames: string[]): string => {
  const stem = path.basename(filePath, path.extname(filePath));
  return meaninglessFileNames.includes(stem)
    ? getBlockName(path.dirname(filePath), meaninglessFileNames)
    : stem;
};

const prefixLeadingDigit = (name: string): string => (/^\d/.test(name) ? `sc-${name}` : name);

const joinDisplayName = (blockName: string | null, componentName: string | null): string => {
  if (blockName === null || componentName === blockName) return componentName ?? "";
  const prefix = prefixLeadingDigit(blockName);
  return componentName === null ? prefix : `${prefix}__${componentName}`;
};

const formatDisplayName = (blockName: string | null, componentName: string | null): string =>
  joinDisplayName(blockName, componentName).replace(/[^_a-zA-Z0-9-]/g, "");

/** The name the transform gives styled calls under `node`: the binding, assignment target or property key they initialize. */
const getDeclaredName = (node: Node, currentName: string | null): string | null => {
  switch (node.type) {
    case "VariableDeclarator":
      return node.id.type === "Identifier" ? node.id.name : null;
    case "AssignmentExpression":
      if (currentName !== null) return currentName;
      if (node.left.type === "Identifier") return node.left.name;
      return node.left.type === "MemberExpression" ? getStaticPropertyName(node.left) : null;
    case "Property":
      if (node.method) return currentName;
      return !node.computed && node.key.type === "Identifier" ? node.key.name : null;
    case "PropertyDefinition":
      return !node.computed && node.key.type === "Identifier" ? node.key.name : null;
    default:
      return currentName;
  }
};

/**
 * Every `styled` call site in `module` the build transform (babel-plugin-styled-components,
 * or swc's port behind Next's `compiler.styledComponents`) names, with the `displayName`
 * it configures: the binding, assignment target or property key the call initializes,
 * prefixed with the file's block name.
 */
export const collectStyledDisplayNames = (
  module: ModuleRecord,
  options: StyledComponentsTransformOptions,
): Map<Node, string> => {
  const displayNames = new Map<Node, string>();
  const imports = collectStyledImports(module, options);
  if (!imports) return displayNames;
  const blockName = options.fileName
    ? getBlockName(module.filePath, options.meaninglessFileNames)
    : null;
  const visit = (node: Node, currentName: string | null): void => {
    const childName = getDeclaredName(node, currentName);
    forEachChildNode(node, (child) => visit(child, childName));
    if (isTransformedStyledCall(node, imports)) {
      displayNames.set(node, formatDisplayName(blockName, currentName));
    }
  };
  visit(module.file.program, null);
  return displayNames;
};
