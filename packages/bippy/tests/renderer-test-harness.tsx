import React from "react";
import { describe, expect, it } from "vitest";
import {
  didFiberCommit,
  didFiberRender,
  getDisplayName,
  getFiberId,
  getFiberStack,
  getLatestFiber,
  getMutatedHostFibers,
  getNearestHostFiber,
  getNearestHostFibers,
  getRDTHook,
  getTimings,
  instrument,
  isCompositeFiber,
  isHostFiber,
  isInstrumentationActive,
  isValidFiber,
  traverseContexts,
  traverseFiber,
  traverseProps,
  traverseState,
} from "../src/index.js";
import { getFiberHooks } from "../src/source/index.js";
import type { Fiber, FiberRoot } from "../src/types.js";

export interface RendererHostProps {
  label: string;
  value: number;
}

export interface RendererController {
  getOutput: () => unknown;
  update: (element: React.ReactElement, updateState: () => void) => Promise<void>;
  unmount: () => Promise<void>;
}

export interface RendererAdapter {
  createHostElement: (props: RendererHostProps) => React.ReactElement;
  render: (element: React.ReactElement) => Promise<RendererController>;
  wrap: (element: React.ReactElement) => React.ReactElement;
}

export interface RendererAdapterFactory {
  create: () => Promise<RendererAdapter>;
  name: string;
  rendererPackageName?: string;
}

interface CompoundTreeProps {
  revision: number;
}

interface StatefulBranchProps {
  revision: number;
}

interface CompoundComponents {
  CompoundTree: React.ComponentType<CompoundTreeProps>;
  ForwardLeaf: React.ComponentType<RendererHostProps>;
  StatefulBranch: React.ComponentType<StatefulBranchProps>;
  setStateValue: (value: number) => void;
}

const RendererContext = React.createContext("default");
RendererContext.displayName = "RendererContext";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const collectHookValues = (
  hooks: ReturnType<typeof getFiberHooks>,
  values: unknown[] = [],
): unknown[] => {
  for (const hook of hooks) {
    values.push(hook.value);
    collectHookValues(hook.subHooks, values);
  }
  return values;
};

const createCompoundComponents = (adapter: RendererAdapter): CompoundComponents => {
  let updateStateValue = (_value: number) => {};

  const ForwardLeaf = React.forwardRef<unknown, RendererHostProps>((props, _ref) =>
    adapter.createHostElement(props),
  );
  ForwardLeaf.displayName = "RendererForwardLeaf";

  const StatefulBranch = React.memo(({ revision }: StatefulBranchProps) => {
    const contextValue = React.useContext(RendererContext);
    const [stateValue, setStateValue] = React.useState(1);
    const computedLabel = React.useMemo(
      () => `${contextValue}-${revision}`,
      [contextValue, revision],
    );
    updateStateValue = setStateValue;
    return <ForwardLeaf label={computedLabel} value={stateValue} />;
  });
  StatefulBranch.displayName = "RendererStatefulBranch";

  const CompoundTree = ({ revision }: CompoundTreeProps) => (
    <RendererContext.Provider value="compound">
      <StatefulBranch revision={revision} />
    </RendererContext.Provider>
  );
  CompoundTree.displayName = "RendererCompoundTree";

  return {
    CompoundTree,
    ForwardLeaf,
    StatefulBranch,
    setStateValue: (value) => updateStateValue(value),
  };
};

const findComponentFiber = (
  root: FiberRoot,
  component: React.ComponentType<unknown>,
): Fiber | null =>
  traverseFiber(
    root.current,
    (fiber) => fiber.type === component || fiber.elementType === component,
  );

export const runRendererTestHarness = (factories: RendererAdapterFactory[]): void => {
  describe.each(factories)("$name renderer", (factory) => {
    it("supports compound mount, inspection, update, and unmount instrumentation", async () => {
      const committedRoots: FiberRoot[] = [];
      const rendererIds: number[] = [];
      const unmountedFibers: Fiber[] = [];
      let activeCallCount = 0;
      const unsubscribe = instrument({
        onActive: () => {
          activeCallCount += 1;
        },
        onCommitFiberRoot: (rendererId, root) => {
          rendererIds.push(rendererId);
          committedRoots.push(root);
        },
        onCommitFiberUnmount: (_rendererId, fiber) => {
          unmountedFibers.push(fiber);
        },
      });

      const adapter = await factory.create();
      const components = createCompoundComponents(adapter);
      const createTree = (revision: number) =>
        adapter.wrap(<components.CompoundTree revision={revision} />);
      const controller = await adapter.render(createTree(1));

      expect(controller.getOutput()).toBeTruthy();
      expect(isInstrumentationActive()).toBe(true);
      expect(activeCallCount).toBeGreaterThanOrEqual(1);
      expect(committedRoots.length).toBeGreaterThanOrEqual(1);
      expect(rendererIds.length).toBeGreaterThanOrEqual(1);

      const rendererId = rendererIds.at(-1);
      const renderer =
        rendererId === undefined ? undefined : getRDTHook().renderers.get(rendererId);
      expect(renderer).toBeDefined();
      if (factory.rendererPackageName === undefined) {
        expect(renderer?.reconcilerVersion).toBeTypeOf("string");
      } else {
        expect(renderer?.rendererPackageName).toBe(factory.rendererPackageName);
      }

      const mountedRoot = committedRoots.at(-1);
      expect(mountedRoot).toBeDefined();
      if (!mountedRoot) throw new Error(`${factory.name} did not commit a root`);

      const mountedStatefulFiber = findComponentFiber(mountedRoot, components.StatefulBranch);
      const mountedForwardFiber = findComponentFiber(mountedRoot, components.ForwardLeaf);
      expect(mountedStatefulFiber).not.toBeNull();
      expect(mountedForwardFiber).not.toBeNull();
      if (!mountedStatefulFiber || !mountedForwardFiber) {
        throw new Error(`${factory.name} did not render the compound component tree`);
      }

      expect(isValidFiber(mountedStatefulFiber)).toBe(true);
      expect(isCompositeFiber(mountedStatefulFiber)).toBe(true);
      expect(isCompositeFiber(mountedForwardFiber)).toBe(true);
      expect(getDisplayName(mountedStatefulFiber.type)).toBe("RendererStatefulBranch");
      expect(getDisplayName(mountedForwardFiber.type)).toBe("RendererForwardLeaf");
      expect(didFiberRender(mountedStatefulFiber)).toBe(true);
      expect(getFiberStack(mountedForwardFiber)).toContain(mountedStatefulFiber);

      const nearestMountedHostFiber = getNearestHostFiber(mountedStatefulFiber);
      expect(nearestMountedHostFiber).not.toBeNull();
      if (!nearestMountedHostFiber) throw new Error(`${factory.name} did not render a host fiber`);
      expect(isHostFiber(nearestMountedHostFiber)).toBe(true);
      expect(getNearestHostFibers(mountedStatefulFiber).length).toBeGreaterThanOrEqual(1);

      const mountedFiberId = getFiberId(mountedStatefulFiber);
      await controller.update(createTree(2), () => components.setStateValue(4));

      const updatedRoot = committedRoots.at(-1);
      expect(updatedRoot).toBeDefined();
      if (!updatedRoot) throw new Error(`${factory.name} did not commit an update`);

      const updatedStatefulFiber = findComponentFiber(updatedRoot, components.StatefulBranch);
      expect(updatedStatefulFiber).not.toBeNull();
      if (!updatedStatefulFiber) throw new Error(`${factory.name} lost the stateful fiber`);

      expect(updatedStatefulFiber.alternate).not.toBeNull();
      expect(getLatestFiber(mountedStatefulFiber)).toBe(updatedStatefulFiber);
      expect(getFiberId(updatedStatefulFiber)).toBe(mountedFiberId);
      expect(didFiberRender(updatedStatefulFiber)).toBe(true);
      expect(didFiberCommit(updatedRoot.current)).toBe(true);

      const propTransitions: Array<[string, unknown, unknown]> = [];
      traverseProps(updatedStatefulFiber, (propName, nextValue, previousValue) => {
        propTransitions.push([propName, nextValue, previousValue]);
      });
      expect(propTransitions).toContainEqual(["revision", 2, 1]);

      const stateTransitions: Array<[unknown, unknown]> = [];
      traverseState(updatedStatefulFiber, (nextState, previousState) => {
        stateTransitions.push([nextState?.memoizedState, previousState?.memoizedState]);
      });
      expect(stateTransitions).toContainEqual([4, 1]);

      const hookValues = collectHookValues(getFiberHooks(updatedStatefulFiber));
      expect(hookValues).toContain("compound");
      expect(hookValues).toContain(4);

      const contextValues: unknown[] = [];
      traverseContexts(updatedStatefulFiber, (nextContext) => {
        contextValues.push(nextContext?.memoizedValue);
      });
      expect(contextValues).toContain("compound");

      const mutatedHostFibers = getMutatedHostFibers(updatedRoot.current);
      expect(mutatedHostFibers.length).toBeGreaterThanOrEqual(1);
      expect(mutatedHostFibers.every(isHostFiber)).toBe(true);

      const timings = getTimings(updatedStatefulFiber);
      expect(timings.selfTime).toBeTypeOf("number");
      expect(timings.totalTime).toBeTypeOf("number");

      await controller.unmount();
      expect(
        unmountedFibers.some(
          (fiber) =>
            fiber.type === components.StatefulBranch ||
            fiber.elementType === components.StatefulBranch,
        ),
      ).toBe(true);
      expect(unmountedFibers.some(isHostFiber)).toBe(true);

      unsubscribe();
    });
  });
};
