import { readFileSync } from "node:fs";
import type { Expression, Program } from "@oxc-project/types";
import { parseSync } from "oxc-parser";
import { parseWithSchema } from "../errors.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { isStringLiteralNode, someNode, unwrapExpression } from "../parse/ast-walk.js";
import { getSourceLanguage } from "../parse/parse-source-file.js";
import type { JsonValue, SourceTransform } from "../types.js";
import { findViteConfig } from "./module-transpiler.js";
import { applyTransformHooks, loadWithoutDom, vitePluginsSchema } from "./vite-plugins.js";

const PLUGIN_ENTRY = "@tanstack/router-plugin/vite";
const PLUGIN_FACTORIES = new Set(["tanstackRouter", "TanStackRouterVite"]);

interface PluginCall {
  exportName: string;
  options: JsonValue | undefined;
}

const readJsonLiteral = (node: Expression): JsonValue | undefined => {
  const expression = unwrapExpression(node);
  switch (expression.type) {
    case "Literal":
      return typeof expression.value === "bigint" || expression.value instanceof RegExp
        ? undefined
        : expression.value;
    case "TemplateLiteral":
      return expression.expressions.length === 0
        ? (expression.quasis[0]?.value.cooked ?? undefined)
        : undefined;
    case "ArrayExpression": {
      const items: JsonValue[] = [];
      for (const element of expression.elements) {
        if (element === null || element.type === "SpreadElement") return undefined;
        const item = readJsonLiteral(element);
        if (item === undefined) return undefined;
        items.push(item);
      }
      return items;
    }
    case "ObjectExpression": {
      const record: Record<string, JsonValue> = {};
      for (const property of expression.properties) {
        if (property.type !== "Property" || property.computed || property.kind !== "init") {
          return undefined;
        }
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : isStringLiteralNode(property.key)
              ? property.key.value
              : undefined;
        const value = key === undefined ? undefined : readJsonLiteral(property.value);
        if (key === undefined || value === undefined) return undefined;
        record[key] = value;
      }
      return record;
    }
    default:
      return undefined;
  }
};

/** The `tanstackRouter(...)` call in the Vite config, with its options when they are literal. */
const findPluginCall = (program: Program): PluginCall | null => {
  const factoryByLocalName = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== PLUGIN_ENTRY) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== "ImportSpecifier") continue;
      const importedName =
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value;
      if (PLUGIN_FACTORIES.has(importedName)) {
        factoryByLocalName.set(specifier.local.name, importedName);
      }
    }
  }
  if (factoryByLocalName.size === 0) return null;
  let pluginCall: PluginCall | null = null;
  someNode(program, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return false;
    const exportName = factoryByLocalName.get(node.callee.name);
    if (exportName === undefined) return false;
    const [argument] = node.arguments;
    if (argument === undefined) {
      pluginCall = { exportName, options: undefined };
      return true;
    }
    if (argument.type === "SpreadElement") return true;
    const options = readJsonLiteral(argument);
    if (options !== undefined) pluginCall = { exportName, options };
    return true;
  });
  return pluginCall;
};

/**
 * `@tanstack/router-plugin` rewrites route files before the JSX transform:
 * inline route options become hoisted `TSR*` bindings, and with
 * `autoCodeSplitting` a route's component moves into a `?tsr-split` virtual
 * module loaded through `lazyRouteComponent`. The app's installed plugin is
 * run the way Vite runs it, so the modules analyzed are the ones served.
 */
export const createTanStackRouterTransform = async (
  rootDirectory: string,
): Promise<SourceTransform | null> => {
  const configPath = findViteConfig(rootDirectory);
  if (configPath === undefined) return null;
  const { program } = parseSync(configPath, readFileSync(configPath, "utf8"), {
    sourceType: "module",
  });
  const pluginCall = findPluginCall(program);
  if (!pluginCall) return null;
  const pluginModule = await loadWithoutDom(() =>
    getInstalledModules(rootDirectory).load(PLUGIN_ENTRY),
  );
  const factory: unknown = pluginModule && Reflect.get(pluginModule, pluginCall.exportName);
  if (typeof factory !== "function") return null;
  const plugins = parseWithSchema(
    vitePluginsSchema,
    Reflect.apply(
      factory,
      pluginModule,
      pluginCall.options === undefined ? [] : [pluginCall.options],
    ),
    `${PLUGIN_ENTRY} ${pluginCall.exportName}()`,
  );
  const config = { root: rootDirectory, command: "serve", plugins };
  for (const plugin of plugins) await plugin.configResolved?.(config);
  return {
    appliesTo: (_extension, lang) => lang !== null,
    transform: (filePath, sourceText, query) => {
      const lang = getSourceLanguage(filePath);
      return lang
        ? applyTransformHooks(plugins, rootDirectory, filePath, sourceText, query, lang)
        : null;
    },
  };
};
