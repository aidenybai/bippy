import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FrameworkTargetError } from "../errors.js";
import { findRouteFile, routeIdFromFile } from "../frameworks/route-files.js";
import type { ModuleResolver } from "../graph/module-resolver.js";
import type { EntryRunner } from "./explore.js";
import type { ConcolicRealm } from "./realm.js";

// Framework mode (`@react-router/dev`): the dev server evaluates `routes.ts`,
// builds a route manifest and hands it to the browser as
// `window.__reactRouterContext/Manifest/RouteModules`, where the default
// `entry.client.tsx` renders `<HydratedRouter />`. This runner does the same
// handoff inside the realm, so the framework's own client code composes the
// route tree. Server `loader` results are the one thing the client cannot
// compute: they become symbolic sources keyed by route id.

export interface ReactRouterTarget {
  rootDirectory: string;
  appDirectory: string | null;
  routesModule: string | null;
}

const routeConfigEntrySchema: z.ZodType<RouteConfigEntry> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    file: z.string(),
    path: z.string().optional(),
    index: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    children: z.array(routeConfigEntrySchema).optional(),
  }),
);

export interface RouteConfigEntry {
  id?: string;
  file: string;
  path?: string;
  index?: boolean;
  caseSensitive?: boolean;
  children?: RouteConfigEntry[];
}

const routeConfigSchema = z.array(routeConfigEntrySchema);

const frameworkConfigSchema = z.object({
  appDirectory: z.string().optional(),
  basename: z.string().optional(),
  ssr: z.boolean().optional(),
  future: z.record(z.string(), z.unknown()).optional(),
});

interface ManifestRoute {
  id: string;
  parentId: string | undefined;
  path: string | undefined;
  index: boolean | undefined;
  caseSensitive: boolean | undefined;
  module: string;
  imports: string[];
  css: string[];
  hasAction: boolean;
  hasLoader: boolean;
  hasClientAction: boolean;
  hasClientLoader: boolean;
  hasClientMiddleware: boolean;
  hasErrorBoundary: boolean;
}

interface LoadedRoute {
  manifest: ManifestRoute;
  filePath: string;
  exports: Record<string, unknown>;
}

const ROOT_ROUTE_ID = "root";

// HACK: react-router 8 vendors turbo-stream next to `react-router/dom` and
// exports no encoder; 7 depends on the `turbo-stream` package, whose encoder
// emits strings the page pipes through `TextEncoderStream`.
const VENDORED_TURBO_STREAM = "vendor/turbo-stream-v2/turbo-stream.js";

const toByteStream = (encoded: ReadableStream<unknown>): ReadableStream<Uint8Array> => {
  const textEncoder = new TextEncoder();
  return encoded.pipeThrough(
    new TransformStream<unknown, Uint8Array>({
      transform: (chunk, controller) => {
        if (typeof chunk === "string") controller.enqueue(textEncoder.encode(chunk));
        else if (chunk instanceof Uint8Array) controller.enqueue(chunk);
        else throw new FrameworkTargetError(`turbo-stream emitted a ${typeof chunk} chunk`);
      },
    }),
  );
};

const loadEncoder = (
  realm: ConcolicRealm,
  resolver: ModuleResolver,
  fromFile: string,
): ((value: unknown) => unknown) => {
  const domResolution = resolver.resolve("react-router/dom", fromFile);
  if (domResolution.kind !== "external" || domResolution.filePath === null) {
    throw new FrameworkTargetError("react-router/dom must resolve from the root route module");
  }
  const vendoredFile = path.join(path.dirname(domResolution.filePath), VENDORED_TURBO_STREAM);
  const dependency = resolver.resolve("turbo-stream", domResolution.filePath);
  const encoderFile = existsSync(vendoredFile)
    ? vendoredFile
    : dependency.kind === "external" && dependency.filePath !== null
      ? dependency.filePath
      : null;
  if (encoderFile === null)
    throw new FrameworkTargetError("no turbo-stream encoder next to react-router/dom");
  const encoderExports: Record<string, unknown> = Object(realm.load(encoderFile));
  const { encode } = encoderExports;
  if (typeof encode !== "function")
    throw new FrameworkTargetError(`${encoderFile} exports no encode()`);
  return (value) => {
    const encoded: unknown = Reflect.apply(encode, undefined, [value]);
    if (!(encoded instanceof ReadableStream))
      throw new FrameworkTargetError("encode() returned no ReadableStream");
    return toByteStream(encoded);
  };
};

const loadDefaultExport = (realm: ConcolicRealm, filePath: string): unknown => {
  const moduleExports: Record<string, unknown> = Object(realm.load(filePath));
  return moduleExports.default;
};

const walkRouteConfig = (
  entries: RouteConfigEntry[],
  parentId: string,
  appDirectory: string,
  realm: ConcolicRealm,
  routes: Map<string, LoadedRoute>,
): void => {
  for (const entry of entries) {
    const id = entry.id ?? routeIdFromFile(entry.file);
    if (routes.has(id)) throw new FrameworkTargetError(`duplicate react-router route id "${id}"`);
    const filePath = path.resolve(appDirectory, entry.file);
    routes.set(
      id,
      loadRoute(realm, appDirectory, filePath, {
        id,
        parentId,
        path: entry.path,
        index: entry.index,
        caseSensitive: entry.caseSensitive,
      }),
    );
    if (entry.children) walkRouteConfig(entry.children, id, appDirectory, realm, routes);
  }
};

interface RouteIdentity {
  id: string;
  parentId: string | undefined;
  path: string | undefined;
  index: boolean | undefined;
  caseSensitive: boolean | undefined;
}

const loadRoute = (
  realm: ConcolicRealm,
  appDirectory: string,
  filePath: string,
  identity: RouteIdentity,
): LoadedRoute => {
  const exports: Record<string, unknown> = Object(realm.load(filePath));
  const relativeFile = path
    .relative(path.dirname(appDirectory), filePath)
    .split(path.sep)
    .join("/");
  return {
    filePath,
    exports,
    manifest: {
      ...identity,
      module: `/${relativeFile}`,
      imports: [],
      css: [],
      hasAction: typeof exports.action === "function",
      hasLoader: typeof exports.loader === "function",
      hasClientAction: typeof exports.clientAction === "function",
      hasClientLoader: typeof exports.clientLoader === "function",
      hasClientMiddleware: Array.isArray(exports.clientMiddleware),
      hasErrorBoundary: typeof exports.ErrorBoundary === "function",
    },
  };
};

/** `loaderData` as the server handoff would carry it: unknown for every route that has a server loader. */
const createLoaderData = (
  realm: ConcolicRealm,
  routes: Map<string, LoadedRoute>,
): Record<string, unknown> =>
  Object.fromEntries(
    [...routes.values()]
      .filter((route) => route.manifest.hasLoader)
      .map((route) => [
        route.manifest.id,
        realm.space.source("loader", `loader(${route.manifest.id})`, "unknown"),
      ]),
  );

export const createReactRouterRunner = (
  target: ReactRouterTarget,
  resolver: ModuleResolver,
): EntryRunner => {
  const configFile = findRouteFile(target.rootDirectory, "react-router.config");
  return {
    run: async (realm) => {
      const config = frameworkConfigSchema.parse(
        configFile ? (loadDefaultExport(realm, configFile) ?? {}) : {},
      );
      const appDirectory = path.resolve(
        target.rootDirectory,
        target.appDirectory ?? config.appDirectory ?? "app",
      );
      const rootFile = findRouteFile(appDirectory, "root");
      if (rootFile === null)
        throw new FrameworkTargetError(`no root route module under ${appDirectory}`);
      const routesFile = target.routesModule
        ? path.resolve(target.rootDirectory, target.routesModule)
        : findRouteFile(appDirectory, "routes");
      if (routesFile === null) throw new FrameworkTargetError(`no routes.ts under ${appDirectory}`);

      const routes = new Map<string, LoadedRoute>();
      routes.set(
        ROOT_ROUTE_ID,
        loadRoute(realm, appDirectory, rootFile, {
          id: ROOT_ROUTE_ID,
          parentId: undefined,
          path: "",
          index: undefined,
          caseSensitive: undefined,
        }),
      );
      const routeConfig = routeConfigSchema.parse(await loadDefaultExport(realm, routesFile));
      walkRouteConfig(routeConfig, ROOT_ROUTE_ID, appDirectory, realm, routes);

      const encode = loadEncoder(realm, resolver, rootFile);
      const loaderData = createLoaderData(realm, routes);
      const state = { loaderData, actionData: null, errors: null };
      const handoffState = { ...state, loaderData: {} };
      const context: Record<string, unknown> = {
        basename: config.basename ?? "/",
        future: config.future ?? {},
        ssr: config.ssr ?? true,
        isSpaMode: config.ssr === false,
        routeDiscovery: { mode: "initial" },
        // HACK: the dev server always hands off a critical CSS string; `HydratedRouter` clears it in an effect, which is the re-render that lets `<Scripts>` drop its hydration tags.
        criticalCss: "",
        stream: encode(handoffState),
      };
      // HACK: the decoded handoff is assigned to `context.state`; symbolic loader results cannot travel through the stream, so they are attached at that moment.
      Object.defineProperty(context, "state", {
        configurable: true,
        enumerable: true,
        get: () => state,
        set: (decoded: unknown) => {
          Object.assign(state, Object(decoded), { loaderData });
        },
      });
      const globalRecord: Record<string, unknown> = Object(realm.window);
      globalRecord.__reactRouterContext = context;
      globalRecord.__reactRouterManifest = {
        entry: { imports: [], module: "/app/entry.client.tsx" },
        routes: Object.fromEntries([...routes].map(([id, route]) => [id, route.manifest])),
        url: "/manifest.js",
        version: "concolic",
      };
      globalRecord.__reactRouterRouteModules = Object.fromEntries(
        [...routes].map(([id, route]) => [id, route.exports]),
      );

      const react: Record<string, unknown> = Object(realm.require("react", rootFile));
      const client: Record<string, unknown> = Object(realm.require("react-dom/client", rootFile));
      const dom: Record<string, unknown> = Object(realm.require("react-router/dom", rootFile));
      if (typeof react.createElement !== "function" || typeof client.createRoot !== "function") {
        throw new FrameworkTargetError(
          "react and react-dom/client must resolve from the root route module",
        );
      }
      const root: Record<string, unknown> = Object(client.createRoot(realm.window.document));
      if (typeof root.render !== "function")
        throw new FrameworkTargetError("createRoot() returned no root");
      root.render(
        react.createElement(react.StrictMode, null, react.createElement(dom.HydratedRouter)),
      );
    },
  };
};
