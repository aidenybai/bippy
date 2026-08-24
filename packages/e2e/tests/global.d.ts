import type * as Bippy from "bippy";
import type * as BippySource from "bippy/source";
import type { Fiber } from "bippy";

interface RefreshScenarioRunResult {
  status: "passed" | "failed";
  error?: string;
}

interface FuzzRunResult {
  commitCount: number;
  mutationLog: string[];
  checkedHostNodes: number;
  failures: string[];
}

interface TransitionStressResult {
  commitCount: number;
  finalQuery: string;
  renderedMatches: number;
  expectedMatches: number;
  isPendingSettled: boolean;
}

interface SuspenseCycleResult {
  resolvedCycles: number;
  commitCount: number;
}

interface RootChurnResult {
  fiberRootCountBaseline: number;
  fiberRootCountWhileMounted: number;
  fiberRootCountAfterUnmount: number;
  instrumentationStillActive: boolean;
}

declare global {
  interface Window {
    __BIPPY__: typeof Bippy & typeof BippySource;
    __USE_FIBER__: Fiber | undefined;
    __USE_FIBER_MATCH__: boolean;
    __COMMIT_COUNT__: number;
    __HMR_EFFECT_LOG__: string[];
    __BIPPY_PROBE_READY__: boolean | undefined;
    __SECTION_NAMES__: string[];
    __FUZZ__: (seed: number, mutationCount: number) => Promise<FuzzRunResult>;
    __CONCURRENT__: {
      runTransitionStress: (updateCount: number) => Promise<TransitionStressResult>;
      runSuspenseCycles: (cycleCount: number) => Promise<SuspenseCycleResult>;
      runRootChurn: (rootCount: number) => Promise<RootChurnResult>;
    };
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
