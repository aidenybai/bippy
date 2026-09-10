import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import type { Context, ReactNode } from "react";
import { ReactRuntimeError } from "../errors.js";
import type { ModuleResolver } from "../graph/module-resolver.js";
import { createCommitRecorder } from "../harness/commit-recorder.js";
import { getRootContainer } from "../harness/runtime-snapshot.js";
import { isVersionAtLeast } from "../libraries/installed-version.js";
import { isRecord } from "../observations.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
type ReactDomClientModule = typeof import("react-dom/client");
export type ReactDomModule = typeof import("react-dom");
export type ReactDomServerModule = typeof import("react-dom/server");

/** Module specifiers of the React build the analyzed app is served with. */
export interface ReactPackageSpecifiers {
  react: string;
  dom: string;
  domClient: string;
  domServer: string;
}

const DEFAULT_REACT_PACKAGES: ReactPackageSpecifiers = {
  react: "react",
  dom: "react-dom",
  domClient: "react-dom/client",
  domServer: "react-dom/server",
};

/** `react-dom` before 18: roots are created by `render(element, container)` and are always legacy (sync) roots. */
interface LegacyReactDomModule extends ReactDomModule {
  render: (element: ReactNode, container: Element) => void;
  unmountComponentAtNode: (container: Element) => boolean;
}

export interface RootErrorCallbacks {
  onUncaughtError: (error: unknown) => void;
  onCaughtError: (error: unknown) => void;
}

export interface MountedRoot {
  render: (node: ReactNode) => void;
  unmount: () => void;
}

/** The reconciler's `readContext`, installed on the current dispatcher for every render (class bodies included). */
interface ContextDispatcher {
  readContext: <T>(context: Context<T>) => T;
}

interface LegacyReactInternals {
  ReactCurrentDispatcher: { current: ContextDispatcher | null };
}

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` (or the build its framework bundles in their place) when
 * they resolve from the analyzed root, so the fibers React constructs carry the
 * same work tags, naming and reconciliation rules as the app's runtime.
 * `createRoot` mounts a concurrent root when the app's
 * `react-dom` has a `client` entry and a legacy `ReactDOM.render` root
 * otherwise (React 16/17). An app without its own React, or whose React predates
 * async `act` (< 16.9), is rendered with the harness's copy.
 */
export interface ReactRuntime {
  react: ReactModule;
  dom: ReactDomModule;
  domServer: ReactDomServerModule;
  createRoot: (container: Element, callbacks: RootErrorCallbacks) => MountedRoot;
  act: <T>(callback: () => T | Promise<T>) => Promise<T>;
  /** Reads a context at the rendering fiber the way `readContext(contextType)` does for classes: `use` on React 19, the dispatcher's `readContext` before. */
  readContext: <T>(context: Context<T>) => T;
  version: string;
}

const isReactModule = (value: unknown): value is ReactModule =>
  isRecord(value) &&
  typeof value.createElement === "function" &&
  typeof value.createContext === "function" &&
  typeof value.Component === "function";

const isReactDomClientModule = (value: unknown): value is ReactDomClientModule =>
  isRecord(value) && typeof value.createRoot === "function";

const isReactDomModule = (value: unknown): value is ReactDomModule =>
  isRecord(value) && typeof value.createPortal === "function";

const isReactDomServerModule = (value: unknown): value is ReactDomServerModule =>
  isRecord(value) && typeof value.renderToStaticMarkup === "function";

const isLegacyReactDomModule = (value: ReactDomModule): value is LegacyReactDomModule =>
  "render" in value &&
  typeof value.render === "function" &&
  "unmountComponentAtNode" in value &&
  typeof value.unmountComponentAtNode === "function";

const noop = (): void => {};

const concurrentRootFactory =
  (domClient: ReactDomClientModule): ReactRuntime["createRoot"] =>
  (container, callbacks) =>
    domClient.createRoot(container, { ...callbacks, onRecoverableError: noop });

/**
 * Legacy roots have no error callbacks: an uncaught render error is rethrown
 * synchronously out of `render`, which is how the caller observes it.
 */
const legacyRootFactory =
  (dom: LegacyReactDomModule): ReactRuntime["createRoot"] =>
  (container) => ({
    render: (node) => dom.render(node, container),
    unmount: () => {
      dom.unmountComponentAtNode(container);
    },
  });

const unwrapModule = (loaded: unknown): unknown =>
  isRecord(loaded) && "default" in loaded && isRecord(loaded.default) ? loaded.default : loaded;

const resolveFromApp = (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): string | null => {
  if (!resolver || !fromDirectory) return null;
  const resolution = resolver.resolve(specifier, `${fromDirectory}/index.js`);
  return resolution.kind === "external" && resolution.filePath ? resolution.filePath : null;
};

const importResolved = async (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): Promise<unknown> => {
  const filePath = resolveFromApp(resolver, specifier, fromDirectory);
  return unwrapModule(
    await (filePath === null ? import(specifier) : import(pathToFileURL(filePath).href)),
  );
};

const isContextDispatcher = (value: unknown): value is ContextDispatcher =>
  isRecord(value) && typeof value.readContext === "function";

const isLegacyReactInternals = (value: unknown): value is LegacyReactInternals =>
  isRecord(value) &&
  isRecord(value.ReactCurrentDispatcher) &&
  "current" in value.ReactCurrentDispatcher;

const loadContextReader = (react: ReactModule): ReactRuntime["readContext"] => {
  if (react.use) return react.use;
  const internals = Reflect.get(react, "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED");
  if (!isLegacyReactInternals(internals)) {
    throw new ReactRuntimeError("react exposes neither `use` nor its current dispatcher");
  }
  return (context) => {
    const dispatcher = internals.ReactCurrentDispatcher.current;
    if (!isContextDispatcher(dispatcher)) {
      throw new ReactRuntimeError("context read outside a React render");
    }
    return dispatcher.readContext(context);
  };
};

const hasAct = (
  value: unknown,
): value is { act: <T>(callback: () => T | Promise<T>) => Promise<T> } =>
  isRecord(value) && typeof value.act === "function";

const loadAct = async (
  react: ReactModule,
  resolver: ModuleResolver | null,
  fromDirectory: string | null,
): Promise<ReactRuntime["act"]> => {
  if (hasAct(react)) return react.act;
  const testUtils = await importResolved(resolver, "react-dom/test-utils", fromDirectory);
  if (hasAct(testUtils)) return testUtils.act;
  throw new ReactRuntimeError("neither React.act nor react-dom/test-utils act is available");
};

interface LoadReactRuntimeOptions {
  /** Resolves `react`/`react-dom` the way the analyzed app does; falls back to the harness's own copy. */
  resolver?: ModuleResolver;
  rootDirectory?: string;
  /** The build to resolve from the app; `react`/`react-dom` themselves by default. */
  packages?: ReactPackageSpecifiers;
}

const runtimeCache = new Map<string, Promise<ReactRuntime>>();

export const loadReactRuntime = ({
  resolver,
  rootDirectory,
  packages = DEFAULT_REACT_PACKAGES,
}: LoadReactRuntimeOptions = {}): Promise<ReactRuntime> => {
  const cacheKey = [
    rootDirectory ?? "",
    packages.react,
    packages.dom,
    packages.domClient,
    packages.domServer,
  ].join("\n");
  let pending = runtimeCache.get(cacheKey);
  if (!pending) {
    pending = load(resolver ?? null, rootDirectory ?? null, packages);
    runtimeCache.set(cacheKey, pending);
  }
  return pending;
};

const hasOwnReact = (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): boolean =>
  resolveFromApp(resolver, packages.react, rootDirectory) !== null &&
  resolveFromApp(resolver, packages.dom, rootDirectory) !== null;

/** React < 18 has no `react-dom/client`; a clone nested under another project would resolve that project's. */
const hasClientEntry = (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): boolean => {
  const domPath = resolveFromApp(resolver, packages.dom, rootDirectory);
  const clientPath = resolveFromApp(resolver, packages.domClient, rootDirectory);
  return (
    domPath !== null && clientPath !== null && path.dirname(domPath) === path.dirname(clientPath)
  );
};

const loadRootFactory = async (
  dom: ReactDomModule,
  appResolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): Promise<ReactRuntime["createRoot"]> => {
  if (appResolver === null || hasClientEntry(appResolver, rootDirectory, packages)) {
    const domClient = await importResolved(appResolver, packages.domClient, rootDirectory);
    if (!isReactDomClientModule(domClient)) {
      throw new ReactRuntimeError("could not load react-dom/client");
    }
    return concurrentRootFactory(domClient);
  }
  if (!isLegacyReactDomModule(dom)) {
    throw new ReactRuntimeError(
      "the app's react-dom has neither a client entry nor a legacy render export",
    );
  }
  return legacyRootFactory(dom);
};

/**
 * The materializer's proxies are hook components and the harness awaits `act`:
 * a React older than 16.9 (hooks but a synchronous `act` whose thenable never
 * settles) cannot host them.
 */
const FIRST_REACT_WITH_ASYNC_ACT = "16.9.0";

const supportsAsyncAct = (react: ReactModule): boolean =>
  isVersionAtLeast(react.version, FIRST_REACT_WITH_ASYNC_ACT);

const loadPackages = async (
  appResolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): Promise<ReactRuntime> => {
  const [react, dom, domServer] = await Promise.all([
    importResolved(appResolver, packages.react, rootDirectory),
    importResolved(appResolver, packages.dom, rootDirectory),
    importResolved(appResolver, packages.domServer, rootDirectory),
  ]);
  if (!isReactModule(react)) throw new ReactRuntimeError("could not load react");
  if (!isReactDomModule(dom)) throw new ReactRuntimeError("could not load react-dom");
  if (!isReactDomServerModule(domServer)) {
    throw new ReactRuntimeError("could not load react-dom/server");
  }
  if (appResolver !== null && !supportsAsyncAct(react)) {
    return loadPackages(null, rootDirectory, DEFAULT_REACT_PACKAGES);
  }
  return {
    react,
    dom,
    domServer,
    createRoot: await loadRootFactory(dom, appResolver, rootDirectory, packages),
    act: await loadAct(react, appResolver, rootDirectory),
    readContext: loadContextReader(react),
    version: react.version,
  };
};

/**
 * Whether the runtime's roots mount through its `react-dom`: only then does its
 * `flushSync` commit the root synchronously. A `client` entry that re-exports
 * whichever `react-dom` Node resolves from it (Next 14's vendored copy) drives
 * the app's own renderer, whose dispatcher `react` never sees.
 */
const isClientOfDom = (runtime: ReactRuntime): boolean => {
  const container = document.createElement("div");
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  const root = runtime.createRoot(container, { onUncaughtError: noop, onCaughtError: noop });
  const { error: consoleError } = console;
  // HACK: a mismatched pair logs React warnings while this probe render mounts; they are not app output
  console.error = noop;
  try {
    runtime.dom.flushSync(() => root.render(runtime.react.createElement("div")));
    return recorder.commitCount() > 0;
  } finally {
    root.unmount();
    recorder.dispose();
    console.error = consoleError;
  }
};

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const isFrameworkBuild = packages.react !== DEFAULT_REACT_PACKAGES.react;
  if (isFrameworkBuild && hasClientEntry(resolver, rootDirectory, packages)) {
    const framework = await loadPackages(resolver, rootDirectory, packages);
    if (isClientOfDom(framework)) return framework;
  }
  const appResolver = hasOwnReact(resolver, rootDirectory, DEFAULT_REACT_PACKAGES)
    ? resolver
    : null;
  return loadPackages(appResolver, rootDirectory, DEFAULT_REACT_PACKAGES);
};
