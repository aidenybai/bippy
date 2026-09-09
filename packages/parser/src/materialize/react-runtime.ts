import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import type { ReactNode } from "react";
import { ReactRuntimeError } from "../errors.js";
import type { ModuleResolver } from "../graph/module-resolver.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
export type ReactDomClientModule = typeof import("react-dom/client");
export type ReactDomModule = typeof import("react-dom");

/** `react-dom` before 18: no `client` entry, roots are mounted with `render(element, container)`. */
export interface LegacyReactDomModule {
  render: (element: ReactNode, container: Element) => void;
  unmountComponentAtNode: (container: Element) => boolean;
}

export interface RootErrorCallbacks {
  onUncaughtError: (error: unknown) => void;
  onCaughtError: (error: unknown) => void;
}

export interface ReactRoot {
  render: (node: ReactNode) => void;
  unmount: () => void;
}

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` when they resolve from the analyzed root, so the fibers
 * React constructs carry the same work tags, naming and child reconciliation as
 * the app's runtime (React 17 still commits a HostText fiber for `""`). A
 * `react-dom` without a `client` entry mounts through the legacy `render`, where
 * uncaught errors surface by throwing from the `act` scope that rendered.
 */
export interface ReactRuntime {
  react: ReactModule;
  dom: ReactDomModule;
  createRoot: (container: Element, callbacks: RootErrorCallbacks) => ReactRoot;
  act: <T>(callback: () => T | Promise<T>) => Promise<T>;
  version: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReactModule = (value: unknown): value is ReactModule =>
  isRecord(value) &&
  typeof value.createElement === "function" &&
  typeof value.createContext === "function" &&
  typeof value.Component === "function";

const isReactDomClientModule = (value: unknown): value is ReactDomClientModule =>
  isRecord(value) && typeof value.createRoot === "function";

const isReactDomModule = (value: unknown): value is ReactDomModule =>
  isRecord(value) && typeof value.createPortal === "function";

const isLegacyReactDomModule = (value: unknown): value is LegacyReactDomModule =>
  isRecord(value) &&
  typeof value.render === "function" &&
  typeof value.unmountComponentAtNode === "function";

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

export interface LoadReactRuntimeOptions {
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

/** Whether the `react-dom` in use ships `react-dom/client`; a clone nested under another project would otherwise resolve that project's. */
const hasClientEntry = (resolver: ModuleResolver | null, rootDirectory: string | null): boolean => {
  if (resolver === null) return true;
  const domPath = resolveFromApp(resolver, "react-dom", rootDirectory);
  const clientPath = resolveFromApp(resolver, "react-dom/client", rootDirectory);
  return (
    domPath !== null && clientPath !== null && path.dirname(domPath) === path.dirname(clientPath)
  );
};

const createLegacyRoot =
  (dom: LegacyReactDomModule) =>
  (container: Element): ReactRoot => ({
    render: (node) => dom.render(node, container),
    unmount: () => {
      dom.unmountComponentAtNode(container);
    },
  });

const createConcurrentRoot =
  (domClient: ReactDomClientModule) =>
  (container: Element, callbacks: RootErrorCallbacks): ReactRoot =>
    domClient.createRoot(container, {
      onUncaughtError: callbacks.onUncaughtError,
      onCaughtError: callbacks.onCaughtError,
      onRecoverableError: () => {},
    });

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const appResolver =
    resolveFromApp(resolver, "react-dom", rootDirectory) === null ? null : resolver;
  const [react, dom] = await Promise.all([
    importResolved(appResolver, "react", rootDirectory),
    importResolved(appResolver, "react-dom", rootDirectory),
  ]);
  if (!isReactModule(react)) throw new ReactRuntimeError("could not load react");
  if (!isReactDomModule(dom)) throw new ReactRuntimeError("could not load react-dom");
  return {
    react,
    dom,
    createRoot: await loadCreateRoot(dom, appResolver, rootDirectory),
    act: await loadAct(react, appResolver, rootDirectory),
    version: react.version,
  };
};

const loadCreateRoot = async (
  dom: ReactDomModule,
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime["createRoot"]> => {
  if (!hasClientEntry(resolver, rootDirectory)) {
    if (isLegacyReactDomModule(dom)) return createLegacyRoot(dom);
    throw new ReactRuntimeError("react-dom has neither a client entry nor a legacy render");
  }
  const domClient = await importResolved(resolver, "react-dom/client", rootDirectory);
  if (!isReactDomClientModule(domClient)) {
    throw new ReactRuntimeError("could not load react-dom/client");
  }
  return createConcurrentRoot(domClient);
};
