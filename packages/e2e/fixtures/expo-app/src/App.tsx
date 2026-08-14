import {
  detectReactBuildType,
  didFiberCommit,
  didFiberRender,
  getDisplayName,
  getFiberFromHostInstance,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getRenderer,
  getType,
  hasMemoCache,
  hasRDTHook,
  instrument,
  isCompositeFiber,
  isFiber,
  isHostFiber,
  isInstrumentationActive,
  isRealReactDevtools,
  isValidElement,
  traverseFiber,
  traverseRenderedFibers,
  useFiber,
  version,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import {
  getDisplayNameFromSource,
  getFiberHooks,
  getOwnerStack,
  getSource,
  getSourceMap,
  type SourceFetch,
} from "bippy/source";
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
import { NativeModules, ScrollView, Text, View } from "react-native";

import { getObservedSkiaMemoLeafFiber, SkiaProbe } from "./skia-probe";

const TestContext = createContext("default-context");
let observedTestParentFiber: Fiber | undefined;
const requestedSourceUrls: string[] = [];
const sourceFetch: SourceFetch = (url, init) => {
  requestedSourceUrls.push(url);
  return fetch(url, init);
};
const getRuntimeBundleUrl = (): string | null => {
  const sourceCodeModule: unknown = Reflect.get(NativeModules, "SourceCode");
  if (typeof sourceCodeModule !== "object" || sourceCodeModule === null) return null;
  const getConstants: unknown = Reflect.get(sourceCodeModule, "getConstants");
  const sourceCodeConstants =
    typeof getConstants === "function"
      ? Reflect.apply(getConstants, sourceCodeModule, [])
      : sourceCodeModule;
  if (typeof sourceCodeConstants !== "object" || sourceCodeConstants === null) return null;
  const scriptUrl: unknown = Reflect.get(sourceCodeConstants, "scriptURL");
  return typeof scriptUrl === "string" ? scriptUrl : null;
};

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
  observedTestParentFiber = useFiber();
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

    const fibersByDisplayName = findFibersByDisplayName(rootFiber, ["TestParent", "TestChild"]);
    const testParentFiber = fibersByDisplayName.get("TestParent") ?? null;
    const testChildFiber = fibersByDisplayName.get("TestChild") ?? null;

    if (!testParentFiber || !testChildFiber) return;
    didRunRef.current = true;
    fiberRootRef.current = fiberRoot;

    const results: Record<string, string> = {};

    results["instrument-active"] = String(isInstrumentationActive());
    results["useFiber"] = String(observedTestParentFiber === testParentFiber);

    const testChildHostFiber = traverseFiber(testChildFiber, isHostFiber);

    results["isFiber"] = String(isFiber(rootFiber));
    results["isFiber-null"] = String(isFiber(null));
    results["isFiber-object"] = String(isFiber({}));

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
    }

    results["hasRDTHook"] = String(hasRDTHook());
    // react-native dev builds ship the real react-devtools backend, so the
    // hook has getFiberRoots and isRealReactDevtools reports true here
    results["isRealReactDevtools"] = String(isRealReactDevtools());
    results["version-is-string"] = String(typeof version === "string" && version.length > 0);

    const rdtHook = getRDTHook();
    const renderer = getRenderer(testChildFiber);
    results["rdtHook-renderers-count"] = String(rdtHook.renderers.size);
    results["getRenderer"] = String(renderer !== null);
    results["renderer-supports-overrideProps"] = String(
      typeof renderer?.overrideProps === "function",
    );
    results["renderer-supports-scheduleUpdate"] = String(
      typeof renderer?.scheduleUpdate === "function",
    );
    results["detectReactBuildType"] = renderer ? detectReactBuildType(renderer) : "no-renderer";

    results["isValidElement-element"] = String(
      isValidElement(<TestChild name="probe" count={0} />),
    );
    results["isValidElement-object"] = String(isValidElement({}));

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

  const runSkiaTests = useCallback(async (rendererID: number, fiberRoot: FiberRoot) => {
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
    const hostFiber = traverseFiber(memoLeafFiber, isHostFiber);
    const rendererCount = getRDTHook().renderers.size;

    results["skia-renderer-package"] = renderer.rendererPackageName;
    results["skia-renderer-version"] = renderer.version;
    results["skia-renderer-count"] = String(rendererCount);
    results["skia-build-type"] = detectReactBuildType(renderer);
    results["skia-root-valid"] = String(isFiber(rootFiber));
    results["skia-compound-valid"] = String(isFiber(compoundTreeFiber));
    results["skia-memo-valid"] = String(isFiber(memoLeafFiber));
    results["skia-useFiber"] = String(getObservedSkiaMemoLeafFiber() === memoLeafFiber);
    results["skia-compound-display-name"] = getDisplayName(compoundTreeFiber.type) ?? "null";
    results["skia-memo-display-name"] = getDisplayName(memoLeafFiber.type) ?? "null";
    results["skia-composite"] = String(isCompositeFiber(memoLeafFiber));
    results["skia-composite-is-host"] = String(isHostFiber(memoLeafFiber));
    results["skia-host-found"] = String(hostFiber !== null);
    results["skia-host-display-name"] = hostFiber
      ? (getDisplayName(hostFiber.type) ?? "null")
      : "null";
    results["skia-did-render"] = String(didFiberRender(memoLeafFiber));
    results["skia-did-commit"] = String(didFiberCommit(memoLeafFiber));
    results["skia-fiber-id"] = String(typeof getFiberId(memoLeafFiber) === "number");
    results["skia-latest-fiber"] = String(isFiber(getLatestFiber(memoLeafFiber)));
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
    results["skia-next-revision"] = String(memoLeafFiber.memoizedProps.revision);
    results["skia-previous-revision"] = String(memoLeafFiber.alternate.memoizedProps.revision);

    try {
      const source = await getSource(memoLeafFiber, true, sourceFetch);
      results["skia-source-fileName"] = source?.fileName ?? "null";
      results["skia-source-lineNumber"] = String(source?.lineNumber ?? "null");
    } catch {
      results["skia-source-fileName"] = "error";
      results["skia-source-lineNumber"] = "error";
    }

    try {
      const displayName = await getDisplayNameFromSource(memoLeafFiber, true, sourceFetch);
      results["skia-source-displayName"] = displayName ?? "null";
    } catch {
      results["skia-source-displayName"] = "error";
    }

    results["skia-done"] = "true";
    setSkiaResults(results);
    setIsSkiaTreeVisible(false);
  }, []);

  const runSourceTests = async (testChildFiber: Fiber | null, testParentFiber: Fiber | null) => {
    const results: Record<string, string> = {};
    const runtimeBundleUrl = getRuntimeBundleUrl();
    results["runtime-bundle-url"] = runtimeBundleUrl ?? "null";

    if (runtimeBundleUrl) {
      try {
        const runtimeSourceMap = await getSourceMap(runtimeBundleUrl, false, sourceFetch);
        results["runtime-source-map-source"] =
          runtimeSourceMap?.sources.find((sourceFileName) => sourceFileName.includes("App.tsx")) ??
          "null";
      } catch {
        results["runtime-source-map-source"] = "error";
      }
    }

    if (testChildFiber) {
      try {
        const source = await getSource(testChildFiber, true, sourceFetch);
        results["source-fileName"] = source?.fileName ?? "null";
        results["source-lineNumber"] = String(source?.lineNumber ?? "null");
        results["source-columnNumber"] = String(source?.columnNumber ?? "null");
      } catch {
        results["source-fileName"] = "error";
        results["source-lineNumber"] = "error";
        results["source-columnNumber"] = "error";
      }

      try {
        const ownerStack = await getOwnerStack(testChildFiber, true, sourceFetch);
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
        const displayNameFromSource = await getDisplayNameFromSource(
          testChildFiber,
          true,
          sourceFetch,
        );
        results["displayNameFromSource"] = displayNameFromSource ?? "null";
      } catch {
        results["displayNameFromSource"] = "error";
      }
    }

    if (testParentFiber) {
      try {
        const parentSource = await getSource(testParentFiber, true, sourceFetch);
        results["parentSource-fileName"] = parentSource?.fileName ?? "null";
      } catch {
        results["parentSource-fileName"] = "error";
      }

      try {
        const parentOwnerStack = await getOwnerStack(testParentFiber, true, sourceFetch);
        results["parentOwnerStack-length"] = String(parentOwnerStack.length);
      } catch {
        results["parentOwnerStack-length"] = "error";
      }
    }

    results["source-fetch-urls"] = Array.from(new Set(requestedSourceUrls)).join(",");
    results["source-done"] = "true";
    setSourceResults(results);
  };

  useEffect(() => {
    const instrumentation = instrument({
      onCommitFiberRoot: (rendererID, fiberRoot) => {
        runCoreTests(fiberRoot);
        void runSkiaTests(rendererID, fiberRoot);
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
      const latestFiber = getLatestFiber(overridePropsTargetFiber);
      getRenderer(latestFiber)?.overrideProps?.(latestFiber, ["count"], 123);
    }
    if (overrideHookStateTargetFiber) {
      const latestFiber = getLatestFiber(overrideHookStateTargetFiber);
      getRenderer(latestFiber)?.overrideHookState?.(latestFiber, 0, [], 7);
    }
    if (overrideContextTargetFiber) {
      let providerFiber = getLatestFiber(overrideContextTargetFiber).return;
      while (
        providerFiber &&
        providerFiber.type !== OverrideContextContext &&
        providerFiber.type?.Provider !== OverrideContextContext
      ) {
        providerFiber = providerFiber.return;
      }
      if (providerFiber) {
        const renderer = getRenderer(providerFiber);
        renderer?.overrideProps?.(providerFiber, ["value"], "ctx-overridden");
        if (providerFiber.alternate) {
          renderer?.overrideProps?.(providerFiber.alternate, ["value"], "ctx-overridden");
        }
      }
    }
  }, [coreResults]);

  return (
    <ScrollView testID="root-scroll">
      <TestParent />
      <OverrideProbes />
      <SkiaProbe isTreeVisible={isSkiaTreeVisible} revision={skiaRevision} />
      <View testID="host-probe" ref={hostProbeRef} />
      <View testID="results-container">
        {Object.entries(coreResults).map(([key, value]) => (
          <ResultRow key={key} testID={`result-${key}`} value={value} />
        ))}
        {Object.entries(sourceResults).map(([key, value]) => (
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
