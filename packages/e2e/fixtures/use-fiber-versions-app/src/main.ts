import "bippy/install-hook-only";

import * as bippy from "bippy";
import * as bippySource from "bippy/source";
import type { Fiber } from "bippy";
import { createFiberReference } from "../../fiber-reference";
import { createUseFiberScenarios } from "../../use-fiber-scenarios";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createPortal } from "react-dom";

declare global {
  interface Window {
    __BIPPY__: typeof bippy & typeof bippySource;
    __REACT_VERSION__: string;
    __USE_FIBER__: Fiber | undefined;
    __USE_FIBER_MATCH__: boolean;
  }
}

const { FiberProvider, useFiber: useReferenceFiber } = createFiberReference(React);
const UseFiberScenarios = createUseFiberScenarios({
  createPortal,
  react: React,
  useFiber: bippy.useFiber,
  useReferenceFiber,
});

const useFiberMatch = (referenceFiber: Fiber | undefined): boolean => {
  const fiber = bippy.useFiber();
  window.__USE_FIBER__ = fiber;
  return fiber !== undefined && (fiber === referenceFiber || fiber === referenceFiber?.alternate);
};

const UseFiberProbe = () => {
  const referenceFiber = useReferenceFiber();
  const [revision, setRevision] = React.useState(0);
  const isMatch = useFiberMatch(referenceFiber);
  window.__USE_FIBER_MATCH__ = isMatch;
  return React.createElement(
    "button",
    {
      "data-fiber-match": String(isMatch),
      "data-testid": "use-fiber-update",
      onClick: () => setRevision((previousRevision) => previousRevision + 1),
    },
    revision,
  );
};

const UseFiberVersionsApp = () =>
  React.createElement(
    FiberProvider,
    null,
    React.createElement(UseFiberProbe),
    React.createElement(UseFiberScenarios),
    React.createElement("div", { "data-testid": "test-child" }, React.version),
  );

window.__BIPPY__ = { ...bippy, ...bippySource };
window.__REACT_VERSION__ = React.version;
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element not found");
const appElement = React.createElement(UseFiberVersionsApp);
const createRoot = Reflect.get(ReactDOM, "createRoot");
if (typeof createRoot === "function") {
  const reactRoot: unknown = Reflect.apply(createRoot, ReactDOM, [rootElement]);
  if (typeof reactRoot !== "object" || reactRoot === null) {
    throw new Error("createRoot did not return a root");
  }
  const renderRoot = Reflect.get(reactRoot, "render");
  if (typeof renderRoot !== "function") throw new Error("root render method not found");
  Reflect.apply(renderRoot, reactRoot, [appElement]);
} else {
  const legacyRender = Reflect.get(ReactDOM, "render");
  if (typeof legacyRender !== "function") throw new Error("ReactDOM.render not found");
  Reflect.apply(legacyRender, ReactDOM, [appElement, rootElement]);
}
