import {
  areFiberEqual,
  didFiberCommit,
  didFiberRender,
  getDisplayName,
  getFiberId,
  getFiberStack,
  getLatestFiber,
  getMutatedHostFibers,
  getNearestHostFiber,
  getNearestHostFibers,
  getTimings,
  getType,
  hasMemoCache,
  instrument,
  isCompositeFiber,
  isFiber,
  isHostFiber,
  isInstrumentationActive,
  isValidFiber,
  traverseFiber,
  traverseProps,
  traverseState,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
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
  const didRunRef = useRef(false);

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

    traverseFiber(rootFiber, (fiber) => {
      const displayName = getDisplayName(fiber.type);
      if (displayName === "TestParent") testParentFiber = fiber;
      if (displayName === "TestChild") testChildFiber = fiber;
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

    setCoreResults(results);

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

    setSourceResults(results);
  };

  useEffect(() => {
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        runCoreTests(fiberRoot);
      },
    });
  }, [runCoreTests]);

  return (
    <ScrollView testID="root-scroll">
      <TestParent />
      <View testID="results-container">
        {Object.entries(coreResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
        {Object.entries(sourceResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
      </View>
    </ScrollView>
  );
};

export default App;
