import "../src/index.js";

import React from "react";
import { sourceFetch } from "./source-fetch.js";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import {
  didFiberRender,
  getDisplayName,
  getFiberId,
  getLatestFiber,
  instrument,
  traverseFiber,
  traverseRenderedFibers,
} from "../src/index.js";
import { getOwnerStack, getSource } from "../src/source/index.js";
import type { Fiber, FiberRoot, RenderPhase } from "../src/index.js";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

interface StressCase {
  children: React.ReactNode;
  output: string;
}

interface StressLeafProps {
  label: string;
  registerState: (label: string, setIsAlternate: React.Dispatch<boolean>) => void;
}

interface StressParentProps {
  children: React.ReactNode;
}

interface BailoutTreeProps {
  contextValue: string;
}

interface AsyncLeafProps {
  deferred: Deferred<string>;
}

interface PhaseEntry {
  name: string | null;
  phase: RenderPhase;
}

interface ThreeSceneItemProps {
  name: string;
}

interface ThreeSceneProps {
  names: string[];
}

const BailoutContext = React.createContext("initial");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const StressLeaf = React.memo(({ label, registerState }: StressLeafProps) => {
  const [isAlternate, setIsAlternate] = React.useState(false);
  registerState(label, setIsAlternate);
  return <span>{isAlternate ? label.toUpperCase() : label}</span>;
});
StressLeaf.displayName = "StressLeaf";

const StressParent = ({ children }: StressParentProps) => children;

const StaticBailoutLeaf = React.memo(() => <span>static</span>);
StaticBailoutLeaf.displayName = "StaticBailoutLeaf";

const ContextBailoutLeaf = React.memo(() => {
  const contextValue = React.useContext(BailoutContext);
  return <span>{contextValue}</span>;
});
ContextBailoutLeaf.displayName = "ContextBailoutLeaf";

const BailoutTree = ({ contextValue }: BailoutTreeProps) => (
  <div>
    <StaticBailoutLeaf />
    <BailoutContext.Provider value={contextValue}>
      <ContextBailoutLeaf />
    </BailoutContext.Provider>
  </div>
);

const AsyncLeaf = ({ deferred }: AsyncLeafProps) => {
  const value = React.use(deferred.promise);
  return <span>{value}</span>;
};

const FallbackLeaf = () => <span>loading</span>;

const ThreeSceneItem = ({ name }: ThreeSceneItemProps) =>
  React.createElement("group", { name }, React.createElement("mesh", { name: `${name}-mesh` }));

const ThreeScene = ({ names }: ThreeSceneProps) => (
  <>{names.map((name) => React.createElement(ThreeSceneItem, { key: name, name }))}</>
);

const createDeferred = <Value,>(): Deferred<Value> => {
  const { promise, resolve } = Promise.withResolvers<Value>();
  return { promise, resolve };
};

const requireRoot = (root: FiberRoot | null, scenario: string): FiberRoot => {
  if (!root) throw new Error(`${scenario} did not commit a root`);
  return root;
};

const findComponentFiber = (root: FiberRoot, component: React.ElementType): Fiber | null =>
  traverseFiber(
    root.current,
    (fiber) => fiber.type === component || fiber.elementType === component,
  );

const collectStressLeafFibers = (root: FiberRoot): Map<string, Fiber> => {
  const fibers = new Map<string, Fiber>();
  traverseFiber(root.current, (fiber) => {
    if (fiber.elementType === StressLeaf && typeof fiber.memoizedProps.label === "string") {
      fibers.set(fiber.memoizedProps.label, fiber);
    }
  });
  return fibers;
};

const collectThreeSceneItemFibers = (root: FiberRoot): Map<string, Fiber> => {
  const fibers = new Map<string, Fiber>();
  traverseFiber(root.current, (fiber) => {
    if (fiber.type === ThreeSceneItem && typeof fiber.memoizedProps.name === "string") {
      fibers.set(fiber.memoizedProps.name, fiber);
    }
  });
  return fibers;
};

describe("adversarial renderer behavior", () => {
  it("survives equivalent tree rewrites, keyed reorders, and state-only commits", async () => {
    const stateSetters = new Map<string, React.Dispatch<boolean>>();
    const registerState = (label: string, setIsAlternate: React.Dispatch<boolean>): void => {
      stateSetters.set(label, setIsAlternate);
    };
    const createLeaf = (label: string): React.ReactElement => (
      <StressLeaf key={label} label={label} registerState={registerState} />
    );
    const leafA = createLeaf("a");
    const leafB = createLeaf("b");
    const leafC = createLeaf("c");
    const leafD = createLeaf("d");
    const leafE = createLeaf("e");
    const cases: StressCase[] = [
      { children: [leafA, leafB, leafC, leafD, leafE], output: "abcde" },
      { children: [[leafA], leafB, leafC, leafD, leafE], output: "abcde" },
      { children: [[leafA, leafB], leafC, [leafD, leafE]], output: "abcde" },
      { children: [leafA, leafB, [[leafC]], leafD, leafE], output: "abcde" },
      { children: [leafA, leafB, [leafC, [leafD, [[leafE]]]]], output: "abcde" },
      { children: [leafA, [[]], leafB, leafC, [leafD, [[]], leafE]], output: "abcde" },
      { children: [[[[leafA, leafB, leafC, leafD], leafE]]], output: "abcde" },
      { children: [leafE, leafD, leafC, leafB, leafA], output: "edcba" },
      { children: [leafC, leafA, leafE, leafB, leafD], output: "caebd" },
      { children: [leafA, leafB, leafC, leafD, leafE], output: "abcde" },
    ];
    const phaseEntries: PhaseEntry[] = [];
    let latestRoot: FiberRoot | null = null;
    const unsubscribe = instrument({
      onCommitFiberRoot: (_rendererId, root) => {
        latestRoot = root;
        traverseRenderedFibers(root, (fiber, phase) => {
          phaseEntries.push({ name: getDisplayName(fiber.type), phase });
        });
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderStressCase = async (stressCase: StressCase): Promise<Map<string, Fiber>> => {
      phaseEntries.length = 0;
      await React.act(async () => {
        root.render(<StressParent>{stressCase.children}</StressParent>);
      });

      expect(container.textContent).toBe(stressCase.output);
      const committedRoot = requireRoot(latestRoot, "stress tree");
      const leafFibers = collectStressLeafFibers(committedRoot);
      expect([...leafFibers.keys()].sort()).toEqual(["a", "b", "c", "d", "e"]);
      expect(new Set([...leafFibers.values()].map(getFiberId)).size).toBe(5);
      for (const fiber of leafFibers.values()) {
        expect(getLatestFiber(fiber)).toBe(fiber);
        if (fiber.alternate) expect(getFiberId(fiber.alternate)).toBe(getFiberId(fiber));
      }
      return leafFibers;
    };

    try {
      for (const stressCase of cases) {
        const leafFibers = await renderStressCase(stressCase);

        const previousMiddleFiber = leafFibers.get("c");
        const setMiddleAlternate = stateSetters.get("c");
        if (!previousMiddleFiber || !setMiddleAlternate) {
          throw new Error("stress tree did not expose its stateful middle leaf");
        }
        const middleFiberId = getFiberId(previousMiddleFiber);
        phaseEntries.length = 0;
        await React.act(async () => setMiddleAlternate(true));
        expect(container.textContent).toBe(stressCase.output.replace("c", "C"));

        const updatedMiddleFiber = collectStressLeafFibers(
          requireRoot(latestRoot, "stress state update"),
        ).get("c");
        if (!updatedMiddleFiber) throw new Error("stress tree lost its middle leaf");
        expect(getFiberId(updatedMiddleFiber)).toBe(middleFiberId);
        expect(getLatestFiber(previousMiddleFiber)).toBe(updatedMiddleFiber);
        expect(didFiberRender(updatedMiddleFiber)).toBe(true);
        expect(
          phaseEntries.some((entry) => entry.name === "StressLeaf" && entry.phase === "update"),
        ).toBe(true);

        await React.act(async () => setMiddleAlternate(false));
        expect(container.textContent).toBe(stressCase.output);
      }

      for (const initialCase of cases) {
        for (const nextCase of cases) {
          await renderStressCase(initialCase);
          await renderStressCase(nextCase);
          await renderStressCase(initialCase);
        }
      }
    } finally {
      await React.act(async () => root.unmount());
      unsubscribe();
    }
  });

  it("distinguishes memo bailouts from context-driven renders", async () => {
    let latestRoot: FiberRoot | null = null;
    const unsubscribe = instrument({
      onCommitFiberRoot: (_rendererId, root) => {
        latestRoot = root;
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await React.act(async () => root.render(<BailoutTree contextValue="first" />));
      const mountedRoot = requireRoot(latestRoot, "bailout mount");
      const mountedStaticFiber = findComponentFiber(mountedRoot, StaticBailoutLeaf);
      const mountedContextFiber = findComponentFiber(mountedRoot, ContextBailoutLeaf);
      if (!mountedStaticFiber || !mountedContextFiber) {
        throw new Error("bailout tree did not mount both memoized leaves");
      }

      await React.act(async () => root.render(<BailoutTree contextValue="second" />));
      const updatedRoot = requireRoot(latestRoot, "bailout update");
      const updatedStaticFiber = findComponentFiber(updatedRoot, StaticBailoutLeaf);
      const updatedContextFiber = findComponentFiber(updatedRoot, ContextBailoutLeaf);
      if (!updatedStaticFiber || !updatedContextFiber) {
        throw new Error("bailout tree lost a memoized leaf");
      }

      expect(container.textContent).toBe("staticsecond");
      expect(getFiberId(updatedStaticFiber)).toBe(getFiberId(mountedStaticFiber));
      expect(getFiberId(updatedContextFiber)).toBe(getFiberId(mountedContextFiber));
      expect(didFiberRender(updatedStaticFiber)).toBe(false);
      expect(didFiberRender(updatedContextFiber)).toBe(true);
      expect(getLatestFiber(mountedStaticFiber)).toBe(updatedStaticFiber);
      expect(getLatestFiber(mountedContextFiber)).toBe(updatedContextFiber);
      const staticSource = await getSource(updatedStaticFiber, false, sourceFetch);
      const contextSource = await getSource(updatedContextFiber, false, sourceFetch);
      expect(staticSource?.fileName).toContain("adversarial-renderers.test.tsx");
      expect(contextSource?.fileName).toContain("adversarial-renderers.test.tsx");
    } finally {
      await React.act(async () => root.unmount());
      unsubscribe();
    }
  });

  it("tracks fallback and primary fibers across repeated Suspense transitions", async () => {
    const phaseEntries: PhaseEntry[] = [];
    let latestRoot: FiberRoot | null = null;
    const unsubscribe = instrument({
      onCommitFiberRoot: (_rendererId, root) => {
        latestRoot = root;
        traverseRenderedFibers(root, (fiber, phase) => {
          phaseEntries.push({ name: getDisplayName(fiber.type), phase });
        });
      },
      onCommitFiberUnmount: (_rendererId, fiber) => {
        phaseEntries.push({ name: getDisplayName(fiber.type), phase: "unmount" });
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const firstDeferred = createDeferred<string>();
    const renderDeferred = (deferred: Deferred<string>): React.ReactElement => (
      <React.Suspense fallback={<FallbackLeaf />}>
        <AsyncLeaf deferred={deferred} />
      </React.Suspense>
    );

    try {
      await React.act(async () => root.render(renderDeferred(firstDeferred)));
      expect(container.textContent).toBe("loading");
      expect(
        phaseEntries.some((entry) => entry.name === "FallbackLeaf" && entry.phase === "mount"),
      ).toBe(true);

      const fallbackFiber = findComponentFiber(
        requireRoot(latestRoot, "Suspense fallback"),
        FallbackLeaf,
      );
      if (!fallbackFiber) throw new Error("Suspense did not mount its fallback fiber");
      expect((await getSource(fallbackFiber, false, sourceFetch))?.fileName).toContain(
        "adversarial-renderers.test.tsx",
      );

      phaseEntries.length = 0;
      await React.act(async () => {
        firstDeferred.resolve("first");
        await firstDeferred.promise;
      });
      expect(container.textContent).toBe("first");
      expect(
        phaseEntries.some((entry) => entry.name === "FallbackLeaf" && entry.phase === "unmount"),
      ).toBe(true);
      expect(
        phaseEntries.some((entry) => entry.name === "AsyncLeaf" && entry.phase === "mount"),
      ).toBe(true);

      const primaryFiber = findComponentFiber(
        requireRoot(latestRoot, "Suspense primary"),
        AsyncLeaf,
      );
      if (!primaryFiber) throw new Error("Suspense did not mount its primary fiber");
      expect((await getSource(primaryFiber, false, sourceFetch))?.fileName).toContain(
        "adversarial-renderers.test.tsx",
      );
      expect(
        (await getOwnerStack(primaryFiber, false, sourceFetch)).some(
          (frame) => frame.functionName === "AsyncLeaf",
        ),
      ).toBe(true);

      const secondDeferred = createDeferred<string>();
      phaseEntries.length = 0;
      await React.act(async () => root.render(renderDeferred(secondDeferred)));
      expect(container.textContent).toBe("firstloading");
      expect(container.querySelector("span")?.style.display).toBe("none");
      expect(
        phaseEntries.some((entry) => entry.name === "AsyncLeaf" && entry.phase === "unmount"),
      ).toBe(true);
      expect(
        phaseEntries.some((entry) => entry.name === "FallbackLeaf" && entry.phase === "mount"),
      ).toBe(true);

      phaseEntries.length = 0;
      await React.act(async () => {
        secondDeferred.resolve("second");
        await secondDeferred.promise;
      });
      expect(container.textContent).toBe("second");
      expect(
        phaseEntries.some((entry) => entry.name === "FallbackLeaf" && entry.phase === "unmount"),
      ).toBe(true);
      expect(
        phaseEntries.some((entry) => entry.name === "AsyncLeaf" && entry.phase === "mount"),
      ).toBe(true);
      const resolvedPrimaryFiber = findComponentFiber(
        requireRoot(latestRoot, "second Suspense primary"),
        AsyncLeaf,
      );
      if (!resolvedPrimaryFiber) throw new Error("Suspense lost its resolved primary fiber");
      expect(getFiberId(resolvedPrimaryFiber)).toBe(getFiberId(primaryFiber));
      expect(getLatestFiber(primaryFiber)).toBe(resolvedPrimaryFiber);
    } finally {
      await React.act(async () => root.unmount());
      unsubscribe();
    }
  });

  it("tracks React Three Fiber identity through keyed scene reorders and removals", async () => {
    const ReactThreeTestRenderer = await import("@react-three/test-renderer");
    const unmountedItemNames: string[] = [];
    let latestRoot: FiberRoot | null = null;
    const unsubscribe = instrument({
      onCommitFiberRoot: (_rendererId, root) => {
        latestRoot = root;
      },
      onCommitFiberUnmount: (_rendererId, fiber) => {
        if (fiber.type === ThreeSceneItem && typeof fiber.memoizedProps?.name === "string") {
          unmountedItemNames.push(fiber.memoizedProps.name);
        }
      },
    });
    const renderer = await ReactThreeTestRenderer.create(
      <ThreeScene names={["a", "b", "c", "d"]} />,
    );

    try {
      const mountedRoot = requireRoot(latestRoot, "React Three Fiber mount");
      const mountedItems = collectThreeSceneItemFibers(mountedRoot);
      expect([...mountedItems.keys()]).toEqual(["a", "b", "c", "d"]);
      expect(renderer.scene.children.map((child) => child.props.name)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);

      const mountedItemIds = new Map(
        [...mountedItems].map(([name, fiber]) => [name, getFiberId(fiber)]),
      );
      await renderer.update(<ThreeScene names={["c", "a", "d", "e"]} />);

      const updatedRoot = requireRoot(latestRoot, "React Three Fiber update");
      const updatedItems = collectThreeSceneItemFibers(updatedRoot);
      expect([...updatedItems.keys()]).toEqual(["c", "a", "d", "e"]);
      for (const name of ["a", "c", "d"]) {
        const updatedFiber = updatedItems.get(name);
        const mountedFiber = mountedItems.get(name);
        if (!updatedFiber || !mountedFiber) throw new Error(`React Three Fiber lost ${name}`);
        expect(getFiberId(updatedFiber)).toBe(mountedItemIds.get(name));
        expect(getLatestFiber(mountedFiber)).toBe(updatedFiber);
      }
      expect(getFiberId(updatedItems.get("e") ?? updatedRoot.current)).not.toBe(
        mountedItemIds.get("b"),
      );
      expect(unmountedItemNames).toContain("b");
      const updatedItem = updatedItems.get("c");
      if (!updatedItem) throw new Error("React Three Fiber lost its source target");
      expect((await getSource(updatedItem, false, sourceFetch))?.fileName).toContain(
        "adversarial-renderers.test.tsx",
      );
    } finally {
      await renderer.unmount();
      unsubscribe();
    }
  });
});
