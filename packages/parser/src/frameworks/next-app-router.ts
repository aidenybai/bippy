import { existsSync } from "node:fs";
import path from "node:path";
import type { Interpreter } from "../evaluate/interpreter.js";
import { objectFromRecord, objectValue, primitiveValue, unknownValue } from "../evaluate/values.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { ModuleRecord, StaticObjectValue, StaticRenderResult, StaticValue } from "../types.js";
import type { NextModel } from "./next-externals.js";
import {
  classifySegment,
  type DynamicSegment,
  findFirstDirectory,
  findPageFile,
  findRouteFile,
  isContentRouteFile,
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
  /** Dynamic params matched from the URL down to (and including) this segment. */
  params: Record<string, string>;
}

const isRouteGroup = (name: string): boolean => name.startsWith("(") && name.endsWith(")");
const isPrivateFolder = (name: string): boolean => name.startsWith("_") || name.startsWith("@");

const readSegment = (directory: string, params: Record<string, string>): NextAppSegment => ({
  directory,
  layout: findRouteFile(directory, "layout"),
  template: findRouteFile(directory, "template"),
  loading: findRouteFile(directory, "loading"),
  params,
});

/** A routable child directory reached through zero or more transparent route groups. */
interface RouteChild {
  name: string;
  segment: DynamicSegment;
  /** Group directories between the parent and the child, outermost first. */
  groups: string[];
}

const collectRouteChildren = (directory: string, groups: string[]): RouteChild[] =>
  listSubdirectories(directory)
    .filter((name) => !isPrivateFolder(name))
    .flatMap((name) =>
      isRouteGroup(name)
        ? collectRouteChildren(path.join(directory, name), [...groups, name])
        : [{ name, segment: classifySegment(name), groups }],
    );

/** Directory chain from `directory` down to the one owning `page.*`, descending only through route groups. */
const findPageThroughGroups = (directory: string): string[] | null => {
  if (findPageFile(directory)) return [directory];
  for (const name of listSubdirectories(directory).filter(isRouteGroup)) {
    const chain = findPageThroughGroups(path.join(directory, name));
    if (chain) return [directory, ...chain];
  }
  return null;
};

/**
 * Walks the `app/` tree the way Next matches a URL: route groups `(name)` add a
 * directory level without consuming a URL segment, `[param]` consumes one,
 * `[...slug]` consumes the rest. Children across all sibling groups compete by
 * specificity (static beats dynamic beats catch-all). Returns the directory
 * chain ending at the directory that owns `page.*`, or null when nothing matches.
 */
const matchSegments = (
  directory: string,
  remaining: string[],
  params: Record<string, string>,
): NextAppSegment[] | null => {
  if (remaining.length === 0) {
    const pageChain = findPageThroughGroups(directory);
    if (pageChain)
      return pageChain.map((segmentDirectory) => readSegment(segmentDirectory, params));
  }

  const ranked = collectRouteChildren(directory, []).sort(
    (left, right) => segmentSpecificity(left.segment) - segmentSpecificity(right.segment),
  );

  for (const { name, segment, groups } of ranked) {
    const child = path.join(directory, ...groups, name);
    const prefix = groups.map((_, index) =>
      readSegment(path.join(directory, ...groups.slice(0, index + 1)), params),
    );
    const descend = (nextRemaining: string[], nextParams: Record<string, string>) => {
      const matched = matchSegments(child, nextRemaining, nextParams);
      return matched ? [readSegment(directory, params), ...prefix, ...matched] : null;
    };
    switch (segment.kind) {
      case "static": {
        if (remaining[0] !== name) continue;
        const matched = descend(remaining.slice(1), params);
        if (matched) return matched;
        break;
      }
      case "dynamic": {
        if (remaining.length === 0) continue;
        const matched = descend(remaining.slice(1), {
          ...params,
          [segment.param]: decodeURIComponent(remaining[0]),
        });
        if (matched) return matched;
        break;
      }
      case "catch-all": {
        if (remaining.length === 0 && !segment.optional) continue;
        const matched = descend([], {
          ...params,
          [segment.param]: remaining.map(decodeURIComponent).join("/"),
        });
        if (matched) return matched;
        break;
      }
    }
  }
  return null;
};

const stringRecordValue = (record: Record<string, string>): StaticValue =>
  objectFromRecord(
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, primitiveValue(value)])),
  );

interface LoadedDefaultExport {
  module: ModuleRecord;
  component: StaticValue;
}

const loadDefaultExport = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  filePath: string,
): LoadedDefaultExport | null => {
  const module = renderer.loadModule(filePath);
  if (!module) {
    interpreter.report("next-app-parse", `could not parse ${filePath}`, null, "error");
    return null;
  }
  return {
    module,
    component: interpreter.evaluateModuleExport(module, "default"),
  };
};

const componentName = (filePath: string): string => path.basename(filePath, path.extname(filePath));

/**
 * Runs `next.config.*` the way `next dev` does at startup so plugins register
 * what they alias (next-intl's request configuration module), then loads that
 * module's default export into the model.
 */
const loadNextConfig = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  model: NextModel,
): void => {
  const rootDirectory = renderer.options.rootDirectory;
  const configPath = findRouteFile(rootDirectory, "next.config");
  if (!configPath) return;
  const config = loadDefaultExport(renderer, interpreter, configPath);
  if (!config) return;
  const requestConfigPath = model.intl.getRequestConfigPath();
  if (requestConfigPath === null) return;
  const requestModulePath = path.resolve(rootDirectory, requestConfigPath);
  const requestFile = existsSync(requestModulePath)
    ? requestModulePath
    : findRouteFile(path.dirname(requestModulePath), path.basename(requestModulePath));
  if (!requestFile) {
    interpreter.report(
      "next-intl-request-config",
      `next-intl request configuration ${requestConfigPath} not found`,
      null,
      "warning",
    );
    return;
  }
  const requestConfig = loadDefaultExport(renderer, interpreter, requestFile);
  if (requestConfig) model.intl.setRequestConfig(requestConfig.component);
};

/**
 * Composes the route the way Next's app router does on the server: the page
 * element is wrapped, innermost first, by each segment's loading boundary,
 * template, and layout. Route props (`params`, `searchParams`) stay unknown.
 * The renderer must run with `serverComponents: true` so that server-only
 * layouts and pages are inlined instead of appearing as fibers.
 */
export const renderNextAppRoute = (
  renderer: StaticRenderer,
  model: NextModel,
  options: NextAppRouteOptions,
): Promise<StaticRenderResult> => {
  const appDirectory = options.appDirectory
    ? renderer.resolvePath(options.appDirectory)
    : findFirstDirectory(renderer.options.rootDirectory, ["app", "src/app"]);

  return renderer.renderWith((interpreter) => {
    if (!appDirectory) {
      interpreter.report("next-app-missing", "no app/ or src/app directory found", null, "error");
      return unknownValue("next app directory not found");
    }
    const url = new URL(options.route, "http://static.invalid");
    const segments = matchSegments(appDirectory, splitPathname(url.pathname), {});
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
    Object.assign(model.params, leaf.params);
    loadNextConfig(renderer, interpreter, model);
    const pagePath = findPageFile(leaf.directory);
    if (!pagePath) return unknownValue(`no page for ${options.route}`);

    // Next 15+ hands these to pages and layouts as promises; the interpreter
    // unwraps `await` of a plain object, so the resolved shape is used directly.
    const searchParams = stringRecordValue(Object.fromEntries(url.searchParams));
    const withRouteProps = (
      segment: NextAppSegment,
      children: StaticValue | null,
    ): StaticObjectValue => {
      const entries = objectValue([
        {
          kind: "property",
          key: "params",
          value: stringRecordValue(segment.params),
        },
        { kind: "property", key: "searchParams", value: searchParams },
      ]);
      if (children)
        entries.entries.push({
          kind: "property",
          key: "children",
          value: children,
        });
      return entries;
    };

    const serverContext = (module: ModuleRecord) =>
      interpreter.createModuleContext(module, undefined, "server");

    const pageElement = (): StaticValue => {
      if (isContentRouteFile(pagePath)) {
        return unknownValue(`${path.basename(pagePath)} is compiled by the bundler's MDX loader`);
      }
      const page = loadDefaultExport(renderer, interpreter, pagePath);
      if (!page) return unknownValue("unparsable page module");
      return interpreter.createElement(
        page.component,
        withRouteProps(leaf, null),
        null,
        [],
        null,
        componentName(pagePath),
        serverContext(page.module),
      );
    };
    let element = pageElement();

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
          withRouteProps(segment, element),
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
