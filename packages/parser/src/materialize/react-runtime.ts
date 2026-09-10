import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import type { Context, ReactNode } from "react";
import { ReactRuntimeError } from "../errors.js";
import type { ModuleResolver } from "../graph/module-resolver.js";
import { isVersionAtLeast } from "../libraries/installed-version.js";
import { isRecord } from "../observations.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
export type ReactDomClientModule = typeof import("react-dom/client");
export type ReactDomModule = typeof import("react-dom");

/** `react-dom` before 18: roots are created by `render(element, container)` and are always legacy (sync) roots. */
export interface LegacyReactDomModule extends ReactDomModule {
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
export interface ContextDispatcher {
  readContext: <T>(context: Context<T>) => T;
}

export interface LegacyReactInternals {
  ReactCurrentDispatcher: { current: ContextDispatcher | null };
}

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` when they resolve from the analyzed root, so the fibers
 * React constructs carry the same work tags, naming and reconciliation rules as
 * the app's runtime. `createRoot` mounts a concurrent root when the app's
 * `react-dom` has a `client` entry and a legacy `ReactDOM.render` root
 * otherwise (React 16/17). An app without its own React, or whose React predates
 * hooks (< 16.8, unable to host the materializer's proxy components), is
 * rendered with the harness's copy.
 */
export interface ReactRuntime {
  react: ReactModule;
  dom: ReactDomModule;
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
}

const runtimeCache = new Map<string, Promise<ReactRuntime>>();

export const loadReactRuntime = ({
  resolver,
  rootDirectory,
}: LoadReactRuntimeOptions = {}): Promise<ReactRuntime> => {
  const cacheKey = rootDirectory ?? "";
  let pending = runtimeCache.get(cacheKey);
  if (!pending) {
    pending = load(resolver ?? null, rootDirectory ?? null);
    runtimeCache.set(cacheKey, pending);
  }
  return pending;
};

const hasOwnReact = (resolver: ModuleResolver | null, rootDirectory: string | null): boolean =>
  resolveFromApp(resolver, "react", rootDirectory) !== null &&
  resolveFromApp(resolver, "react-dom", rootDirectory) !== null;

/** React < 18 has no `react-dom/client`; a clone nested under another project would resolve that project's. */
const hasClientEntry = (resolver: ModuleResolver | null, rootDirectory: string | null): boolean => {
  const domPath = resolveFromApp(resolver, "react-dom", rootDirectory);
  const clientPath = resolveFromApp(resolver, "react-dom/client", rootDirectory);
  return (
    domPath !== null && clientPath !== null && path.dirname(domPath) === path.dirname(clientPath)
  );
};

const loadRootFactory = async (
  dom: ReactDomModule,
  appResolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime["createRoot"]> => {
  if (appResolver === null || hasClientEntry(appResolver, rootDirectory)) {
    const domClient = await importResolved(appResolver, "react-dom/client", rootDirectory);
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

interface ReactModules {
  react: ReactModule;
  dom: ReactDomModule;
}

const loadReactModules = async (
  appResolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactModules> => {
  const [react, dom] = await Promise.all([
    importResolved(appResolver, "react", rootDirectory),
    importResolved(appResolver, "react-dom", rootDirectory),
  ]);
  if (!isReactModule(react)) throw new ReactRuntimeError("could not load react");
  if (!isReactDomModule(dom)) throw new ReactRuntimeError("could not load react-dom");
  return { react, dom };
};

const FIRST_REACT_WITH_HOOKS = "16.8.0";

const hasHooks = (react: ReactModule): boolean =>
  isVersionAtLeast(react.version, FIRST_REACT_WITH_HOOKS);

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const ownResolver = hasOwnReact(resolver, rootDirectory) ? resolver : null;
  const ownModules =
    ownResolver === null ? null : await loadReactModules(ownResolver, rootDirectory);
  const hostedModules = ownModules !== null && hasHooks(ownModules.react) ? ownModules : null;
  const appResolver = hostedModules === null ? null : ownResolver;
  const { react, dom } = hostedModules ?? (await loadReactModules(null, null));
  return {
    react,
    dom,
    createRoot: await loadRootFactory(dom, appResolver, rootDirectory),
    act: await loadAct(react, appResolver, rootDirectory),
    readContext: loadContextReader(react),
    version: react.version,
  };
};
