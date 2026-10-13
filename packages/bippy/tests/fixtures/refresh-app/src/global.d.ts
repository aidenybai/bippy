declare module "react-refresh/runtime" {
  export interface RefreshUpdate {
    updatedFamilies: Set<unknown>;
    staleFamilies: Set<unknown>;
  }

  export interface RefreshFamily {
    current: unknown;
  }

  const runtime: {
    performReactRefresh(): RefreshUpdate | null;
    register(type: unknown, id: string): void;
    setSignature(
      type: unknown,
      key: string,
      forceReset?: boolean,
      getCustomHooks?: () => unknown[],
    ): void;
    collectCustomHooksForSignature(type: unknown): void;
    getFamilyByID(id: string): RefreshFamily | undefined;
    getFamilyByType(type: unknown): RefreshFamily | undefined;
    findAffectedHostInstances(families: RefreshFamily[]): Set<unknown>;
    injectIntoGlobalHook(globalObject: typeof globalThis): void;
    createSignatureFunctionForTransform(): <ComponentType>(
      type: ComponentType,
      key?: string,
      forceReset?: boolean,
      getCustomHooks?: () => unknown[],
    ) => ComponentType;
    isLikelyComponentType(type: unknown): boolean;
    _getMountedRootCount(): number;
  };
  export default runtime;
}

interface ScenarioRunResult {
  status: "passed" | "failed";
  error?: string;
}

interface Window {
  __BIPPY__: typeof import("bippy");
  __HARNESS_READY__: boolean | undefined;
  __RUN_SCENARIO__: (scenarioName: string) => Promise<ScenarioRunResult>;
  __SCENARIO_NAMES__: string[];
  __LATE_LOAD_RESULT__:
    | {
        onActiveFired: boolean;
        isInstrumentationActive: boolean;
        commitObservedAfterUpdate: boolean;
      }
    | undefined;
  IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
