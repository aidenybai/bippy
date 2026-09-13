import path from "node:path";
import type {
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  TaggedTemplateExpression,
} from "oxc-parser";
import { forEachChildNode } from "../parse/ast-walk.js";
import type { ModuleRecord, StyledComponentsTransformOptions } from "../types.js";

export const STYLED_COMPONENTS_MACRO_SPECIFIER = "styled-components/macro";

export const DEFAULT_STYLED_COMPONENTS_TRANSFORM: StyledComponentsTransformOptions = {
  fileName: true,
  meaninglessFileNames: ["index"],
  topLevelImportPaths: [],
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
