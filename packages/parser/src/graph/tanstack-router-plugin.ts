import { readFileSync } from "node:fs";
import path from "node:path";
import type { Expression, Program } from "@oxc-project/types";
import { parseSync } from "oxc-parser";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { isStringLiteralNode, someNode, unwrapExpression } from "../parse/ast-walk.js";
import { getSourceLanguage } from "../parse/parse-source-file.js";
import type { JsonValue, SourceTransform, TransformedSource } from "../types.js";
import { findViteConfig } from "./module-transpiler.js";

const PLUGIN_ENTRY = "@tanstack/router-plugin/vite";
const PLUGIN_FACTORIES = new Set(["tanstackRouter", "TanStackRouterVite"]);

const functionSchema = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === "function",
);
const patternSchema = z.union([z.string(), z.instanceof(RegExp)]);
const patternFilterSchema = z.union([
  patternSchema,
  z.array(patternSchema),
  z.object({
    include: z.union([patternSchema, z.array(patternSchema)]).optional(),
    exclude: z.union([patternSchema, z.array(patternSchema)]).optional(),
  }),
]);
const transformHookSchema = z.union([
  functionSchema,
  z.object({
    filter: z
      .object({ id: patternFilterSchema.optional(), code: patternFilterSchema.optional() })
      .optional(),
    handler: functionSchema,
  }),
]);
const vitePluginSchema = z.object({
  name: z.string(),
  configResolved: functionSchema.optional(),
  transform: transformHookSchema.optional(),
});
const vitePluginsSchema = z.array(vitePluginSchema);
const transformResultSchema = z.union([
  z.string(),
  z.object({ code: z.string() }),
  z.null(),
  z.undefined(),
]);

type Pattern = z.infer<typeof patternSchema>;
type PatternFilter = z.infer<typeof patternFilterSchema>;
type VitePlugin = z.infer<typeof vitePluginSchema>;

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

const toPatternList = (filter: PatternFilter): { include?: Pattern[]; exclude?: Pattern[] } => {
  if (typeof filter === "string" || filter instanceof RegExp) return { include: [filter] };
  if (Array.isArray(filter)) return { include: filter };
  return {
    include: filter.include === undefined ? undefined : [filter.include].flat(),
    exclude: filter.exclude === undefined ? undefined : [filter.exclude].flat(),
  };
};

const testRegExp = (pattern: RegExp, input: string): boolean => {
  const isMatch = pattern.test(input);
  pattern.lastIndex = 0;
  return isMatch;
};

/** Vite's hook filter: excluded patterns win, then any included pattern must match when some are given. */
const matchesFilter = (
  filter: PatternFilter,
  input: string,
  matchesString: (pattern: string) => boolean,
): boolean => {
  const { include, exclude } = toPatternList(filter);
  const matches = (pattern: Pattern): boolean =>
    pattern instanceof RegExp ? testRegExp(pattern, input) : matchesString(pattern);
  if (exclude?.some(matches)) return false;
  if (include?.some(matches)) return true;
  return !(include && include.length > 0);
};

const matchesIdGlob = (id: string, glob: string, rootDirectory: string): boolean =>
  path.matchesGlob(
    id,
    glob.startsWith("**") || path.isAbsolute(glob) ? glob : path.join(rootDirectory, glob),
  );

const applyTransformHooks = (
  plugins: VitePlugin[],
  rootDirectory: string,
  filePath: string,
  sourceText: string,
  query: string | null,
): TransformedSource | null => {
  const lang = getSourceLanguage(filePath);
  if (!lang) return null;
  const id = query === null ? filePath : `${filePath}?${query}`;
  let code = sourceText;
  let isTransformed = false;
  for (const plugin of plugins) {
    const hook = plugin.transform;
    if (!hook) continue;
    const { filter, handler } = typeof hook === "function" ? { handler: hook } : hook;
    if (
      filter?.id !== undefined &&
      !matchesFilter(filter.id, id, (glob) => matchesIdGlob(id, glob, rootDirectory))
    ) {
      continue;
    }
    if (
      filter?.code !== undefined &&
      !matchesFilter(filter.code, code, (needle) => code.includes(needle))
    ) {
      continue;
    }
    const result = parseWithSchema(
      transformResultSchema,
      handler.call({}, code, id),
      `${plugin.name} transform of ${id}`,
    );
    if (result === null || result === undefined) continue;
    code = typeof result === "string" ? result : result.code;
    isTransformed = true;
  }
  return isTransformed ? { sourceText: code, lang } : null;
};

// HACK: bundled build tooling picks its Node or browser module shims by whether
// `document` exists, and a DOM is installed here for materialization; the
// plugin is a Node program, so it loads without one.
const loadWithoutDom = <Loaded>(load: () => Loaded): Loaded => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  if (!documentDescriptor?.configurable) return load();
  Reflect.deleteProperty(globalThis, "document");
  try {
    return load();
  } finally {
    Object.defineProperty(globalThis, "document", documentDescriptor);
  }
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
  const pluginModule = loadWithoutDom(() => getInstalledModules(rootDirectory).load(PLUGIN_ENTRY));
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
    extension: null,
    transform: (filePath, sourceText, query) =>
      applyTransformHooks(plugins, rootDirectory, filePath, sourceText, query),
  };
};
