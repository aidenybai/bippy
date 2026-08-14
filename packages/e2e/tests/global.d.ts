import type * as Bippy from "bippy";
import type * as BippySource from "bippy/source";
import type { Fiber } from "bippy";

declare global {
  interface Window {
    __BIPPY__: typeof Bippy & typeof BippySource;
    __USE_FIBER__: Fiber | undefined;
  }
}

export {};
