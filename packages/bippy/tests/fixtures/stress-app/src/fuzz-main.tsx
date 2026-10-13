import "bippy/install-hook-only";

import * as bippy from "bippy";

import { runFuzz } from "./fuzz";

declare global {
  interface Window {
    __BIPPY__: typeof bippy;
    __FUZZ__: typeof runFuzz;
    __HARNESS_READY__: boolean | undefined;
  }
}

window.__BIPPY__ = bippy;
window.__FUZZ__ = runFuzz;
window.__HARNESS_READY__ = true;
