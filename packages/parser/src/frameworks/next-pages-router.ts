import path from "node:path";
import type { EvaluationContext } from "../evaluate/context.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import {
  FALSE_VALUE,
  branchValue,
  componentReference,
  describeValue,
  getObjectProperty,
  getTruthiness,
  mapValue,
  objectFromRecord,
  objectValue,
  toBooleanValue,
  unknownValue,
} from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import { hasExportedName } from "../graph/module-record.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { ModuleRecord, StaticRenderResult, StaticValue } from "../types.js";
import { applyNextCompilerOptions, evaluateNextConfig } from "./next-config.js";
import { DEFAULT_DOCUMENT_STUB, type NextModel } from "./next-externals.js";
import { element, stubElement } from "../evaluate/stubs.js";
import {
  type DynamicSegment,
  classifySegment,
  findFirstDirectory,
  findRouteFile,
  listRouteFileBaseNames,
  listSubdirectories,
  routeIdFromFile,
  segmentSpecificity,
  splitPathname,
} from "./route-files.js";

interface NextPagesRouteOptions {
  /** URL pathname to render, e.g. `/` or `/posts/hello`. */
  route: string;
  /** Directory containing the `pages/` tree; defaults to `pages` or `src/pages` under the renderer root. */
  pagesDirectory?: string;
}

const RESERVED_PAGES = new Set(["_app", "_document", "_error", "404", "500", "api"]);
const DATA_FETCHING_EXPORTS = ["getServerSideProps", "getStaticProps", "getInitialProps"];
/** The hydration payload `next/client` parses out of the document; `props` is what the App is rendered with. */
export const NEXT_DATA_GLOBAL = "__NEXT_DATA__";
/**
 * `reactStrictMode` from `next.config`, which the pages client reads as
 * `process.env.__NEXT_STRICT_MODE` (`false` when unset).
 */
const readReactStrictMode = (renderer: StaticRenderer, interpreter: Interpreter): StaticValue => {
  const config = evaluateNextConfig(renderer, interpreter);
  if (config === null) return FALSE_VALUE;
  return mapValue(config, (alternative) => {
    if (alternative.kind !== "object") {
      return unknownValue(`next.config is ${describeValue(alternative)}`);
    }
    return toBooleanValue(getObjectProperty(alternative, "reactStrictMode"));
  });
};

const withReactStrictMode = (tree: StaticValue, isStrictMode: StaticValue): StaticValue => {
  const strictTree = element({ kind: "strict-mode" }, objectFromRecord({ children: tree }));
  return mapValue(isStrictMode, (alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness === null) {
      return branchValue(
        [tree, strictTree],
        `next.config reactStrictMode is ${describeValue(alternative)}`,
      );
    }
    return truthiness ? strictTree : tree;
  });
};

interface NextPageMatch {
  file: string;
  params: Record<string, string>;
}

const withParam = (
  params: Record<string, string>,
  segment: DynamicSegment,
  values: string[],
): Record<string, string> =>
  segment.kind === "static"
    ? params
    : {
        ...params,
        [segment.param]:
          segment.kind === "dynamic"
            ? decodeURIComponent(values[0])
            : values.map(decodeURIComponent).join("/"),
      };

/**
 * Resolves a URL to `pages/**.tsx` following Next's pages-router conventions:
 * `/` → `index`, `/a/b` → `a/b` or `a/b/index`, dynamic `[param]` directories and
 * files as fallbacks, catch-alls last. Dynamic segments record the URL values
 * they consumed, which become `router.query`.
 */
const matchPage = (
  directory: string,
  remaining: string[],
  params: Record<string, string>,
): NextPageMatch | null => {
  if (remaining.length === 0) {
    const index = findRouteFile(directory, "index");
    return index ? { file: index, params } : null;
  }
  const [head, ...rest] = remaining;
  if (rest.length === 0) {
    const file = findRouteFile(directory, head);
    if (file && !RESERVED_PAGES.has(head)) return { file, params };
  }
  const subdirectories = listSubdirectories(directory);
  if (subdirectories.includes(head) && head !== "api") {
    const matched = matchPage(path.join(directory, head), rest, params);
    if (matched) return matched;
  }
  const dynamicCandidates = [
    ...subdirectories.map((name) => ({ name, isDirectory: true })),
    ...listRouteFileBaseNames(directory).map((name) => ({ name, isDirectory: false })),
  ]
    .map((candidate) => ({ ...candidate, segment: classifySegment(candidate.name) }))
    .filter((candidate) => candidate.segment.kind !== "static")
    .sort((left, right) => segmentSpecificity(left.segment) - segmentSpecificity(right.segment));

  for (const candidate of dynamicCandidates) {
    const isCatchAll = candidate.segment.kind === "catch-all";
    const consumed = isCatchAll ? remaining : [head];
    const nextParams = withParam(params, candidate.segment, consumed);
    if (candidate.isDirectory) {
      const matched = matchPage(
        path.join(directory, candidate.name),
        isCatchAll ? [] : rest,
        nextParams,
      );
      if (matched) return matched;
    } else if (isCatchAll || rest.length === 0) {
      const file = findRouteFile(directory, candidate.name);
      if (file) return { file, params: nextParams };
    }
  }
  return null;
};

/** `router.pathname`: the page file relative to `pages/` without extension, `index` collapsing to its directory. */
const pagePattern = (pagesDirectory: string, file: string): string => {
  const segments = routeIdFromFile(path.relative(pagesDirectory, file)).split(path.sep);
  if (segments[segments.length - 1] === "index") segments.pop();
  return `/${segments.join("/")}`;
};

/**
 * The props `next/client` renders the App with: `{...__NEXT_DATA__.props,
 * Component, router}`. Without a capture of the payload, `pageProps` is `{}`
 * unless the page exports a data-fetching function, in which case it is
 * unknown.
 */
const readAppProps = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  pageModule: ModuleRecord,
  pageContext: EvaluationContext,
): StaticValue => {
  const nextData = renderer.options.observations?.globals?.[NEXT_DATA_GLOBAL];
  if (nextData !== undefined) {
    return interpreter.getProperty(
      interpreter.captured(nextData, `window.${NEXT_DATA_GLOBAL}`),
      "props",
      pageContext,
      null,
    );
  }
  const fetchesData = DATA_FETCHING_EXPORTS.some((name) => hasExportedName(pageModule, name));
  return objectFromRecord({
    pageProps: fetchesData
      ? unknownValue("pageProps come from data fetching at request time")
      : objectValue(),
  });
};

/**
 * Composes `<App Component={Page} pageProps={…} router={…} />` (or just
 * `<Page {...pageProps} />` without a custom `_app`). `_document` (or Next's
 * default one) is server-only: its markup is the DOM the page mounts into
 * rather than part of the client fiber tree.
 */
export const renderNextPagesRoute = (
  renderer: StaticRenderer,
  model: NextModel,
  options: NextPagesRouteOptions,
): Promise<StaticRenderResult> => {
  const pagesDirectory = options.pagesDirectory
    ? renderer.resolvePath(options.pagesDirectory)
    : findFirstDirectory(renderer.options.rootDirectory, ["pages", "src/pages"]);

  const documentPath = pagesDirectory ? findRouteFile(pagesDirectory, "_document") : null;
  const document = (interpreter: Interpreter): StaticValue => {
    applyNextCompilerOptions(renderer, interpreter);
    const documentModule = documentPath ? renderer.loadModule(documentPath) : null;
    if (!documentModule) {
      if (documentPath) {
        interpreter.report("next-pages-parse", `could not parse ${documentPath}`, null, "error");
      }
      return stubElement(DEFAULT_DOCUMENT_STUB, {});
    }
    return interpreter.createElement(
      interpreter.evaluateModuleExport(documentModule, "default"),
      objectValue(),
      null,
      [],
      null,
      "Document",
      interpreter.createModuleContext(documentModule),
    );
  };

  const produce = (interpreter: Interpreter): StaticValue => {
    applyNextCompilerOptions(renderer, interpreter);
    if (!pagesDirectory) {
      interpreter.report(
        "next-pages-missing",
        "no pages/ or src/pages directory found",
        null,
        "error",
      );
      return unknownValue("next pages directory not found");
    }
    const url = new URL(options.route, "http://static.invalid");
    const match = matchPage(pagesDirectory, splitPathname(url.pathname), {});
    if (!match) {
      interpreter.report(
        "next-pages-no-page",
        `no page matches ${options.route} under ${pagesDirectory}`,
        null,
        "error",
      );
      return unknownValue(`no page for ${options.route}`);
    }
    Object.assign(model.params, match.params);
    model.page.pattern = pagePattern(pagesDirectory, match.file);
    const pagePath = match.file;
    const pageModule = renderer.loadModule(pagePath);
    if (!pageModule) {
      interpreter.report("next-pages-parse", `could not parse ${pagePath}`, null, "error");
      return unknownValue("unparsable page module");
    }
    const pageName = path.basename(pagePath, path.extname(pagePath));
    const pageComponent = interpreter.evaluateModuleExport(pageModule, "default");
    const pageContext = interpreter.createModuleContext(pageModule);
    const appProps = readAppProps(renderer, interpreter, pageModule, pageContext);
    const pageProps = interpreter.getProperty(appProps, "pageProps", pageContext, null);
    const router = model.externalValues("next/router", "default") ?? unknownValue("next router");

    const appPath = findRouteFile(pagesDirectory, "_app");
    const appModule = appPath ? renderer.loadModule(appPath) : null;
    const isStrictMode = readReactStrictMode(renderer, interpreter);
    if (!appModule) {
      return withReactStrictMode(
        interpreter.createElement(
          pageComponent,
          objectValue([{ kind: "spread", value: pageProps }]),
          null,
          [],
          null,
          pageName,
          pageContext,
        ),
        isStrictMode,
      );
    }
    const appComponent = interpreter.evaluateModuleExport(appModule, "default");
    return withReactStrictMode(
      interpreter.createElement(
        appComponent,
        objectValue([
          { kind: "spread", value: appProps },
          {
            kind: "property",
            key: "Component",
            value: componentReference(toElementType(pageComponent, pageName)),
          },
          { kind: "property", key: "router", value: router },
        ]),
        null,
        [],
        null,
        "App",
        interpreter.createModuleContext(appModule),
      ),
      isStrictMode,
    );
  };
  return renderer.renderWith(produce, { document });
};
