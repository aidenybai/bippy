import * as React from "react";
import { createPortal } from "react-dom";
import {
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getRenderer,
  getType,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
  traverseRenderedFibers,
  useFiber,
  type Fiber,
} from "bippy";
import { getFiberHooks } from "bippy/source";
import { describe, expect, it } from "vite-plus/test";
import { createRenderHarness } from "./render-harness.js";
import { getHookLeaves } from "./hook-tree.js";

interface ComponentProps {
  value: number;
}

const requireFiber = (fiber: Fiber | null | undefined): Fiber => {
  if (!fiber) throw new Error("Expected a Fiber");
  return fiber;
};

describe("live reconciler contracts", () => {
  it("tracks committed alternates and stable IDs through repeated updates and deletion", async () => {
    const harness = createRenderHarness();
    const Component = ({ value }: ComponentProps) => <span>{value}</span>;
    await harness.render(<Component value={0} />);
    const mountedFiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => fiber.type === Component),
    );
    const identifier = getFiberId(mountedFiber);
    for (let value = 1; value < 12; value++) {
      await harness.render(<Component value={value} />);
      const committedFiber = requireFiber(
        traverseFiber(harness.getRoot().current, (fiber) => fiber.type === Component),
      );
      expect(getLatestFiber(mountedFiber)).toBe(committedFiber);
      expect(getFiberId(committedFiber)).toBe(identifier);
      expect(getFiberById(identifier)).toBe(committedFiber);
      expect(getRenderer(committedFiber)?.rendererPackageName).toBe("react-dom");
    }
    await harness.render(null);
    expect(getFiberById(identifier)).toBeNull();
  });

  it("resolves bailed-out children with shared return pointers", async () => {
    const harness = createRenderHarness();
    const Child = React.memo(({ value }: ComponentProps) => <span>{value}</span>);
    const Parent = ({ value, title }: ComponentProps & { title: string }) => (
      <div title={title}>
        <Child value={value} />
      </div>
    );
    await harness.render(<Parent value={0} title="first" />);
    const mountedFiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => fiber.type === getType(Child)),
    );
    await harness.render(<Parent value={1} title="second" />);
    await harness.render(<Parent value={1} title="third" />);
    const currentFiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => fiber.type === getType(Child)),
    );
    expect(getLatestFiber(mountedFiber)).toBe(currentFiber);
    expect(getLatestFiber(requireFiber(currentFiber.alternate))).toBe(currentFiber);
  });

  it("finds hosts inside portals without confusing their root or component classification", async () => {
    const harness = createRenderHarness();
    const portalContainer = document.createElement("aside");
    const Component = () => createPortal(<span>portal</span>, portalContainer);
    await harness.render(<Component />);
    const host = requireFiber(getFiber(portalContainer.firstChild));
    expect(isHostFiber(host)).toBe(true);
    expect(isCompositeFiber(host)).toBe(false);
    expect(host.stateNode).toBe(portalContainer.firstChild);
    const component = requireFiber(traverseFiber(host, (fiber) => fiber.type === Component, true));
    expect(isCompositeFiber(component)).toBe(true);
    expect(getRenderer(component)).toBe(getRenderer(host));
  });

  it.each([false, true])(
    "reports every live Suspense sibling on mount, fallback = %s",
    async (isSuspended) => {
      const harness = createRenderHarness();
      const pending = new Promise<never>(() => {});
      const Child = ({ value }: ComponentProps) => <span>{value}</span>;
      const Primary = () => {
        if (isSuspended) throw pending;
        return (
          <>
            <Child value={1} />
            <Child value={2} />
            <Child value={3} />
          </>
        );
      };
      await harness.render(
        <React.Suspense
          fallback={
            <>
              <Child value={4} />
              <Child value={5} />
              <Child value={6} />
            </>
          }
        >
          <Primary />
        </React.Suspense>,
      );
      const values: unknown[] = [];
      traverseRenderedFibers(harness.getRoot(), (fiber) => {
        if (fiber.type === Child) values.push(fiber.memoizedProps.value);
      });
      expect(values).toEqual(isSuspended ? [4, 5, 6] : [1, 2, 3]);
    },
  );

  it("useFiber returns the rendering Fiber in StrictMode and restores Function.bind", async () => {
    const harness = createRenderHarness();
    const captures: Array<{ fiber: Fiber | undefined; oracle: Fiber | null | undefined }> = [];
    const originalBind = Function.prototype.bind;
    const renderer = [...getRDTHook().renderers.values()].find(
      (renderer) => renderer.rendererPackageName === "react-dom",
    );
    if (!renderer?.getCurrentFiber)
      throw new Error("Development renderer must expose getCurrentFiber");
    const Component = ({ value }: ComponentProps) => {
      const fiber = useFiber();
      const oracle = renderer.getCurrentFiber?.();
      captures.push({ fiber, oracle });
      return <span>{value}</span>;
    };
    await harness.render(
      <React.StrictMode>
        <Component value={0} />
      </React.StrictMode>,
    );
    await harness.render(
      <React.StrictMode>
        <Component value={1} />
      </React.StrictMode>,
    );
    expect(captures.length).toBeGreaterThanOrEqual(4);
    for (const { fiber, oracle } of captures) {
      expect(requireFiber(fiber).type).toBe(Component);
      expect(fiber).toBe(oracle);
    }
    expect(Function.prototype.bind).toBe(originalBind);
  });
});

// Adapted scenarios from ReactHooksInspectionIntegration-test.js. See ../NOTICE and ../upstream.json.
describe("mounted hook inspection", () => {
  it("reads committed state without calling initializers or running effects again", async () => {
    const harness = createRenderHarness();
    let initializationCount = 0;
    let effectCount = 0;
    let setState: React.Dispatch<React.SetStateAction<number>> = () => {
      throw new Error("Not mounted");
    };
    const Component = () => {
      const [state, updateState] = React.useState(() => {
        initializationCount++;
        return 1;
      });
      setState = updateState;
      React.useEffect(() => {
        effectCount++;
      }, []);
      const memo = React.useMemo(() => state * 2, [state]);
      return <span>{memo}</span>;
    };
    await harness.render(<Component />);
    await React.act(async () => setState(7));
    const fiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => fiber.type === Component),
    );
    const values = getHookLeaves(getFiberHooks(fiber));
    expect(values.map(({ name, id, isStateEditable }) => ({ name, id, isStateEditable }))).toEqual([
      { name: "State", id: 0, isStateEditable: true },
      { name: "Effect", id: 1, isStateEditable: false },
      { name: "Memo", id: 2, isStateEditable: false },
    ]);
    expect(values[0].value).toBe(7);
    expect(values[2].value).toBe(14);
    expect(initializationCount).toBe(1);
    expect(effectCount).toBe(1);
    expect(harness.container.textContent).toBe("14");
  });

  it("reads repeated context dependencies from the closest provider and restores the default", async () => {
    const harness = createRenderHarness();
    const Context = React.createContext("default");
    const Component = () => (
      <span>
        {React.useContext(Context)} {React.useContext(Context)} {React.use(Context)}
      </span>
    );
    await harness.render(
      <Context value="outer">
        <Context value="inner">
          <Component />
        </Context>
      </Context>,
    );
    const fiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => fiber.type === Component),
    );
    expect(getHookLeaves(getFiberHooks(fiber)).map(({ value }) => value)).toEqual([
      "inner",
      "inner",
      "inner",
    ]);
    await harness.render(<Component />);
    expect(harness.container.textContent).toBe("default default default");
  });

  it.each(["memo", "forwardRef"])("inspects %s component state", async (wrapper) => {
    const harness = createRenderHarness();
    const Component = () => <span>{React.useState(123)[0]}</span>;
    const Wrapped = wrapper === "memo" ? React.memo(Component) : React.forwardRef(Component);
    await harness.render(<Wrapped />);
    const fiber = requireFiber(
      traverseFiber(harness.getRoot().current, (fiber) => getType(fiber.type) === Component),
    );
    expect(
      getHookLeaves(getFiberHooks(fiber)).map(({ name, value, id }) => ({ name, value, id })),
    ).toEqual([{ name: "State", value: 123, id: 0 }]);
  });
});
