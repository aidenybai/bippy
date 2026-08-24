import "bippy/install-hook-only";

import * as bippy from "bippy";
import * as bippySource from "bippy/source";
import type { Fiber } from "bippy";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FiberReferenceProvider, TestParent, UseFiberProbe, UseFiberScenarios } from "./test-app";

declare global {
  interface Window {
    __BIPPY__: typeof bippy & typeof bippySource;
    __USE_FIBER__: Fiber | undefined;
    __USE_FIBER_MATCH__: boolean;
  }
}

window.__BIPPY__ = { ...bippy, ...bippySource };

createRoot(document.getElementById("root")!).render(
  <FiberReferenceProvider>
    <StrictMode>
      <UseFiberProbe />
      <UseFiberScenarios />
      <TestParent />
    </StrictMode>
  </FiberReferenceProvider>,
);
