import "fake-indexeddb/auto";
import "../../bippy/src/install-hook-only.js";

// HACK: vitest's happy-dom environment copies `hasOwnProperty` onto the global
// as a function bound to the window, which breaks `hasOwnProperty.call(target,
// key)` in libraries loaded from the analyzed app (`@babel/template` via SVGR).
Object.defineProperty(globalThis, "hasOwnProperty", {
  value: Object.prototype.hasOwnProperty,
  configurable: true,
  writable: true,
});

// happy-dom never fires load/error on `<link rel="preload">`, but React DOM
// suspends the commit of a `<link rel="stylesheet" precedence>` on exactly that
// event. Resolve preloads the way a browser with no network would: with an error.
const settlePreloadLinks = (nodes: NodeList): void => {
  nodes.forEach((node) => {
    if (!(node instanceof HTMLLinkElement) || node.rel !== "preload") return;
    queueMicrotask(() => node.dispatchEvent(new Event("error")));
  });
};

new MutationObserver((mutations) => {
  for (const mutation of mutations) settlePreloadLinks(mutation.addedNodes);
}).observe(document, { childList: true, subtree: true });
