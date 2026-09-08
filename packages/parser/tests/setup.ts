import "fake-indexeddb/auto";
import "../../bippy/src/install-hook-only.js";

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
