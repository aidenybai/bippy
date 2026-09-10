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

// HACK: happy-dom assigns slottables (`HTMLSlotElement.assignedNodes`) but
// omits the reverse `assignedSlot` accessor, so define it from that assignment
// (the "find a slot" step of the DOM spec) instead of leaving it undefined.
const defineAssignedSlot = (view: Pick<typeof globalThis, "Element" | "Text">): void => {
  const findAssignedSlot = (node: Node): HTMLSlotElement | null => {
    const shadowRoot = node.parentElement?.shadowRoot;
    if (!shadowRoot) return null;
    return (
      Array.from(shadowRoot.querySelectorAll("slot")).find((slot) =>
        slot.assignedNodes().includes(node),
      ) ?? null
    );
  };
  for (const prototype of [view.Element.prototype, view.Text.prototype]) {
    if ("assignedSlot" in prototype) continue;
    Object.defineProperty(prototype, "assignedSlot", {
      get(this: Node) {
        return findAssignedSlot(this);
      },
      configurable: true,
    });
  }
};

interface RangeBoundary {
  node: Node;
  offset: number;
}

// HACK: happy-dom's Selection lacks `getComposedRanges` and the StaticRange it
// returns, which every browser exposes; derive them from the live ranges as the
// Selection API spec does, rescoping boundaries out of unlisted shadow roots.
const defineGetComposedRanges = (
  view: Pick<typeof globalThis, "Selection" | "ShadowRoot" | "StaticRange">,
): void => {
  if ("getComposedRanges" in view.Selection.prototype) return;
  const isShadowRoot = (value: unknown): value is ShadowRoot => value instanceof view.ShadowRoot;
  const listShadowRoots = (options: unknown[]): ShadowRoot[] =>
    options.flatMap((option) => {
      if (isShadowRoot(option)) return [option];
      const shadowRoots: unknown =
        typeof option === "object" && option !== null ? Reflect.get(option, "shadowRoots") : [];
      return Array.isArray(shadowRoots) ? shadowRoots.filter(isShadowRoot) : [];
    });
  const rescope = (
    boundary: RangeBoundary,
    shadowRoots: readonly ShadowRoot[],
    isEnd: boolean,
  ): RangeBoundary => {
    let { node, offset } = boundary;
    for (let root = node.getRootNode(); isShadowRoot(root); root = node.getRootNode()) {
      const hostParent = root.host.parentNode;
      if (shadowRoots.includes(root) || hostParent === null) break;
      offset = Array.prototype.indexOf.call(hostParent.childNodes, root.host) + (isEnd ? 1 : 0);
      node = hostParent;
    }
    return { node, offset };
  };
  class StaticRange implements globalThis.StaticRange {
    readonly startContainer: Node;
    readonly startOffset: number;
    readonly endContainer: Node;
    readonly endOffset: number;
    constructor(init: StaticRangeInit) {
      this.startContainer = init.startContainer;
      this.startOffset = init.startOffset;
      this.endContainer = init.endContainer;
      this.endOffset = init.endOffset;
    }
    get collapsed(): boolean {
      return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
  }
  Object.defineProperty(view, "StaticRange", {
    value: StaticRange,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(view.Selection.prototype, "getComposedRanges", {
    value(this: Selection, ...options: unknown[]): StaticRange[] {
      const shadowRoots = listShadowRoots(options);
      return Array.from({ length: this.rangeCount }, (_, index) => {
        const range = this.getRangeAt(index);
        const start = rescope(
          { node: range.startContainer, offset: range.startOffset },
          shadowRoots,
          false,
        );
        const end = rescope(
          { node: range.endContainer, offset: range.endOffset },
          shadowRoots,
          true,
        );
        return new StaticRange({
          startContainer: start.node,
          startOffset: start.offset,
          endContainer: end.node,
          endOffset: end.offset,
        });
      });
    },
    configurable: true,
    writable: true,
  });
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
 * from what the previous program left behind. A document the host owns
 * (vitest's) is kept, and rewritten in place when the page has its own markup.
 */
export const resetDomGlobals = (initialMarkup: string | null = null): void => {
  performance.clearMarks();
  performance.clearMeasures();
  if (installedWindow !== null || typeof globalThis.document === "undefined") {
    installWindow(initialMarkup);
  } else if (initialMarkup !== null) {
    document.open();
    document.write(initialMarkup);
  }
};

const installWindow = (initialMarkup: string | null = null): void => {
  void installedWindow?.happyDOM.close();
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
  defineAssignedSlot(window);
  defineGetComposedRanges(window);
  const browser = loadHostRealm("browser");
  return {
    realm: browser,
    document,
    globalObject: window,
    hasKnownMarkup,
    getBaseHref: () => document.querySelector("base[href]")?.getAttribute("href") ?? null,
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
