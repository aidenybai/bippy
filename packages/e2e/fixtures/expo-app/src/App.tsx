import {
  detectReactBuildType,
  didFiberCommit,
  didFiberRender,
  getDisplayName,
  getFiberFromHostInstance,
  getFiberId,
  getFiberStack,
  getLatestFiber,
  getMutatedHostFibers,
  getNearestHostFiber,
  getNearestHostFibers,
  getRDTHook,
  getTimings,
  getType,
  hasMemoCache,
  hasRDTHook,
  instrument,
  isClientEnvironment,
  isCompositeFiber,
  isFiber,
  isHostFiber,
  isInstrumentationActive,
  isRealReactDevtools,
  isReactRefresh,
  isValidElement,
  isValidFiber,
  overrideContext,
  overrideHookState,
  overrideProps,
  traverseContexts,
  traverseFiber,
  traverseProps,
  traverseRenderedFibers,
  traverseState,
  version,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { instrumentReactRefresh } from "bippy/react-refresh";
import { getDisplayNameFromSource, getFiberHooks, getOwnerStack, getSource } from "bippy/source";
import {
  Component,
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ScrollView, Text, View } from "react-native";

import { HmrTarget } from "./hmr-target";
import { SkiaProbe } from "./skia-probe";

const TestContext = createContext("default-context");

const TestChild = ({ name, count }: { name: string; count: number }) => {
  return (
    <View testID="test-child">
      <Text>
        {name} {count}
      </Text>
    </View>
  );
};

const TestMemoChild = memo(({ value }: { value: string }) => {
  return (
    <View testID="memo-child">
      <Text>{value}</Text>
    </View>
  );
});
TestMemoChild.displayName = "TestMemoChild";

const TestForwardRefChild = forwardRef<View>((_, ref) => {
  return (
    <View testID="forward-ref-child" ref={ref}>
      <Text>forward-ref</Text>
    </View>
  );
});
TestForwardRefChild.displayName = "TestForwardRefChild";

const TestContextConsumer = () => {
  const value = useContext(TestContext);
  return (
    <View testID="context-consumer">
      <Text>{value}</Text>
    </View>
  );
};

class TestClassComponent extends Component {
  override render() {
    return (
      <View testID="class-component">
        <Text>class</Text>
      </View>
    );
  }
}

const TestParent = () => {
  const [count, _setCount] = useState(0);
  return (
    <TestContext.Provider value="provided-value">
      <View testID="parent-host">
        <TestChild name="e2e-test" count={count} />
        <TestMemoChild value="memo-test" />
        <TestForwardRefChild />
        <TestContextConsumer />
        <TestClassComponent />
      </View>
      <Text testID="parent-host-sibling">host-sibling</Text>
    </TestContext.Provider>
  );
};

interface ResultRowProps {
  testID: string;
  value: string;
}

const ResultRow = ({ testID, value }: ResultRowProps) => <Text testID={testID}>{value}</Text>;

const findFibersByDisplayName = (rootFiber: Fiber, displayNames: string[]) => {
  const fibersByDisplayName = new Map<string, Fiber>();
  const targetDisplayNames = new Set(displayNames);
  traverseFiber(rootFiber, (fiber) => {
    const displayName = getDisplayName(fiber.type);
    if (displayName && targetDisplayNames.has(displayName)) {
      fibersByDisplayName.set(displayName, fiber);
    }
  });
  return fibersByDisplayName;
};

const OverridePropsChild = ({ count }: { count: number }) => (
  <View testID="override-props-view">
    <Text>override-props {count}</Text>
  </View>
);

const OverrideHookStateChild = () => {
  const [hookCount] = useState(0);
  return (
    <View testID="override-hook-view">
      <Text>override-hook {hookCount}</Text>
    </View>
  );
};

const OverrideContextContext = createContext("ctx-default");

const OverrideContextChild = () => {
  const contextValue = useContext(OverrideContextContext);
  return (
    <View testID="override-context-view">
      <Text>override-context {contextValue}</Text>
    </View>
  );
};

// memoized so the App-level result-row commits bail out here and never
// re-derive the probes' props/state, which would silently undo the overrides
const OverrideProbes = memo(() => (
  <View testID="override-probes">
    <OverridePropsChild count={0} />
    <OverrideHookStateChild />
    <OverrideContextContext.Provider value="ctx-provided">
      <OverrideContextChild />
    </OverrideContextContext.Provider>
  </View>
));
OverrideProbes.displayName = "OverrideProbes";

const App = () => {
  const [coreResults, setCoreResults] = useState<Record<string, string>>({});
  const [sourceResults, setSourceResults] = useState<Record<string, string>>({});
  const [hmrResults, setHmrResults] = useState<Record<string, string>>({});
  const [skiaResults, setSkiaResults] = useState<Record<string, string>>({});
  const [skiaRevision, setSkiaRevision] = useState(0);
  const [isSkiaTreeVisible, setIsSkiaTreeVisible] = useState(true);
  const didRunRef = useRef(false);
  const didRunSkiaRef = useRef(false);
  const didScheduleSkiaUpdateRef = useRef(false);
  const didRunOverridesRef = useRef(false);
  const fiberRootRef = useRef<FiberRoot | null>(null);
  const hostProbeRef = useRef<View | null>(null);

  const runCoreTests = useCallback((fiberRoot: FiberRoot) => {
    if (didRunRef.current) return;

    const rootFiber = fiberRoot.current;
    if (!rootFiber?.child) return;

    const fibersByDisplayName = findFibersByDisplayName(rootFiber, [
      "TestParent",
      "TestChild",
      "TestContextConsumer",
    ]);
    const testParentFiber = fibersByDisplayName.get("TestParent") ?? null;
    const testChildFiber = fibersByDisplayName.get("TestChild") ?? null;
    const testContextConsumerFiber = fibersByDisplayName.get("TestContextConsumer") ?? null;

    if (!testParentFiber || !testChildFiber) return;
    didRunRef.current = true;
    fiberRootRef.current = fiberRoot;

    const results: Record<string, string> = {};

    results["instrument-active"] = String(isInstrumentationActive());

    const testChildHostFiber = getNearestHostFiber(testChildFiber) ?? null;

    results["isFiber"] = String(isFiber(rootFiber));
    results["isFiber-null"] = String(isFiber(null));
    results["isFiber-object"] = String(isFiber({}));
    results["isValidFiber"] = String(isValidFiber(rootFiber));

    if (testChildHostFiber) {
      results["isHostFiber-host"] = String(isHostFiber(testChildHostFiber));
    }
    if (testChildFiber) {
      results["isHostFiber-composite"] = String(isHostFiber(testChildFiber));
      results["isCompositeFiber"] = String(isCompositeFiber(testChildFiber));
      results["displayName-TestChild"] = getDisplayName(testChildFiber.type) ?? "null";
    }
    if (testParentFiber) {
      results["displayName-TestParent"] = getDisplayName(testParentFiber.type) ?? "null";
    }

    if (testChildFiber) {
      results["didFiberRender"] = String(didFiberRender(testChildFiber));
      results["didFiberCommit"] = String(didFiberCommit(testChildFiber));

      const timings = getTimings(testChildFiber);
      results["selfTime"] = String(timings.selfTime);
      results["totalTime"] = String(timings.totalTime);

      const fiberStack = getFiberStack(testChildFiber);
      results["fiberStack-length"] = String(fiberStack.length);

      const nearestHost = getNearestHostFiber(testChildFiber);
      results["nearestHostFiber"] = String(nearestHost !== null);

      if (testParentFiber) {
        const hostFibers = getNearestHostFibers(testParentFiber);
        results["nearestHostFibers-count"] = String(hostFibers.length);
      }

      const latestFiber = getLatestFiber(testChildFiber);
      results["getLatestFiber"] = String(isFiber(latestFiber));

      const fiberId = getFiberId(testChildFiber);
      results["getFiberId"] = String(typeof fiberId === "number");

      results["hasMemoCache"] = String(hasMemoCache(testChildFiber));

      const innerType = getType(testChildFiber.type);
      results["getType"] = String(innerType !== null);

      let traverseCount = 0;
      traverseFiber(rootFiber, () => {
        traverseCount++;
      });
      results["traverseFiber-count"] = String(traverseCount);

      const propValues: string[] = [];
      traverseProps(testChildFiber, (propName) => {
        propValues.push(propName);
      });
      results["traverseProps-keys"] = propValues.join(",");
    }

    if (testParentFiber) {
      const stateValues: string[] = [];
      traverseState(testParentFiber, (nextState) => {
        if (nextState && "memoizedState" in nextState) {
          stateValues.push(String(nextState.memoizedState));
        }
      });
      results["traverseState-values"] = stateValues.join(",");
    }

    const mutatedHostFibers = getMutatedHostFibers(rootFiber);
    results["mutatedHostFibers-count"] = String(mutatedHostFibers.length);

    results["isClientEnvironment"] = String(isClientEnvironment());
    results["hasRDTHook"] = String(hasRDTHook());
    // react-native dev builds ship the real react-devtools backend, so the
    // hook has getFiberRoots and isRealReactDevtools reports true here
    results["isRealReactDevtools"] = String(isRealReactDevtools());
    // hermes does not expose function source to toString, so react-refresh's
    // inject-string sniff can legitimately resolve either way on native
    results["isReactRefresh"] = String(isReactRefresh());
    results["version-is-string"] = String(typeof version === "string" && version.length > 0);

    const rdtHook = getRDTHook();
    results["rdtHook-renderers-count"] = String(rdtHook.renderers.size);
    results["renderer-supports-overrideProps"] = String(
      Array.from(rdtHook.renderers.values()).some(
        (renderer) => typeof renderer.overrideProps === "function",
      ),
    );
    results["renderer-supports-scheduleUpdate"] = String(
      Array.from(rdtHook.renderers.values()).some(
        (renderer) => typeof renderer.scheduleUpdate === "function",
      ),
    );
    const firstRenderer = rdtHook.renderers.values().next().value;
    results["detectReactBuildType"] = firstRenderer
      ? detectReactBuildType(firstRenderer)
      : "no-renderer";

    results["isValidElement-element"] = String(
      isValidElement(<TestChild name="probe" count={0} />),
    );
    results["isValidElement-object"] = String(isValidElement({}));

    if (testContextConsumerFiber) {
      let providedContextValue: string | null = null;
      traverseContexts(testContextConsumerFiber, (context) => {
        if (context && typeof context.memoizedValue === "string") {
          providedContextValue = context.memoizedValue;
          return true;
        }
      });
      results["traverseContexts-value"] = providedContextValue ?? "null";
    }

    if (testParentFiber) {
      try {
        results["getFiberHooks-nonempty"] = String(getFiberHooks(testParentFiber).length > 0);
      } catch {
        results["getFiberHooks-nonempty"] = "error";
      }
    }

    let renderedFiberCount = 0;
    traverseRenderedFibers(rootFiber, () => {
      renderedFiberCount++;
    });
    results["traverseRenderedFibers-count"] = String(renderedFiberCount);

    const fiberFromHostInstance = hostProbeRef.current
      ? getFiberFromHostInstance(hostProbeRef.current)
      : null;
    results["getFiberFromHostInstance"] = String(
      fiberFromHostInstance !== null && isFiber(fiberFromHostInstance),
    );

    results["core-done"] = "true";
    setCoreResults(results);

    instrument({
      onCommitFiberRoot: () => {
        setCoreResults((previousResults) =>
          previousResults["instrument-commit-fired"] === "true"
            ? previousResults
            : { ...previousResults, "instrument-commit-fired": "true" },
        );
      },
    });

    void runSourceTests(testChildFiber, testParentFiber);
  }, []);

  const runSkiaTests = useCallback((rendererID: number, fiberRoot: FiberRoot) => {
    if (didRunSkiaRef.current) return;
    const renderer = getRDTHook().renderers.get(rendererID);
    if (renderer?.rendererPackageName !== "react-native-skia") return;

    const rootFiber = fiberRoot.current;
    const fibersByDisplayName = findFibersByDisplayName(rootFiber, [
      "SkiaCompoundTree",
      "SkiaMemoLeaf",
    ]);
    const compoundTreeFiber = fibersByDisplayName.get("SkiaCompoundTree") ?? null;
    const memoLeafFiber = fibersByDisplayName.get("SkiaMemoLeaf") ?? null;
    if (!compoundTreeFiber || !memoLeafFiber) return;

    if (!memoLeafFiber.alternate) {
      if (!didScheduleSkiaUpdateRef.current) {
        didScheduleSkiaUpdateRef.current = true;
        setSkiaRevision(2);
      }
      return;
    }
    didRunSkiaRef.current = true;

    const results: Record<string, string> = {};
    const nearestHostFiber = getNearestHostFiber(memoLeafFiber);
    const nearestHostFibers = getNearestHostFibers(compoundTreeFiber);
    const timings = getTimings(memoLeafFiber);
    const rendererCount = getRDTHook().renderers.size;

    results["skia-renderer-package"] = renderer.rendererPackageName;
    results["skia-renderer-version"] = renderer.version;
    results["skia-renderer-count"] = String(rendererCount);
    results["skia-build-type"] = detectReactBuildType(renderer);
    results["skia-root-valid"] = String(isValidFiber(rootFiber));
    results["skia-compound-valid"] = String(isValidFiber(compoundTreeFiber));
    results["skia-memo-valid"] = String(isValidFiber(memoLeafFiber));
    results["skia-compound-display-name"] = getDisplayName(compoundTreeFiber.type) ?? "null";
    results["skia-memo-display-name"] = getDisplayName(memoLeafFiber.type) ?? "null";
    results["skia-composite"] = String(isCompositeFiber(memoLeafFiber));
    results["skia-composite-is-host"] = String(isHostFiber(memoLeafFiber));
    results["skia-nearest-host"] = String(
      nearestHostFiber !== null && isHostFiber(nearestHostFiber),
    );
    results["skia-nearest-host-count"] = String(nearestHostFibers.length);
    results["skia-host-display-name"] = nearestHostFiber
      ? (getDisplayName(nearestHostFiber.type) ?? "null")
      : "null";
    results["skia-did-render"] = String(didFiberRender(memoLeafFiber));
    results["skia-did-commit"] = String(didFiberCommit(memoLeafFiber));
    results["skia-self-time"] = String(timings.selfTime);
    results["skia-total-time"] = String(timings.totalTime);
    results["skia-stack-length"] = String(getFiberStack(memoLeafFiber).length);
    results["skia-fiber-id"] = String(typeof getFiberId(memoLeafFiber) === "number");
    results["skia-latest-fiber"] = String(isValidFiber(getLatestFiber(memoLeafFiber)));
    results["skia-has-alternate"] = String(memoLeafFiber.alternate !== null);
    results["skia-type"] = String(getType(memoLeafFiber.type) !== null);
    results["skia-has-memo-cache"] = String(hasMemoCache(memoLeafFiber));

    let traversedFiberCount = 0;
    traverseFiber(rootFiber, () => {
      traversedFiberCount++;
    });
    results["skia-traverse-count"] = String(traversedFiberCount);

    let renderedFiberCount = 0;
    traverseRenderedFibers(rootFiber, () => {
      renderedFiberCount++;
    });
    results["skia-rendered-count"] = String(renderedFiberCount);
    results["skia-mutated-host-count"] = String(getMutatedHostFibers(rootFiber).length);

    const memoPropNames: string[] = [];
    traverseProps(memoLeafFiber, (propName, nextValue, previousValue) => {
      memoPropNames.push(propName);
      if (propName === "revision") {
        results["skia-next-revision"] = String(nextValue);
        results["skia-previous-revision"] = String(previousValue);
      }
    });
    results["skia-prop-names"] = memoPropNames.join(",");

    const hostPropNames: string[] = [];
    if (nearestHostFiber) {
      traverseProps(nearestHostFiber, (propName) => {
        hostPropNames.push(propName);
      });
    }
    results["skia-host-prop-names"] = hostPropNames.join(",");

    let contextValue: string | null = null;
    traverseContexts(memoLeafFiber, (context) => {
      if (context && typeof context.memoizedValue === "string") {
        contextValue = context.memoizedValue;
        return true;
      }
    });
    results["skia-context-value"] = contextValue ?? "null";
    results["skia-done"] = "true";
    setSkiaResults(results);
    setIsSkiaTreeVisible(false);
  }, []);

  const runSourceTests = async (testChildFiber: Fiber | null, testParentFiber: Fiber | null) => {
    const results: Record<string, string> = {};

    if (testChildFiber) {
      try {
        const source = await getSource(testChildFiber);
        results["source-fileName"] = source?.fileName ?? "null";
        results["source-lineNumber"] = String(source?.lineNumber ?? "null");
        results["source-columnNumber"] = String(source?.columnNumber ?? "null");
      } catch {
        results["source-fileName"] = "error";
        results["source-lineNumber"] = "error";
        results["source-columnNumber"] = "error";
      }

      try {
        const ownerStack = await getOwnerStack(testChildFiber);
        results["ownerStack-length"] = String(ownerStack.length);
        results["ownerStack-names"] = ownerStack
          .map((frame) => frame.functionName)
          .filter(Boolean)
          .join(",");
      } catch {
        results["ownerStack-length"] = "error";
        results["ownerStack-names"] = "error";
      }

      try {
        const displayNameFromSource = await getDisplayNameFromSource(testChildFiber);
        results["displayNameFromSource"] = displayNameFromSource ?? "null";
      } catch {
        results["displayNameFromSource"] = "error";
      }
    }

    if (testParentFiber) {
      try {
        const parentSource = await getSource(testParentFiber);
        results["parentSource-fileName"] = parentSource?.fileName ?? "null";
      } catch {
        results["parentSource-fileName"] = "error";
      }

      try {
        const parentOwnerStack = await getOwnerStack(testParentFiber);
        results["parentOwnerStack-length"] = String(parentOwnerStack.length);
      } catch {
        results["parentOwnerStack-length"] = "error";
      }
    }

    results["source-done"] = "true";
    setSourceResults(results);
  };

  useEffect(() => {
    const instrumentation = instrument({
      onCommitFiberRoot: (rendererID, fiberRoot) => {
        runCoreTests(fiberRoot);
        runSkiaTests(rendererID, fiberRoot);
      },
      onCommitFiberUnmount: (rendererID, fiber) => {
        const renderer = getRDTHook().renderers.get(rendererID);
        if (
          renderer?.rendererPackageName !== "react-native-skia" ||
          getDisplayName(fiber.type) !== "SkiaCompoundTree"
        ) {
          return;
        }
        setSkiaResults((previousResults) => ({
          ...previousResults,
          "skia-unmount-fired": "true",
        }));
      },
    });
    setSkiaRevision(1);
    return instrumentation;
  }, [runCoreTests, runSkiaTests]);

  // the probes live in a memoized subtree, so the result-row commits below
  // bail out before reaching them and cannot undo the overrides
  useEffect(() => {
    if (didRunOverridesRef.current) return;
    if (coreResults["core-done"] !== "true") return;
    const fiberRoot = fiberRootRef.current;
    if (!fiberRoot?.current) return;
    didRunOverridesRef.current = true;

    let overridePropsTargetFiber: Fiber | null = null;
    let overrideHookStateTargetFiber: Fiber | null = null;
    let overrideContextTargetFiber: Fiber | null = null;
    traverseFiber(fiberRoot.current, (fiber) => {
      const displayName = getDisplayName(fiber.type);
      if (displayName === "OverridePropsChild") overridePropsTargetFiber = fiber;
      if (displayName === "OverrideHookStateChild") overrideHookStateTargetFiber = fiber;
      if (displayName === "OverrideContextChild") overrideContextTargetFiber = fiber;
    });

    if (overridePropsTargetFiber) {
      overrideProps(getLatestFiber(overridePropsTargetFiber), { count: 123 });
    }
    if (overrideHookStateTargetFiber) {
      overrideHookState(getLatestFiber(overrideHookStateTargetFiber), 0, 7);
    }
    if (overrideContextTargetFiber) {
      overrideContext(
        getLatestFiber(overrideContextTargetFiber),
        OverrideContextContext,
        "ctx-overridden",
      );
    }
  }, [coreResults]);

  useEffect(() => {
    let refreshCount = 0;
    const unsubscribeRefresh = instrumentReactRefresh({
      onRefresh: (update) => {
        refreshCount++;
        const updatedNames = update.updatedComponents
          .map((componentType) => getDisplayName(componentType) ?? "unknown")
          .join(",");
        console.log(
          `[bippy-hmr] refresh #${refreshCount} updated=[${updatedNames}] fibers=${update.updatedFibers.length} paths=[${update.filePaths.join(",")}]`,
        );
        setHmrResults((previousResults) => ({
          ...previousResults,
          "refresh-count": String(refreshCount),
          "refresh-last-update": updatedNames,
          "refresh-last-fibers": update.updatedFibers
            .map((updatedFiber) => getDisplayName(updatedFiber.type) ?? "unknown")
            .join(","),
          "refresh-fibers-valid": String(
            update.updatedFibers.every((updatedFiber) => isFiber(updatedFiber)),
          ),
          "refresh-last-paths": update.filePaths.join(","),
        }));
      },
    });
    const rdtHook = getRDTHook();
    const rendererDiagnostics = Array.from(
      rdtHook.renderers.entries(),
      ([rendererId, renderer]) => {
        return `${rendererId}:scheduleRefresh=${typeof renderer.scheduleRefresh}`;
      },
    ).join(" ");
    console.log(`[bippy-hmr] listener=true renderers={${rendererDiagnostics}}`);
    setHmrResults((previousResults) => ({
      ...previousResults,
      "refresh-listener": "true",
    }));
    return unsubscribeRefresh;
  }, []);

  return (
    <ScrollView testID="root-scroll">
      <TestParent />
      <OverrideProbes />
      <HmrTarget />
      <SkiaProbe isTreeVisible={isSkiaTreeVisible} revision={skiaRevision} />
      <View testID="host-probe" ref={hostProbeRef} />
      <View testID="results-container">
        {Object.entries(coreResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
        {Object.entries(sourceResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
        {Object.entries(hmrResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
        {Object.entries(skiaResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
      </View>
    </ScrollView>
  );
};

export default App;
