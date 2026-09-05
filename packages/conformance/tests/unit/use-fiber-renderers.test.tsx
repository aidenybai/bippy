import { _fiberRoots, useFiber } from "../../../bippy/src/index.js";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { cleanup, render as renderDOM } from "@testing-library/react";
import React, { act } from "react";
import { render as renderNil } from "react-nil";
import ReactTestRenderer from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  checkCallingFiber,
  createFiberRootRegistry,
  getDevToolsCurrentFiber,
  matchByProps,
} from "./use-fiber-oracle.js";

interface ProbeProps {
  revision: number;
}

interface ProbeObservation {
  devToolsFiber: Fiber | null;
  fiber: Fiber | undefined;
  mismatch: unknown;
}

interface RendererCase {
  name: string;
  render: (element: React.ReactElement) => Promise<(element: React.ReactElement) => Promise<void>>;
}

const rendererCases: RendererCase[] = [
  {
    name: "react-test-renderer",
    render: async (element) => {
      let instance: ReactTestRenderer.ReactTestRenderer | undefined;
      await act(() => {
        instance = ReactTestRenderer.create(element);
      });
      return async (nextElement) => {
        await act(() => {
          instance?.update(nextElement);
        });
      };
    },
  },
  {
    name: "react-nil",
    render: async (element) => {
      await act(() => {
        renderNil(element);
      });
      return async (nextElement) => {
        await act(() => {
          renderNil(nextElement);
        });
      };
    },
  },
];

afterEach(cleanup);

// Custom renderers have no DOM container, so the committed roots that bippy tracks seed the
// oracle after the first commit, and React's own DEV current fiber covers the mount render.
describe.each(rendererCases)("useFiber on $name", ({ render }) => {
  it("returns the fiber React reports as rendering across mounts and updates", async () => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const registry = createFiberRootRegistry();
    const observations: ProbeObservation[] = [];
    const Probe = (props: ProbeProps) => {
      const fiber = useFiber();
      const devToolsFiber = getDevToolsCurrentFiber();
      const hasKnownRoot = registry.listRoots().length > 0;
      observations.push({
        devToolsFiber,
        fiber,
        mismatch: hasKnownRoot
          ? checkCallingFiber(registry, matchByProps(Probe, props), fiber, true)
          : null,
      });
      return null;
    };

    const update = await render(<Probe revision={0} />);
    for (const root of _fiberRoots) registry.addRoot(root);
    for (let revision = 1; revision <= 4; revision += 1) {
      await update(<Probe revision={revision} />);
    }

    expect(observations.length).toBeGreaterThanOrEqual(5);
    for (const observation of observations) {
      expect(observation.devToolsFiber).not.toBeNull();
      expect(observation.fiber).toBe(observation.devToolsFiber);
      expect(observation.mismatch).toBeNull();
    }
  });
});

it("keeps react-dom and react-test-renderer fibers apart when their updates interleave", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const observations: Array<[string, Fiber | undefined, Fiber | null]> = [];
  const createProbe = (rendererName: string) => (props: ProbeProps) => {
    observations.push([`${rendererName}:${props.revision}`, useFiber(), getDevToolsCurrentFiber()]);
    return null;
  };
  const DOMProbe = createProbe("dom");
  const TestProbe = createProbe("test-renderer");
  const domRendered = renderDOM(<DOMProbe revision={0} />);
  let testInstance: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(() => {
    testInstance = ReactTestRenderer.create(<TestProbe revision={0} />);
  });
  for (let revision = 1; revision <= 3; revision += 1) {
    domRendered.rerender(<DOMProbe revision={revision} />);
    await act(() => {
      testInstance?.update(<TestProbe revision={revision} />);
    });
  }

  expect(observations).toHaveLength(8);
  const fibers = new Set(observations.map(([, fiber]) => fiber));
  expect(fibers.size).toBe(4);
  for (const [, fiber, devToolsFiber] of observations) {
    expect(fiber).toBe(devToolsFiber);
  }
});
