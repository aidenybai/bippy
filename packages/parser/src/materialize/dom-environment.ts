import { Window } from "happy-dom";
import { DEFAULT_BROWSER_ENVIRONMENT } from "../evaluate/media-query.js";
import type { HostDocument } from "../host/host-document.js";
import { loadHostRealm } from "../host/host-realm.js";

const WINDOW_GLOBALS = ["window", "self", "document", "navigator", "location", "history"];

// happy-dom never fires load/error on `<link rel="preload">`, but React DOM
// suspends the commit of a `<link rel="stylesheet" precedence>` on exactly that
// event. Resolve preloads the way a browser with no network would: with an error.
const settlePreloadLinks = (nodes: NodeList): void => {
  nodes.forEach((node) => {
    if (!(node instanceof HTMLLinkElement) || node.rel !== "preload") return;
    const view = node.ownerDocument.defaultView;
    if (!view) return;
    queueMicrotask(() => node.dispatchEvent(new view.Event("error")));
  });
};

const observePreloadLinks = (): void => {
  new MutationObserver((mutations) => {
    for (const mutation of mutations) settlePreloadLinks(mutation.addedNodes);
  }).observe(document, { childList: true, subtree: true });
};

let installedWindow: Window | null = null;
const installedKeys = new Set<string>();

/**
 * Installs a happy-dom window as the global DOM when none is present (scripts
 * and the corpus runner; vitest provides its own). React DOM reads `document`
 * at module evaluation, so this must run before it loads.
 */
export const ensureDomGlobals = (): void => {
  if (typeof globalThis.document !== "undefined") return;
  installWindow();
};

/**
 * Replaces an installed window with a fresh one. Interpreted code mutates the
 * real document (`document.body.classList`, expando properties, history), so
 * each analyzed program must start from the DOM a browser would give it, not
 * from what the previous program left behind.
 */
export const resetDomGlobals = (initialMarkup: string | null = null): void => {
  if (installedWindow !== null || typeof globalThis.document === "undefined") {
    installWindow(initialMarkup);
  }
};

const installWindow = (initialMarkup: string | null = null): void => {
  void installedWindow?.happyDOM.abort();
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
  if (initialMarkup !== null) window.document.write(initialMarkup);
  for (const key of collectPropertyNames(window)) {
    if (!WINDOW_GLOBALS.includes(key) && !installedKeys.has(key) && key in globalThis) continue;
    const existing = Object.getOwnPropertyDescriptor(globalThis, key);
    if (existing && !existing.configurable) continue;
    const value: unknown = Reflect.get(window, key);
    Object.defineProperty(globalThis, key, {
      value: isBindableMethod(key, value) ? value.bind(window) : value,
      configurable: true,
      writable: true,
    });
    installedKeys.add(key);
  }
  installedWindow = window;
  observePreloadLinks();
};

/** An object of an interface the DOM declares and the language does not: a node, range, selection, token list, style declaration. */
const isDomObject = (value: object): boolean => {
  const browser = loadHostRealm("browser");
  const language = loadHostRealm("ecmascript");
  for (
    let prototype: object | null = Object.getPrototypeOf(value);
    prototype !== null;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    const interfaceName = prototype.constructor.name;
    if (language.getInterface(interfaceName) !== null) return false;
    if (browser.getInterface(interfaceName) !== null) return true;
  }
  return false;
};

/** The installed DOM as the document React DOM renders into and interpreted code reads from. */
export const createDomHostDocument = (hasKnownMarkup: boolean): HostDocument => {
  ensureDomGlobals();
  const browser = loadHostRealm("browser");
  return {
    realm: browser,
    document,
    globalObject: window,
    hasKnownMarkup,
    isInstanceOf: (value, interfaceName) => {
      if (browser.getInterface(interfaceName) === null) return null;
      const installed: unknown = Reflect.get(window, interfaceName);
      return typeof installed === "function" ? value instanceof installed : null;
    },
    ownsObject: isDomObject,
  };
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
