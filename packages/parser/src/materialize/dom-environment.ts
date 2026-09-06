import { Window } from "happy-dom";
import { DEFAULT_BROWSER_ENVIRONMENT } from "../evaluate/media-query.js";

const WINDOW_GLOBALS = ["window", "self", "document", "navigator", "location", "history"];

// happy-dom never fires load/error on `<link rel="preload">`, but React DOM
// suspends the commit of a `<link rel="stylesheet" precedence>` on exactly that
// event. Resolve preloads the way a browser with no network would: with an error.
export const settlePreloadLinks = (nodes: NodeList): void => {
  nodes.forEach((node) => {
    if (!(node instanceof HTMLLinkElement) || node.rel !== "preload") return;
    const view = node.ownerDocument.defaultView;
    if (!view) return;
    queueMicrotask(() => node.dispatchEvent(new view.Event("error")));
  });
};

export const observePreloadLinks = (): void => {
  new MutationObserver((mutations) => {
    for (const mutation of mutations) settlePreloadLinks(mutation.addedNodes);
  }).observe(document, { childList: true, subtree: true });
};

/**
 * Installs a happy-dom window as the global DOM when none is present (scripts
 * and the corpus runner; vitest provides its own). React DOM reads `document`
 * at module evaluation, so this must run before it loads.
 */
export const ensureDomGlobals = (): void => {
  if (typeof globalThis.document !== "undefined") return;
  const window = new Window({
    url: "http://localhost:3000",
    width: DEFAULT_BROWSER_ENVIRONMENT.viewportWidth,
    height: DEFAULT_BROWSER_ENVIRONMENT.viewportHeight,
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      disableErrorCapturing: true,
    },
  });
  for (const key of collectPropertyNames(window)) {
    if (!WINDOW_GLOBALS.includes(key) && key in globalThis) continue;
    const existing = Object.getOwnPropertyDescriptor(globalThis, key);
    if (existing && !existing.configurable) continue;
    const value: unknown = Reflect.get(window, key);
    Object.defineProperty(globalThis, key, {
      value: isBindableMethod(key, value) ? value.bind(window) : value,
      configurable: true,
      writable: true,
    });
  }
  observePreloadLinks();
};

const collectPropertyNames = (target: object): Set<string> => {
  const names = new Set<string>();
  for (
    let current: object | null = target;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== "constructor") names.add(name);
    }
  }
  return names;
};

const isBindableMethod = (key: string, value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function" && key[0] === key[0].toLowerCase();
