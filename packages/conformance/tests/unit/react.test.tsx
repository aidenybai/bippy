import { getLatestFiber, useFiber } from "../../../bippy/src/index.js";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it } from "vite-plus/test";

interface FiberProbeProps {
  onFiber: (fiber: Fiber | undefined) => void;
}

const FiberProbe = ({ onFiber }: FiberProbeProps) => {
  onFiber(useFiber());
  return null;
};

afterEach(cleanup);

it("returns the calling component fiber", () => {
  let observedFiber: Fiber | undefined;

  render(<FiberProbe onFiber={(fiber) => (observedFiber = fiber)} />);

  expect(observedFiber?.type).toBe(FiberProbe);
});

it("supports multiple consumers", () => {
  const observedFibers: Array<Fiber | undefined> = [];

  render(
    <>
      <FiberProbe onFiber={(fiber) => observedFibers.push(fiber)} />
      <FiberProbe onFiber={(fiber) => observedFibers.push(fiber)} />
    </>,
  );

  expect(observedFibers).toHaveLength(2);
  expect(observedFibers[0]).not.toBe(observedFibers[1]);
});

it("returns the latest fiber after an update", () => {
  let observedFiber: Fiber | undefined;

  const rendered = render(<FiberProbe onFiber={(fiber) => (observedFiber = fiber)} />);
  const initialFiber = observedFiber;

  rendered.rerender(<FiberProbe onFiber={(fiber) => (observedFiber = fiber)} />);

  expect(observedFiber).not.toBe(initialFiber);
  expect(initialFiber && getLatestFiber(initialFiber)).toBe(observedFiber);
});

it("supports forward ref components", () => {
  let observedFiber: Fiber | undefined;
  const ForwardFiberProbe = React.forwardRef<unknown, FiberProbeProps>(({ onFiber }, _ref) => {
    observedFiber = useFiber();
    onFiber(observedFiber);
    return null;
  });

  render(<ForwardFiberProbe onFiber={() => {}} />);

  expect(observedFiber?.type).toBe(ForwardFiberProbe);
});

it("supports Strict Mode", () => {
  const observedFibers: Fiber[] = [];

  render(
    <React.StrictMode>
      <FiberProbe
        onFiber={(fiber) => {
          if (fiber) observedFibers.push(fiber);
        }}
      />
    </React.StrictMode>,
  );

  expect(observedFibers.length).toBeGreaterThanOrEqual(2);
  expect(observedFibers.every((fiber) => fiber.type === FiberProbe)).toBe(true);
});

it("supports custom renderers", async () => {
  const ReactThreeTestRenderer = await import("@react-three/test-renderer");
  let observedFiber: Fiber | undefined;
  const ThreeFiberProbe = () => {
    observedFiber = useFiber();
    return <group />;
  };

  const renderer = await ReactThreeTestRenderer.create(<ThreeFiberProbe />);

  expect(observedFiber?.type).toBe(ThreeFiberProbe);
  await renderer.unmount();
});

it("uses the production-compatible capture path without affecting later hooks", () => {
  const originalBind = Function.prototype.bind;
  let observedFiber: Fiber | undefined;
  let observedForwardFiber: Fiber | undefined;
  let stateInitializerCalls = 0;
  const ForwardFiberProbe = React.forwardRef<unknown, object>((_props, _ref) => {
    observedForwardFiber = useFiber();
    return null;
  });
  const StatefulFiberProbe = () => {
    observedFiber = useFiber();
    React.useState(() => {
      stateInitializerCalls += 1;
      return undefined;
    });
    return null;
  };

  render(
    <>
      <StatefulFiberProbe />
      <ForwardFiberProbe />
    </>,
  );

  expect(observedFiber?.type).toBe(StatefulFiberProbe);
  expect(observedForwardFiber?.type).toBe(ForwardFiberProbe);
  expect(stateInitializerCalls).toBe(1);
  expect(Function.prototype.bind).toBe(originalBind);
});
