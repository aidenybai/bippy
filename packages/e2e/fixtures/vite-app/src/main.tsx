import "bippy/install-hook-only";

import * as bippy from "bippy";
import * as bippySource from "bippy/source";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TestParent } from "./test-app";

declare global {
  interface Window {
    __BIPPY__: typeof bippy & typeof bippySource;
  }
}

window.__BIPPY__ = { ...bippy, ...bippySource };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TestParent />
  </StrictMode>,
);
