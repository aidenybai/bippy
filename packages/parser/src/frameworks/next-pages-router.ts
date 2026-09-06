import path from "node:path";
import { componentReference, objectValue, unknownValue } from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { StaticRenderResult } from "../types.js";
import {
  classifySegment,
  findFirstDirectory,
  findRouteFile,
  listRouteFileBaseNames,
  listSubdirectories,
  segmentSpecificity,
  splitPathname,
} from "./route-files.js";

export interface NextPagesRouteOptions {
  /** URL pathname to render, e.g. `/` or `/posts/hello`. */
  route: string;
  /** Directory containing the `pages/` tree; defaults to `pages` or `src/pages` under the renderer root. */
  pagesDirectory?: string;
}

const RESERVED_PAGES = new Set(["_app", "_document", "_error", "404", "500", "api"]);

/**
 * Resolves a URL to `pages/**.tsx` following Next's pages-router conventions:
 * `/` → `index`, `/a/b` → `a/b` or `a/b/index`, dynamic `[param]` directories and
 * files as fallbacks, catch-alls last.
 */
const matchPage = (directory: string, remaining: string[]): string | null => {
  if (remaining.length === 0) return findRouteFile(directory, "index");
  const [head, ...rest] = remaining;
  if (rest.length === 0) {
    const file = findRouteFile(directory, head);
    if (file && !RESERVED_PAGES.has(head)) return file;
  }
  const subdirectories = listSubdirectories(directory);
  if (subdirectories.includes(head) && head !== "api") {
    const matched = matchPage(path.join(directory, head), rest);
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
    if (candidate.isDirectory) {
      const consumed = candidate.segment.kind === "catch-all" ? [] : rest;
      const matched = matchPage(path.join(directory, candidate.name), consumed);
      if (matched) return matched;
    } else if (candidate.segment.kind === "catch-all" || rest.length === 0) {
      return findRouteFile(directory, candidate.name);
    }
  }
  return null;
};

/**
 * Composes `<App Component={Page} pageProps={unknown} />` (or just `<Page />`
 * without a custom `_app`). `pageProps` and `router` stay unknown because they
 * come from data fetching at request time; `_document` is server-only and never
 * part of the client fiber tree.
 */
export const renderNextPagesRoute = (
  renderer: StaticRenderer,
  options: NextPagesRouteOptions,
): StaticRenderResult => {
  const pagesDirectory = options.pagesDirectory
    ? renderer.resolvePath(options.pagesDirectory)
    : findFirstDirectory(renderer.options.rootDirectory, ["pages", "src/pages"]);

  return renderer.renderWith((interpreter) => {
    if (!pagesDirectory) {
      interpreter.report(
        "next-pages-missing",
        "no pages/ or src/pages directory found",
        null,
        "error",
      );
      return unknownValue("next pages directory not found");
    }
    const pagePath = matchPage(pagesDirectory, splitPathname(options.route));
    if (!pagePath) {
      interpreter.report(
        "next-pages-no-page",
        `no page matches ${options.route} under ${pagesDirectory}`,
        null,
        "error",
      );
      return unknownValue(`no page for ${options.route}`);
    }
    const pageModule = renderer.loadModule(pagePath);
    if (!pageModule) {
      interpreter.report("next-pages-parse", `could not parse ${pagePath}`, null, "error");
      return unknownValue("unparsable page module");
    }
    const pageName = path.basename(pagePath, path.extname(pagePath));
    const pageComponent = interpreter.evaluateModuleExport(pageModule, "default");
    const pageProps = unknownValue("pageProps come from data fetching at request time");

    const appPath = findRouteFile(pagesDirectory, "_app");
    const appModule = appPath ? renderer.loadModule(appPath) : null;
    if (!appModule) {
      return interpreter.createElement(
        pageComponent,
        objectValue([{ kind: "spread", value: pageProps }]),
        null,
        [],
        null,
        pageName,
        interpreter.createModuleContext(pageModule),
      );
    }
    const appComponent = interpreter.evaluateModuleExport(appModule, "default");
    return interpreter.createElement(
      appComponent,
      objectValue([
        {
          kind: "property",
          key: "Component",
          value: componentReference(toElementType(pageComponent, pageName)),
        },
        { kind: "property", key: "pageProps", value: pageProps },
        { kind: "property", key: "router", value: unknownValue("next router instance") },
      ]),
      null,
      [],
      null,
      "App",
      interpreter.createModuleContext(appModule),
    );
  });
};
