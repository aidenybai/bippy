import { Window } from "happy-dom";

export const createBrowser = (): Window => {
  const browser = new Window({ url: "https://bench.example" });
  Reflect.set(globalThis, "window", browser);
  Reflect.set(globalThis, "document", browser.document);
  Reflect.set(globalThis, "Node", browser.Node);
  Reflect.set(globalThis, "HTMLElement", browser.HTMLElement);
  Reflect.set(globalThis, "Element", browser.Element);
  Reflect.set(globalThis, "requestAnimationFrame", browser.requestAnimationFrame.bind(browser));
  Reflect.set(globalThis, "cancelAnimationFrame", browser.cancelAnimationFrame.bind(browser));
  return browser;
};
