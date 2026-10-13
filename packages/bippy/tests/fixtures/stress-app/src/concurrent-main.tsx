import "bippy/install-hook-only";

import * as bippy from "bippy";

import { runRootChurn, runSuspenseCycles, runTransitionStress } from "./concurrent";

declare global {
  interface Window {
    __BIPPY__: typeof bippy;
    __CONCURRENT__: {
      runTransitionStress: typeof runTransitionStress;
      runSuspenseCycles: typeof runSuspenseCycles;
      runRootChurn: typeof runRootChurn;
    };
    __HARNESS_READY__: boolean | undefined;
  }
}

window.__BIPPY__ = bippy;
window.__CONCURRENT__ = { runTransitionStress, runSuspenseCycles, runRootChurn };
window.__HARNESS_READY__ = true;
