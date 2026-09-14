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

/** React DOM rendering into the installed happy-dom document; roots and portals mount in detached `div`s under `body`. */
export const createDomHost = (hasKnownMarkup: boolean): RendererHost<Element> => {
  const hostDocument = createDomHostDocument(hasKnownMarkup);
  return {
    hostDocument,
    isChildlessTag: (tagName) => CHILDLESS_TAGS.has(tagName),
    isContainer: (value): value is Element => value instanceof Element,
    createContainer: () => document.createElement("div"),
    attachContainer: (container) => {
      document.body.appendChild(container);
      return () => container.remove();
    },
  };
};
