import path from "node:path";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { isEngineGlobal } from "../evaluate/host-globals.js";
import { loadHostRealm } from "../host/host-realm.js";
import type { SourceLanguage, TransformedSource } from "../types.js";

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
const htmlHookOrderSchema = z.enum(["pre", "post"]).nullish();
const htmlHookSchema = z.union([
  functionSchema,
  z.object({
    order: htmlHookOrderSchema,
    enforce: htmlHookOrderSchema,
    handler: functionSchema,
  }),
  z.object({
    order: htmlHookOrderSchema,
    enforce: htmlHookOrderSchema,
    transform: functionSchema,
  }),
]);
export const vitePluginSchema = z.object({
  name: z.string(),
  configResolved: functionSchema.optional(),
  transform: transformHookSchema.optional(),
  transformIndexHtml: htmlHookSchema.optional(),
});
export const vitePluginsSchema = z.array(vitePluginSchema);
const transformResultSchema = z.union([
  z.string(),
  z.object({ code: z.string() }),
  z.null(),
  z.undefined(),
]);

const htmlTagSchema: z.ZodType<HtmlTagDescriptor> = z.lazy(() =>
  z.object({
    tag: z.string(),
    attrs: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
    children: z.union([z.string(), z.array(htmlTagSchema)]).optional(),
    injectTo: z.enum(["head", "body", "head-prepend", "body-prepend"]).optional(),
  }),
);
const htmlTransformResultSchema = z.union([
  z.string(),
  z.array(htmlTagSchema),
  z.object({ html: z.string().optional(), tags: z.array(htmlTagSchema) }),
  z.null(),
  z.undefined(),
]);

/** Vite's `HtmlTagDescriptor`: a tag a `transformIndexHtml` hook asks to inject. */
export interface HtmlTagDescriptor {
  tag: string;
  attrs?: Record<string, string | boolean>;
  children?: string | HtmlTagDescriptor[];
  injectTo?: "head" | "body" | "head-prepend" | "body-prepend";
}

/** Vite's `IndexHtmlTransformContext` for a dev page request; the server exposes the resolved config hooks read (`@vitejs/plugin-react` takes `base` from `server.config`). */
export interface HtmlTransformContext {
  path: string;
  filename: string;
  server: { config: object };
  originalUrl: string;
}

type Pattern = z.infer<typeof patternSchema>;
type PatternFilter = z.infer<typeof patternFilterSchema>;
export type VitePlugin = z.infer<typeof vitePluginSchema>;

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

/**
 * The plugins' `transform` hooks in order, as the dev server chains them on a
 * module; `lang` is the language of the module they produce. A hook answering
 * asynchronously is not awaited: the module then stays one only the bundler
 * can load.
 */
export const applyTransformHooks = (
  plugins: VitePlugin[],
  rootDirectory: string,
  filePath: string,
  sourceText: string,
  query: string | null,
  lang: SourceLanguage,
): TransformedSource | null => {
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
    const answer = handler.call({}, code, id);
    if (answer instanceof Promise) {
      answer.catch(() => undefined);
      return null;
    }
    const result = parseWithSchema(
      transformResultSchema,
      answer,
      `${plugin.name} transform of ${id}`,
    );
    if (result === null || result === undefined) continue;
    code = typeof result === "string" ? result : result.code;
    isTransformed = true;
  }
  return isTransformed ? { sourceText: code, lang } : null;
};

const UNARY_TAGS = new Set(["link", "meta", "base"]);
const HEAD_INJECT = /<\/head>/i;
const HEAD_PREPEND_INJECT = /<head[^>]*>/i;
const HTML_INJECT = /<\/html>/i;
const HTML_PREPEND_INJECT = /<html[^>]*>/i;
const BODY_INJECT = /<\/body>/i;
const BODY_PREPEND_INJECT = /<body[^>]*>/i;
const DOCTYPE_PREPEND_INJECT = /<!doctype html>/i;

const escapeHtml = (text: string): string =>
  text.replace(/["&'<>]/g, (character) => `&#${character.charCodeAt(0)};`);

const serializeAttrs = (attrs: Record<string, string | boolean> = {}): string =>
  Object.entries(attrs)
    .map(([key, value]) =>
      typeof value === "boolean" ? (value ? ` ${key}` : "") : ` ${key}="${escapeHtml(value)}"`,
    )
    .join("");

const serializeTags = (tags: string | HtmlTagDescriptor[] = []): string =>
  typeof tags === "string"
    ? tags
    : tags
        .map(({ tag, attrs, children }) =>
          UNARY_TAGS.has(tag)
            ? `<${tag}${serializeAttrs(attrs)}>\n`
            : `<${tag}${serializeAttrs(attrs)}>${serializeTags(children)}</${tag}>\n`,
        )
        .join("");

const insertBefore = (html: string, pattern: RegExp, markup: string): string =>
  html.replace(pattern, (match) => `${markup}${match}`);
const insertAfter = (html: string, pattern: RegExp, markup: string): string =>
  html.replace(pattern, (match) => `${match}\n${markup}`);

const prependFallback = (html: string, markup: string): string => {
  if (HTML_PREPEND_INJECT.test(html)) return insertAfter(html, HTML_PREPEND_INJECT, markup);
  if (DOCTYPE_PREPEND_INJECT.test(html)) return insertAfter(html, DOCTYPE_PREPEND_INJECT, markup);
  return markup + html;
};

/** Vite's `injectToHead`/`injectToBody`: where each `injectTo` lands, with the same fallbacks for partial documents. */
const injectTags = (
  html: string,
  injectTo: NonNullable<HtmlTagDescriptor["injectTo"]>,
  tags: HtmlTagDescriptor[],
): string => {
  if (tags.length === 0) return html;
  const markup = serializeTags(tags);
  switch (injectTo) {
    case "head-prepend":
      if (HEAD_PREPEND_INJECT.test(html)) return insertAfter(html, HEAD_PREPEND_INJECT, markup);
      return prependFallback(html, markup);
    case "head":
      if (HEAD_INJECT.test(html)) return insertBefore(html, HEAD_INJECT, markup);
      if (BODY_PREPEND_INJECT.test(html)) return insertBefore(html, BODY_PREPEND_INJECT, markup);
      return prependFallback(html, markup);
    case "body-prepend":
      if (BODY_PREPEND_INJECT.test(html)) return insertAfter(html, BODY_PREPEND_INJECT, markup);
      if (HEAD_INJECT.test(html)) return insertAfter(html, HEAD_INJECT, markup);
      return prependFallback(html, markup);
    case "body":
      if (BODY_INJECT.test(html)) return insertBefore(html, BODY_INJECT, markup);
      if (HTML_INJECT.test(html)) return insertBefore(html, HTML_INJECT, `${markup}\n`);
      return `${html}\n${markup}`;
  }
};

const INJECTION_ORDER = ["head-prepend", "head", "body-prepend", "body"] as const;

/**
 * The plugins' `transformIndexHtml` hooks in Vite's order (`pre`, plain, then
 * `post`) applied to the page as the dev server does before serving it: a
 * string replaces the page, tag descriptors are injected where `injectTo`
 * says (the head by default). The deprecated `enforce`/`transform` spelling
 * orders like Vite's `resolveHtmlTransforms`: only `enforce: "pre"` moves a hook.
 */
export const applyHtmlTransformHooks = async (
  plugins: VitePlugin[],
  html: string,
  context: HtmlTransformContext,
): Promise<string> => {
  const hooks = plugins.flatMap((plugin) => {
    const hook = plugin.transformIndexHtml;
    if (!hook) return [];
    if (typeof hook === "function") return [{ order: null, handler: hook, name: plugin.name }];
    const order = hook.order ?? (hook.enforce === "pre" ? "pre" : null);
    const handler = "handler" in hook ? hook.handler : hook.transform;
    return [{ order, handler, name: plugin.name }];
  });
  const ordered = [
    ...hooks.filter((hook) => hook.order === "pre"),
    ...hooks.filter((hook) => hook.order === null),
    ...hooks.filter((hook) => hook.order === "post"),
  ];
  let page = html;
  for (const { handler, name } of ordered) {
    const result = parseWithSchema(
      htmlTransformResultSchema,
      await handler.call({}, page, context),
      `${name} transformIndexHtml of ${context.filename}`,
    );
    if (result === null || result === undefined) continue;
    if (typeof result === "string") {
      page = result;
      continue;
    }
    const tags = Array.isArray(result) ? result : result.tags;
    if (!Array.isArray(result) && result.html !== undefined) page = result.html;
    for (const injectTo of INJECTION_ORDER) {
      page = injectTags(
        page,
        injectTo,
        tags.filter((tag) => (tag.injectTo ?? "head-prepend") === injectTo),
      );
    }
  }
  return page;
};

/** Runs `load` as a dev server started in `directory` would: plugins (`@lingui/vite-plugin`, cosmiconfig-based ones) search their own config from `process.cwd()`. */
export const loadFromDirectory = async <Loaded>(
  directory: string,
  load: () => Loaded | Promise<Loaded>,
): Promise<Loaded> => {
  const previousDirectory = process.cwd();
  process.chdir(directory);
  try {
    return await load();
  } finally {
    process.chdir(previousDirectory);
  }
};

// HACK: bundled build tooling picks its Node or browser module shims from
// `window`/`document`, and a DOM is installed here for materialization; the
// tooling is a Node program, so every global Node lacks is absent while it loads.
export const loadWithoutDom = async <Loaded>(
  load: () => Loaded | Promise<Loaded>,
): Promise<Loaded> => {
  const nodeRealm = loadHostRealm("node");
  const removedGlobals = new Map<string, PropertyDescriptor>();
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (
      descriptor?.configurable !== true ||
      isEngineGlobal(name) ||
      !nodeRealm.isForeignGlobal(name)
    )
      continue;
    removedGlobals.set(name, descriptor);
    Reflect.deleteProperty(globalThis, name);
  }
  try {
    return await load();
  } finally {
    for (const [name, descriptor] of removedGlobals) {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
};
