import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import type { ReactNode } from "react";
import { ReactRuntimeError } from "../errors.js";
import {
  getPackageDirectoryFromFilePath,
  type ModuleResolver,
} from "../graph/module-resolver.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
export type ReactDomModule = typeof import("react-dom");

export interface ReactRoot {
  render(node: ReactNode): void;
  unmount(): void;
}

export interface ReactRootOptions {
  onUncaughtError(error: unknown): void;
  onCaughtError(error: unknown): void;
  onRecoverableError(error: unknown): void;
}

/** `react-dom/client`, or the legacy `ReactDOM.render` API of a React 17 app wrapped to look like it. */
export interface ReactRootFactory {
  createRoot(container: Element, options: ReactRootOptions): ReactRoot;
}

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` when they resolve from the analyzed root, so the fibers
 * React constructs carry the same work tags and naming as the app's runtime.
 */
export interface ReactRuntime {
  react: ReactModule;
  domClient: ReactRootFactory;
  dom: ReactDomModule;
  act: <T>(callback: () => T | Promise<T>) => Promise<T>;
  version: string;
}

interface LegacyReactDomModule {
  render(element: ReactNode, container: Element): unknown;
  unmountComponentAtNode(container: Element): boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReactModule = (value: unknown): value is ReactModule =>
  isRecord(value) &&
  typeof value.createElement === "function" &&
  typeof value.createContext === "function" &&
  typeof value.Component === "function";

const isReactRootFactory = (value: unknown): value is ReactRootFactory =>
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
  return resolution.kind === "external" ? resolution.filePath : null;
};

const importResolved = async (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): Promise<unknown> => {
  const filePath = resolveFromApp(resolver, specifier, fromDirectory);
  return unwrapModule(await import(filePath === null ? specifier : pathToFileURL(filePath).href));
};

/** Whether `react-dom/client` resolves inside the same installed `react-dom` as the app's `react-dom` (not an ancestor `node_modules`). */
const hasClientEntry = (
  resolver: ModuleResolver | null,
  fromDirectory: string | null,
  domFilePath: string,
): boolean => {
  const clientFilePath = resolveFromApp(resolver, "react-dom/client", fromDirectory);
  return (
    clientFilePath !== null &&
    getPackageDirectoryFromFilePath(clientFilePath) === getPackageDirectoryFromFilePath(domFilePath)
  );
};

/**
 * React before 18 ships no `react-dom/client`; its `ReactDOM.render` mounts a
 * legacy root whose fibers are otherwise the same, and render errors surface
 * synchronously from `render` rather than through root callbacks.
 */
const legacyRootFactory = (dom: LegacyReactDomModule): ReactRootFactory => ({
  createRoot: (container) => ({
    render: (node) => {
      dom.render(node, container);
    },
    unmount: () => {
      dom.unmountComponentAtNode(container);
    },
  }),
});

const loadRootFactory = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  dom: ReactDomModule,
): Promise<ReactRootFactory> => {
  const domFilePath = resolveFromApp(resolver, "react-dom", rootDirectory);
  if (
    domFilePath !== null &&
    !hasClientEntry(resolver, rootDirectory, domFilePath) &&
    isLegacyReactDomModule(dom)
  ) {
    return legacyRootFactory(dom);
  }
  const domClient = await importResolved(resolver, "react-dom/client", rootDirectory);
  if (!isReactRootFactory(domClient)) {
    throw new ReactRuntimeError("could not load react-dom/client");
  }
  return domClient;
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

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const [react, dom] = await Promise.all([
    importResolved(resolver, "react", rootDirectory),
    importResolved(resolver, "react-dom", rootDirectory),
  ]);
  if (!isReactModule(react)) throw new ReactRuntimeError("could not load react");
  if (!isReactDomModule(dom)) throw new ReactRuntimeError("could not load react-dom");
  return {
    react,
    domClient: await loadRootFactory(resolver, rootDirectory, dom),
    dom,
    act: await loadAct(react, resolver, rootDirectory),
    version: react.version,
  };
};
