import {
  areFiberEqual,
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
  HostComponentTag,
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
  overrideProps,
  secure,
  shouldFilterFiber,
  traverseContexts,
  traverseFiber,
  traverseProps,
  traverseRenderedFibers,
  traverseState,
  version,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { onReactRefresh } from "bippy/react-refresh";
import { getDisplayNameFromSource, getOwnerStack, getSource } from "bippy/source";
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

const App = () => {
  const [coreResults, setCoreResults] = useState<Record<string, string>>({});
  const [sourceResults, setSourceResults] = useState<Record<string, string>>({});
  const [hmrResults, setHmrResults] = useState<Record<string, string>>({});
  const didRunRef = useRef(false);
  const hostProbeRef = useRef<View | null>(null);

  const runCoreTests = useCallback((fiberRoot: FiberRoot) => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    const rootFiber = fiberRoot.current;
    if (!rootFiber?.child) return;

    const results: Record<string, string> = {};

    results["instrument-active"] = String(isInstrumentationActive());

    let testParentFiber: Fiber | null = null;
    let testChildFiber: Fiber | null = null;
    let testChildHostFiber: Fiber | null = null;
    let testContextConsumerFiber: Fiber | null = null;

    traverseFiber(rootFiber, (fiber) => {
      const displayName = getDisplayName(fiber.type);
      if (displayName === "TestParent") testParentFiber = fiber;
      if (displayName === "TestChild") testChildFiber = fiber;
      if (displayName === "TestContextConsumer") testContextConsumerFiber = fiber;
    });

    if (testChildFiber) {
      testChildHostFiber = getNearestHostFiber(testChildFiber) ?? null;
    }

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

      if (testChildFiber.alternate) {
        results["areFiberEqual-alternate"] = String(
          areFiberEqual(testChildFiber, testChildFiber.alternate),
        );
      }

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
    results["isRealReactDevtools"] = String(isRealReactDevtools());
    // hermes does not expose function source to toString, so react-refresh's
    // inject-string sniff can legitimately resolve either way on native
    results["isReactRefresh"] = String(isReactRefresh());
    results["version-is-string"] = String(typeof version === "string" && version.length > 0);

    const rdtHook = getRDTHook();
    results["rdtHook-renderers-count"] = String(rdtHook.renderers.size);
    const firstRenderer = rdtHook.renderers.values().next().value;
    results["detectReactBuildType"] = firstRenderer
      ? detectReactBuildType(firstRenderer)
      : "no-renderer";

    results["isValidElement-element"] = String(
      isValidElement(<TestChild name="probe" count={0} />),
    );
    results["isValidElement-object"] = String(isValidElement({}));

    if (testChildHostFiber) {
      results["shouldFilterFiber-host"] = String(shouldFilterFiber(testChildHostFiber));
      results["shouldFilterFiber-tag-is-host"] = String(
        testChildHostFiber.tag === HostComponentTag,
      );
    }
    if (testChildFiber) {
      results["shouldFilterFiber-composite"] = String(shouldFilterFiber(testChildFiber));
    }

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

    instrument(
      secure({
        onCommitFiberRoot: () => {
          setCoreResults((previousResults) =>
            previousResults["secure-commit-fired"] === "true"
              ? previousResults
              : { ...previousResults, "secure-commit-fired": "true" },
          );
        },
      }),
    );

    if (testChildFiber) {
      overrideProps(testChildFiber, { count: 123 });
    }

    void runSourceTests(testChildFiber, testParentFiber);
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
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        runCoreTests(fiberRoot);
      },
    });
  }, [runCoreTests]);

  useEffect(() => {
    let refreshCount = 0;
    const refreshListener = onReactRefresh((update) => {
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
    });
    const rdtHook = getRDTHook();
    const rendererDiagnostics = Array.from(
      rdtHook.renderers.entries(),
      ([rendererId, renderer]) => {
        return `${rendererId}:scheduleRefresh=${typeof renderer.scheduleRefresh}`;
      },
    ).join(" ");
    console.log(
      `[bippy-hmr] listener=${String(refreshListener !== null)} renderers={${rendererDiagnostics}}`,
    );
    setHmrResults((previousResults) => ({
      ...previousResults,
      "refresh-listener": String(refreshListener !== null),
    }));
    return () => refreshListener?.dispose();
  }, []);

  return (
    <ScrollView testID="root-scroll">
      <TestParent />
      <HmrTarget />
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
      </View>
    </ScrollView>
  );
};

export default App;
