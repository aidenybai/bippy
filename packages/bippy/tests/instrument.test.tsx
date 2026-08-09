import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vite-plus/test";
import type { FiberRoot, ReactDevToolsGlobalHook } from "../src/types.js";
import {
  _fiberRoots,
  BippyInstrumentationError,
  BippyReactDevToolsError,
  getRDTHook,
  instrument,
  isInstrumentationActive,
} from "../src/index.js";
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

it("removes unmounted fiber roots from _fiberRoots", () => {
  let currentFiberRoot: FiberRoot | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      currentFiberRoot = fiberRoot;
    },
  });
  const rendered = render(<Example />);
  expect(_fiberRoots.has(currentFiberRoot)).toBe(true);
  rendered.unmount();
  expect(_fiberRoots.has(currentFiberRoot)).toBe(false);
});

it("forwards the commit error state", () => {
  const onCommitFiberRoot = vi.fn();
  instrument({ onCommitFiberRoot });
  render(<Example />);
  expect(onCommitFiberRoot.mock.lastCall?.[3]).toBe(false);
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

it("the unsubscribe is a Disposable usable with `using`", () => {
  const onCommitFiberRoot = vi.fn();
  {
    using unsubscribe = instrument({ onCommitFiberRoot });
    void unsubscribe;
    render(<Example />);
    expect(onCommitFiberRoot).toHaveBeenCalled();
  }
  onCommitFiberRoot.mockClear();
  render(<Example />);
  expect(onCommitFiberRoot).not.toHaveBeenCalled();
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

it("propagates React DevTools callback failures", () => {
  let committedRoot: FiberRoot | null = null;
  const unsubscribeCapture = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRoot = root;
    },
  });
  render(<Example />);
  unsubscribeCapture();
  if (!committedRoot) throw new Error("React DOM did not commit a root");
  const rdtHook = getRDTHook();
  const rendererId = rdtHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const previousOnCommitFiberRoot = rdtHook.onCommitFiberRoot;
  const laterListener = vi.fn();
  rdtHook.onCommitFiberRoot = () => {
    throw new Error("DevTools failure");
  };
  const unsubscribe = instrument({ onCommitFiberRoot: laterListener });

  try {
    expect(() => rdtHook.onCommitFiberRoot(rendererId, committedRoot, undefined, false)).toThrow(
      BippyReactDevToolsError,
    );
    expect(laterListener).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    rdtHook.onCommitFiberRoot = previousOnCommitFiberRoot;
  }
});

it("propagates instrumentation callback failures and stops dispatch", () => {
  let committedRoot: FiberRoot | null = null;
  const unsubscribeCapture = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRoot = root;
    },
  });
  render(<Example />);
  unsubscribeCapture();
  if (!committedRoot) throw new Error("React DOM did not commit a root");
  const rdtHook = getRDTHook();
  const rendererId = rdtHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const laterListener = vi.fn();
  const unsubscribeThrowingListener = instrument({
    name: "throwing-instrumentation",
    onCommitFiberRoot: () => {
      throw new Error("instrumentation failure");
    },
  });
  const unsubscribeLaterListener = instrument({ onCommitFiberRoot: laterListener });

  try {
    expect(() => rdtHook.onCommitFiberRoot(rendererId, committedRoot, undefined, false)).toThrow(
      BippyInstrumentationError,
    );
    expect(laterListener).not.toHaveBeenCalled();
  } finally {
    unsubscribeThrowingListener();
    unsubscribeLaterListener();
  }
});

it("keeps existing instrumentation attached when DevTools replaces the hook", () => {
  let committedRoot: FiberRoot | null = null;
  const onCommitFiberRoot = vi.fn((_rendererId, root: FiberRoot) => {
    committedRoot = root;
  });
  const unsubscribe = instrument({ onCommitFiberRoot });
  render(<Example />);
  if (!committedRoot) throw new Error("React DOM did not commit a root");

  const previousHook = getRDTHook();
  const rendererId = previousHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const replacementHook: ReactDevToolsGlobalHook = {
    ...previousHook,
    inject: (renderer) => {
      const nextRendererId = previousHook.inject(renderer);
      replacementHook.renderers.set(nextRendererId, renderer);
      return nextRendererId;
    },
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map(previousHook.renderers),
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacementHook;
  onCommitFiberRoot.mockClear();
  replacementHook.onCommitFiberRoot(rendererId, committedRoot, undefined, false);

  expect(onCommitFiberRoot).toHaveBeenCalledOnce();
  unsubscribe();
});
