import { parseHTML } from "linkedom/worker";
import { documentHtml, documentLocation } from "./dom-document.js";

const window = parseHTML(documentHtml);
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  location: documentLocation,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
});
