import type * as Bippy from "bippy";
import type * as BippySource from "bippy/source";

declare global {
  interface Window {
    __BIPPY__: typeof Bippy & typeof BippySource;
  }
}

export {};
