import type * as Bippy from "bippy";
import type * as BippySource from "bippy/source";
import type { Fiber } from "bippy";

interface RefreshScenarioRunResult {
  status: "passed" | "failed";
  error?: string;
}

declare global {
  interface Window {
    __BIPPY__: typeof Bippy & typeof BippySource;
    __USE_FIBER__: Fiber | undefined;
    __HARNESS_READY__: boolean | undefined;
    __RUN_SCENARIO__: (scenarioName: string) => Promise<RefreshScenarioRunResult>;
    __SCENARIO_NAMES__: string[];
    __LATE_LOAD_RESULT__:
      | {
          onActiveFired: boolean;
          isInstrumentationActive: boolean;
          commitObservedAfterUpdate: boolean;
        }
      | undefined;
  }
}

export {};
