import path from "node:path";
import { FrameworkTargetError } from "../errors.js";
import { matchSegments, type NextAppSegment } from "../frameworks/next-app-router.js";
import {
  findFirstDirectory,
  findPageFile,
  isContentRouteFile,
  splitPathname,
} from "../frameworks/route-files.js";
import type { ModuleGraph } from "../graph/module-graph.js";
import { isClientModule } from "../graph/module-record.js";
import type { EntryRunner } from "./explore.js";
import type { ConcolicRealm } from "./realm.js";

// Composes an app-router route the way Next does on the server: the page is
// wrapped, innermost first, by each segment's loading boundary, template and
// layout. Server components are called directly (they render no fiber); modules
// with `"use client"` become elements rendered by the realm's own react-dom.
// Route props stay plain objects, as they were before Next 15 made them promises.

export interface NextAppTarget {
  rootDirectory: string;
  route: string;
  appDirectory: string | null;
}

interface ReactRuntime {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
  Suspense: unknown;
}

interface RouteModule {
  component: unknown;
  isClient: boolean;
}

const loadRouteModule = (
  realm: ConcolicRealm,
  graph: ModuleGraph,
  filePath: string,
): RouteModule => {
  const moduleExports: Record<string, unknown> = Object(realm.load(filePath));
  const record = graph.getModule(filePath);
  if (record === null) throw new FrameworkTargetError(`cannot parse route module ${filePath}`);
  if (typeof moduleExports.default !== "function") {
    throw new FrameworkTargetError(`${filePath} has no default export component`);
  }
  return { component: moduleExports.default, isClient: isClientModule(record) };
};

const renderRouteModule = async (
  routeModule: RouteModule,
  props: Record<string, unknown>,
  react: ReactRuntime,
): Promise<unknown> => {
  if (routeModule.isClient) return react.createElement(routeModule.component, props);
  if (typeof routeModule.component !== "function") return null;
  return await Reflect.apply(routeModule.component, undefined, [props]);
};

export const createNextAppRunner = (target: NextAppTarget, graph: ModuleGraph): EntryRunner => {
  const appDirectory = target.appDirectory
    ? path.resolve(target.rootDirectory, target.appDirectory)
    : findFirstDirectory(target.rootDirectory, ["app", "src/app"]);
  if (appDirectory === null) throw new FrameworkTargetError("no app/ or src/app directory found");
  const url = new URL(target.route, "http://static.invalid");
  const segments = matchSegments(appDirectory, splitPathname(url.pathname), {});
  if (segments === null) {
    throw new FrameworkTargetError(`no page.* matches ${target.route} under ${appDirectory}`);
  }
  const leaf = segments[segments.length - 1];
  const pagePath = findPageFile(leaf.directory);
  if (pagePath === null) throw new FrameworkTargetError(`no page for ${target.route}`);
  if (isContentRouteFile(pagePath)) {
    throw new FrameworkTargetError(
      `${path.basename(pagePath)} is compiled by the bundler's MDX loader`,
    );
  }
  const searchParams = Object.fromEntries(url.searchParams);

  return {
    run: async (realm) => {
      const reactExports: Record<string, unknown> = Object(realm.require("react", pagePath));
      const client: Record<string, unknown> = Object(realm.require("react-dom/client", pagePath));
      const { createElement, Suspense } = reactExports;
      if (typeof createElement !== "function" || typeof client.createRoot !== "function") {
        throw new FrameworkTargetError(
          "react and react-dom/client must resolve from the page module",
        );
      }
      const react: ReactRuntime = {
        createElement: (type, props, ...children) =>
          Reflect.apply(createElement, undefined, [type, props, ...children]),
        Suspense,
      };
      const routeProps = (segment: NextAppSegment, children: unknown): Record<string, unknown> =>
        children === undefined
          ? { params: segment.params, searchParams }
          : { params: segment.params, searchParams, children };

      let element = await renderRouteModule(
        loadRouteModule(realm, graph, pagePath),
        routeProps(leaf, undefined),
        react,
      );
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (segment.loading) {
          const fallback = await renderRouteModule(
            loadRouteModule(realm, graph, segment.loading),
            {},
            react,
          );
          element = react.createElement(react.Suspense, { fallback }, element);
        }
        for (const wrapperPath of [segment.template, segment.layout]) {
          if (!wrapperPath) continue;
          element = await renderRouteModule(
            loadRouteModule(realm, graph, wrapperPath),
            routeProps(segment, element),
            react,
          );
        }
      }
      const container = realm.window.document.createElement("div");
      realm.window.document.body.appendChild(container);
      const root: Record<string, unknown> = Object(client.createRoot(container));
      if (typeof root.render !== "function")
        throw new FrameworkTargetError("createRoot() returned no root");
      root.render(element);
    },
  };
};
