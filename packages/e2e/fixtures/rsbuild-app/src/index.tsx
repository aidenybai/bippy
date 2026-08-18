import "bippy/install-hook-only";

import * as bippy from "bippy";
import * as bippySource from "bippy/source";
import type { Fiber } from "bippy";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TestParent, UseFiberProbe } from "./test-app";

declare global {
  interface Window {
    __BIPPY__: typeof bippy & typeof bippySource;
    __USE_FIBER__: Fiber | undefined;
  }
}

window.__BIPPY__ = { ...bippy, ...bippySource };

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <UseFiberProbe />
      <TestParent />
    </StrictMode>,
  );
}
