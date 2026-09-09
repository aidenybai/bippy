import path from "node:path";
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
import type { StaticRenderer } from "../render/static-renderer.js";
import type { StaticRenderResult, StaticValue } from "../types.js";
import { applyNextConfig, evaluateNextConfig } from "./next-config.js";
import type { NextModel } from "./next-externals.js";
import { element } from "../evaluate/stubs.js";
import {
  type DynamicSegment,
  classifySegment,
  findFirstDirectory,
  findRouteFile,
  listRouteFileBaseNames,
  listSubdirectories,
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

/**
 * Composes `<App Component={Page} pageProps={…} router={…} />` (or just
 * `<Page />` without a custom `_app`). `pageProps` is `{}` unless the page
 * exports a data-fetching function, in which case it is unknown; `_document` is
 * server-only and never part of the client fiber tree.
 */
export const renderNextPagesRoute = (
  renderer: StaticRenderer,
  model: NextModel,
  options: NextPagesRouteOptions,
): Promise<StaticRenderResult> => {
  const pagesDirectory = options.pagesDirectory
    ? renderer.resolvePath(options.pagesDirectory)
    : findFirstDirectory(renderer.options.rootDirectory, ["pages", "src/pages"]);

  return renderer.renderWith((interpreter) => {
    applyNextConfig(renderer, interpreter);
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
    const pagePath = match.file;
    const pageModule = renderer.loadModule(pagePath);
    if (!pageModule) {
      interpreter.report("next-pages-parse", `could not parse ${pagePath}`, null, "error");
      return unknownValue("unparsable page module");
    }
    const pageName = path.basename(pagePath, path.extname(pagePath));
    const pageComponent = interpreter.evaluateModuleExport(pageModule, "default");
    const fetchesData = DATA_FETCHING_EXPORTS.some((name) =>
      pageModule.exports.some(
        (entry) => entry.kind !== "re-export-all" && entry.exportedName === name,
      ),
    );
    const pageProps = fetchesData
      ? unknownValue("pageProps come from data fetching at request time")
      : objectValue();
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
          interpreter.createModuleContext(pageModule),
        ),
        isStrictMode,
      );
    }
    const appComponent = interpreter.evaluateModuleExport(appModule, "default");
    return withReactStrictMode(
      interpreter.createElement(
        appComponent,
        objectValue([
          {
            kind: "property",
            key: "Component",
            value: componentReference(toElementType(pageComponent, pageName)),
          },
          { kind: "property", key: "pageProps", value: pageProps },
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
  });
};
