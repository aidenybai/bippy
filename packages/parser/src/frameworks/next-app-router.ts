import path from "node:path";
import type { Interpreter } from "../evaluate/interpreter.js";
import { objectValue, unknownValue } from "../evaluate/values.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type {
  ModuleRecord,
  StaticObjectValue,
  StaticRenderResult,
  StaticValue,
} from "../types.js";
import {
  classifySegment,
  findFirstDirectory,
  findRouteFile,
  listSubdirectories,
  segmentSpecificity,
  splitPathname,
} from "./route-files.js";

export interface NextAppRouteOptions {
  /** URL pathname to render, e.g. `/` or `/posts/hello`. */
  route: string;
  /** Directory containing the `app/` tree; defaults to `app` or `src/app` under the renderer root. */
  appDirectory?: string;
}

/** One file-system segment on the matched route, from the app root down to the page. */
export interface NextAppSegment {
  directory: string;
  layout: string | null;
  template: string | null;
  loading: string | null;
}

const isRouteGroup = (name: string): boolean => name.startsWith("(") && name.endsWith(")");
const isPrivateFolder = (name: string): boolean => name.startsWith("_") || name.startsWith("@");

const readSegment = (directory: string): NextAppSegment => ({
  directory,
  layout: findRouteFile(directory, "layout"),
  template: findRouteFile(directory, "template"),
  loading: findRouteFile(directory, "loading"),
});

/**
 * Walks the `app/` tree the way Next matches a URL: route groups `(name)` add a
 * directory level without consuming a URL segment, `[param]` consumes one,
 * `[...slug]` consumes the rest. Returns the directory chain ending at the
 * directory that owns `page.*`, or null when nothing matches.
 */
const matchSegments = (directory: string, remaining: string[]): NextAppSegment[] | null => {
  if (remaining.length === 0 && findRouteFile(directory, "page")) return [readSegment(directory)];

  const candidates = listSubdirectories(directory).filter((name) => !isPrivateFolder(name));
  const groups = candidates.filter(isRouteGroup);
  for (const group of groups) {
    const matched = matchSegments(path.join(directory, group), remaining);
    if (matched) return [readSegment(directory), ...matched];
  }

  const ranked = candidates
    .filter((name) => !isRouteGroup(name))
    .map((name) => ({ name, segment: classifySegment(name) }))
    .sort((left, right) => segmentSpecificity(left.segment) - segmentSpecificity(right.segment));

  for (const { name, segment } of ranked) {
    const child = path.join(directory, name);
    switch (segment.kind) {
      case "static": {
        if (remaining[0] !== name) continue;
        const matched = matchSegments(child, remaining.slice(1));
        if (matched) return [readSegment(directory), ...matched];
        break;
      }
      case "dynamic": {
        if (remaining.length === 0) continue;
        const matched = matchSegments(child, remaining.slice(1));
        if (matched) return [readSegment(directory), ...matched];
        break;
      }
      case "catch-all": {
        if (remaining.length === 0 && !segment.optional) continue;
        const matched = matchSegments(child, []);
        if (matched) return [readSegment(directory), ...matched];
        break;
      }
    }
  }
  return null;
};

const loadDefaultExport = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  filePath: string,
): { module: ModuleRecord; component: StaticValue } | null => {
  const module = renderer.loadModule(filePath);
  if (!module) {
    interpreter.report("next-app-parse", `could not parse ${filePath}`, null, "error");
    return null;
  }
  return { module, component: interpreter.evaluateModuleExport(module, "default") };
};

const componentName = (filePath: string): string =>
  path.basename(filePath, path.extname(filePath));

/**
 * Composes the route the way Next's app router does on the server: the page
 * element is wrapped, innermost first, by each segment's loading boundary,
 * template, and layout. Route props (`params`, `searchParams`) stay unknown.
 * The renderer must run with `serverComponents: true` so that server-only
 * layouts and pages are inlined instead of appearing as fibers.
 */
export const renderNextAppRoute = (
  renderer: StaticRenderer,
  options: NextAppRouteOptions,
): StaticRenderResult => {
  const appDirectory = options.appDirectory
    ? renderer.resolvePath(options.appDirectory)
    : findFirstDirectory(renderer.options.rootDirectory, ["app", "src/app"]);

  return renderer.renderWith((interpreter) => {
    if (!appDirectory) {
      interpreter.report("next-app-missing", "no app/ or src/app directory found", null, "error");
      return unknownValue("next app directory not found");
    }
    const segments = matchSegments(appDirectory, splitPathname(options.route));
    if (!segments) {
      interpreter.report(
        "next-app-no-page",
        `no page.* matches ${options.route} under ${appDirectory}`,
        null,
        "error",
      );
      return unknownValue(`no page for ${options.route}`);
    }

    const leaf = segments[segments.length - 1];
    const pagePath = findRouteFile(leaf.directory, "page");
    if (!pagePath) return unknownValue(`no page for ${options.route}`);
    const page = loadDefaultExport(renderer, interpreter, pagePath);
    if (!page) return unknownValue("unparsable page module");

    const routeProps = (): StaticValue[] => [
      unknownValue("route params are only known at request time"),
      unknownValue("search params are only known at request time"),
    ];
    const withRouteProps = (children: StaticValue | null): StaticObjectValue => {
      const [params, searchParams] = routeProps();
      const entries = objectValue([
        { kind: "property", key: "params", value: params },
        { kind: "property", key: "searchParams", value: searchParams },
      ]);
      if (children) entries.entries.push({ kind: "property", key: "children", value: children });
      return entries;
    };

    const serverContext = (module: ModuleRecord) =>
      interpreter.createModuleContext(module, null, "server");

    let element: StaticValue = interpreter.createElement(
      page.component,
      withRouteProps(null),
      null,
      [],
      null,
      componentName(pagePath),
      serverContext(page.module),
    );

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (segment.loading) {
        const loading = loadDefaultExport(renderer, interpreter, segment.loading);
        if (loading) {
          const fallback = interpreter.createElement(
            loading.component,
            objectValue(),
            null,
            [],
            null,
            componentName(segment.loading),
            serverContext(loading.module),
          );
          element = interpreter.createElement(
            { kind: "react-api", api: "Suspense" },
            objectValue([{ kind: "property", key: "fallback", value: fallback }]),
            null,
            [element],
            null,
            "Suspense",
            serverContext(loading.module),
          );
        }
      }
      for (const wrapperPath of [segment.template, segment.layout]) {
        if (!wrapperPath) continue;
        const wrapper = loadDefaultExport(renderer, interpreter, wrapperPath);
        if (!wrapper) continue;
        element = interpreter.createElement(
          wrapper.component,
          withRouteProps(element),
          null,
          [],
          null,
          componentName(wrapperPath),
          serverContext(wrapper.module),
        );
      }
    }
    return element;
  });
};
