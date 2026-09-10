import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Interpreter } from "../evaluate/interpreter.js";
import { awaitedValue } from "../evaluate/promises.js";
import { getObjectProperty, primitiveValue, toJsonValue } from "../evaluate/values.js";
import { getDefaultExport } from "../libraries/installed-modules.js";
import type { JsonValue, ModuleRecord, StaticValue } from "../types.js";

const REMIX_DEV_PACKAGE = "@remix-run/dev";
const MDX_COMPILER_PACKAGE = "xdm";
const FRONTMATTER_PLUGIN_PACKAGE = "remark-frontmatter";
const MDX_FRONTMATTER_PLUGIN_PACKAGE = "remark-mdx-frontmatter";
const MDX_FRONTMATTER_EXPORT = "remarkMdxFrontmatter";

const compiledMdxSchema = z.object({ value: z.union([z.string(), z.instanceof(Uint8Array)]) });

/** A remark/rehype plugin as `remix.config.js` names it: an import plus the options `[plugin, ...options]` passes. */
export interface MdxPluginSpec {
  packageName: string;
  importedName: string;
  options: JsonValue[];
}

export interface MdxPluginSpecs {
  remarkPlugins: MdxPluginSpec[];
  rehypePlugins: MdxPluginSpec[];
}

/** Mirrors the module `@remix-run/dev`'s `mdxPlugin` emits for a `.mdx` route: the compiled content plus the route exports it appends. */
const remixRouteExports = (routeFile: string): string => `
export const filename = ${JSON.stringify(path.basename(routeFile))};
export const headers = typeof attributes !== "undefined" && attributes.headers;
export const meta = typeof attributes !== "undefined" && attributes.meta;
export const handle = typeof attributes !== "undefined" && attributes.handle;
`;

const toPluginSpec = (value: StaticValue): MdxPluginSpec | null => {
  if (value.kind === "external") {
    return { packageName: value.packageName, importedName: value.importedName, options: [] };
  }
  if (value.kind !== "list" || value.items[0]?.kind !== "external") return null;
  const [plugin, ...optionValues] = value.items;
  const options: JsonValue[] = [];
  for (const optionValue of optionValues) {
    const option = toJsonValue(optionValue);
    if (option === undefined) return null;
    options.push(option);
  }
  return { packageName: plugin.packageName, importedName: plugin.importedName, options };
};

const toPluginSpecs = (value: StaticValue): MdxPluginSpec[] | null => {
  if (value.kind === "primitive" && value.value === undefined) return [];
  if (value.kind !== "list") return null;
  const specs: MdxPluginSpec[] = [];
  for (const item of value.items) {
    const spec = toPluginSpec(item);
    if (!spec) return null;
    specs.push(spec);
  }
  return specs;
};

/**
 * The plugins `remix.config.js`'s `mdx` option configures for `routeFile`:
 * plugin lists, or a function of the route file returning them (possibly
 * asynchronously); `null` when the config is not statically known.
 */
export const readMdxPluginSpecs = (
  interpreter: Interpreter,
  configModule: ModuleRecord,
  routeFile: string,
): MdxPluginSpecs | null => {
  const config = interpreter.evaluateModuleExport(configModule, "default");
  if (config.kind !== "object") return null;
  const mdxOption = getObjectProperty(config, "mdx");
  const mdxConfig =
    mdxOption.kind === "function" || mdxOption.kind === "native-function"
      ? awaitedValue(
          interpreter.callValue(
            mdxOption,
            [primitiveValue(routeFile)],
            interpreter.createModuleContext(configModule),
            null,
          ),
          null,
          () => interpreter.timers.drainMicrotasks(),
        )
      : mdxOption;
  if (mdxConfig.kind === "primitive" && mdxConfig.value === undefined) {
    return { remarkPlugins: [], rehypePlugins: [] };
  }
  if (mdxConfig.kind !== "object") return null;
  const remarkPlugins = toPluginSpecs(getObjectProperty(mdxConfig, "remarkPlugins"));
  const rehypePlugins = toPluginSpecs(getObjectProperty(mdxConfig, "rehypePlugins"));
  return remarkPlugins && rehypePlugins ? { remarkPlugins, rehypePlugins } : null;
};

const isPlugin = (plugin: unknown): boolean =>
  typeof plugin === "function" || (Array.isArray(plugin) && typeof plugin[0] === "function");

const importInstalled = async (
  requireFrom: NodeJS.Require,
  packageName: string,
): Promise<object | null> => {
  let filePath: string;
  try {
    filePath = requireFrom.resolve(packageName);
  } catch {
    return null;
  }
  const namespace: unknown = await import(pathToFileURL(filePath).href);
  return typeof namespace === "object" && namespace !== null ? namespace : null;
};

const loadPlugin = async (
  requireFrom: NodeJS.Require,
  spec: MdxPluginSpec,
): Promise<unknown | null> => {
  const module = await importInstalled(requireFrom, spec.packageName);
  const plugin =
    module &&
    (spec.importedName === "default" ? getDefaultExport(module) : Reflect.get(module, spec.importedName));
  if (!isPlugin(plugin)) return null;
  return spec.options.length === 0 ? plugin : [plugin, ...spec.options];
};

const loadPlugins = async (
  requireFrom: NodeJS.Require,
  specs: MdxPluginSpec[],
): Promise<unknown[] | null> => {
  const plugins = await Promise.all(specs.map((spec) => loadPlugin(requireFrom, spec)));
  return plugins.every((plugin) => plugin !== null) ? plugins : null;
};

/**
 * The module the classic Remix compiler builds for a `.mdx` route, compiled by
 * the project's installed `xdm` with the same options and plugins as
 * `@remix-run/dev`'s `mdxPlugin`; `null` when the compiler or a configured
 * plugin is not installed, or the content does not compile.
 */
export const compileRemixMdxRoute = async (
  rootDirectory: string,
  specs: MdxPluginSpecs,
  routeFile: string,
  sourceText: string,
): Promise<string | null> => {
  const requireFromRoot = createRequire(path.join(rootDirectory, "package.json"));
  let remixDevPath: string;
  try {
    remixDevPath = requireFromRoot.resolve(REMIX_DEV_PACKAGE);
  } catch {
    return null;
  }
  const requireBesideRemix = createRequire(remixDevPath);
  const [compiler, frontmatterModule, mdxFrontmatterModule, remarkPlugins, rehypePlugins] =
    await Promise.all([
      importInstalled(requireBesideRemix, MDX_COMPILER_PACKAGE),
      importInstalled(requireBesideRemix, FRONTMATTER_PLUGIN_PACKAGE),
      importInstalled(requireBesideRemix, MDX_FRONTMATTER_PLUGIN_PACKAGE),
      loadPlugins(requireFromRoot, specs.remarkPlugins),
      loadPlugins(requireFromRoot, specs.rehypePlugins),
    ]);
  const compileSync = compiler && Reflect.get(compiler, "compileSync");
  const frontmatter = frontmatterModule && getDefaultExport(frontmatterModule);
  const mdxFrontmatter =
    mdxFrontmatterModule && Reflect.get(mdxFrontmatterModule, MDX_FRONTMATTER_EXPORT);
  if (
    typeof compileSync !== "function" ||
    !isPlugin(frontmatter) ||
    !isPlugin(mdxFrontmatter) ||
    !remarkPlugins ||
    !rehypePlugins
  ) {
    return null;
  }
  let output: unknown;
  try {
    output = Reflect.apply(compileSync, compiler, [
      sourceText,
      {
        jsx: true,
        jsxRuntime: "classic",
        pragma: "React.createElement",
        pragmaFrag: "React.Fragment",
        rehypePlugins,
        remarkPlugins: [frontmatter, [mdxFrontmatter, { name: "attributes" }], ...remarkPlugins],
      },
    ]);
  } catch {
    return null;
  }
  const compiled = compiledMdxSchema.safeParse(output);
  if (!compiled.success) return null;
  const { value } = compiled.data;
  const compiledText = typeof value === "string" ? value : new TextDecoder().decode(value);
  return `${compiledText}\n${remixRouteExports(routeFile)}`;
};
