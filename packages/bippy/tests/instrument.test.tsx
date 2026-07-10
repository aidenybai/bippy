import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vitest";
import type { FiberRoot } from "../src/types.js";
import { _fiberRoots, instrument, isInstrumentationActive } from "../src/index.js";
import React from "react";
import { render } from "@testing-library/react";

export const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithEffect = () => {
  React.useEffect(() => {}, []);
  return <div>Hello</div>;
};

it("should not fail if __REACT_DEVTOOLS_GLOBAL_HOOK__ exists already", () => {
  render(<Example />);
  const onCommitFiberRoot = vi.fn();
  instrument({ onCommitFiberRoot });
  render(<Example />);
  expect(onCommitFiberRoot).toHaveBeenCalled();
});

it("onActive is called", () => {
  const onActive = vi.fn();
  instrument({ onActive });
  render(<Example />);
  expect(onActive).toHaveBeenCalled();
  expect(isInstrumentationActive()).toBe(true);
});

it("onCommitFiberRoot is called", () => {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let currentFiberRoot: FiberRoot | null = null;
  const onCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
    currentFiberRoot = fiberRoot;
  });
  instrument({ onCommitFiberRoot });
  expect(onCommitFiberRoot).not.toHaveBeenCalled();
  render(<Example />);
  expect(onCommitFiberRoot).toHaveBeenCalled();
  expect(currentFiberRoot?.current.child.type).toBe(Example);
});

it("tracks committed fiber roots in _fiberRoots", () => {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let currentFiberRoot: FiberRoot | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      currentFiberRoot = fiberRoot;
    },
  });
  render(<Example />);
  expect(currentFiberRoot).not.toBe(null);
  expect(_fiberRoots.has(currentFiberRoot)).toBe(true);
});

it("onPostCommitFiberRoot is called", () => {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let currentFiberRoot: FiberRoot | null = null;
  const onPostCommitFiberRoot = vi.fn((_rendererID, fiberRoot) => {
    currentFiberRoot = fiberRoot;
  });
  instrument({ onPostCommitFiberRoot });
  expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
  render(<ExampleWithEffect />);
  expect(onPostCommitFiberRoot).toHaveBeenCalled();
  expect(currentFiberRoot?.current.child.type).toBe(ExampleWithEffect);
});

it("onScheduleFiberRoot is called", () => {
  const onScheduleFiberRoot = vi.fn();
  const unsubscribe = instrument({ onScheduleFiberRoot });
  render(<Example />);
  expect(onScheduleFiberRoot).toHaveBeenCalled();
  unsubscribe();
});

it("unsubscribe removes only this call's handlers", () => {
  const unsubscribedOnCommitFiberRoot = vi.fn();
  const activeOnCommitFiberRoot = vi.fn();
  const unsubscribe = instrument({ onCommitFiberRoot: unsubscribedOnCommitFiberRoot });
  const unsubscribeActive = instrument({ onCommitFiberRoot: activeOnCommitFiberRoot });
  unsubscribe();
  render(<Example />);
  expect(unsubscribedOnCommitFiberRoot).not.toHaveBeenCalled();
  expect(activeOnCommitFiberRoot).toHaveBeenCalled();
  unsubscribeActive();
});
