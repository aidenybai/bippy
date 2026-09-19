import { createDomHostDocument } from "../materialize/dom-environment.js";
import type { RendererHost } from "../materialize/renderer-host.js";

/**
 * Tags React DOM gives no child fibers: the void elements its
 * `setInitialProperties` rejects `children` on (`ReactDOMComponent.js`), and
 * the two whose children it sets as text content (`shouldSetTextContent` in
 * `ReactFiberConfigDOM.js`: `textarea`, `noscript`).
 */
const CHILDLESS_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "menuitem",
  "meta",
  "noscript",
  "param",
  "source",
  "textarea",
  "track",
  "wbr",
]);

/** React DOM rendering into the installed happy-dom document. */
export const createDomHost = (
  hasKnownMarkup: boolean,
  renderIntoDocument = false,
): RendererHost<Element, Element | Document> => {
  const hostDocument = createDomHostDocument(hasKnownMarkup);
  return {
    hostDocument,
    isChildlessTag: (tagName) => CHILDLESS_TAGS.has(tagName),
    isContainer: (value): value is Element => value instanceof Element,
    createRootContainer: () => (renderIntoDocument ? document : document.createElement("div")),
    attachRootContainer: (container) => {
      if (container instanceof Document) return () => {};
      document.body.appendChild(container);
      return () => container.remove();
    },
    createContainer: () => document.createElement("div"),
  };
};
