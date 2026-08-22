import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vite-plus/test";
import { ReactBuildType } from "../src/react-internals/index.js";
import type { FiberRoot, ReactDevToolsGlobalHook } from "../src/react-internals/index.js";
import { _fiberRoots, getRDTHook, instrument, isInstrumentationActive } from "../src/index.js";
import type { ReactDevToolsTarget } from "../src/index.js";
import React from "react";
import { render } from "@testing-library/react";

interface FiberRootRef {
  current: FiberRoot | null;
}

const Example = () => {
  return <div>Hello</div>;
};

const ExampleWithEffect = () => {
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

it("scopes onActive listeners to their target", () => {
  const firstTarget: ReactDevToolsTarget = {};
  const secondTarget: ReactDevToolsTarget = {};
  const firstOnActive = vi.fn();
  const secondOnActive = vi.fn();
  const unsubscribeFirst = instrument({ onActive: firstOnActive, target: firstTarget });
  const unsubscribeSecond = instrument({ onActive: secondOnActive, target: secondTarget });

  getRDTHook(undefined, firstTarget).inject({
    bundleType: ReactBuildType.Development,
    rendererPackageName: "first-renderer",
    version: "19.0.0",
  });

  expect(firstOnActive).toHaveBeenCalledOnce();
  expect(secondOnActive).not.toHaveBeenCalled();

  unsubscribeFirst();
  unsubscribeSecond();
});

it("onCommitFiberRoot is called", () => {
  const fiberRootRef: FiberRootRef = { current: null };
  const onCommitFiberRoot = vi.fn((_rendererID: number, fiberRoot: FiberRoot) => {
    fiberRootRef.current = fiberRoot;
  });
  instrument({ onCommitFiberRoot });
  expect(onCommitFiberRoot).not.toHaveBeenCalled();
  render(<Example />);
  expect(onCommitFiberRoot).toHaveBeenCalled();
  const currentFiberRoot = fiberRootRef.current;
  if (!currentFiberRoot) throw new Error("React DOM did not commit a root");
  expect(currentFiberRoot.current.child?.type).toBe(Example);
});

it("tracks committed fiber roots in _fiberRoots", () => {
  const fiberRootRef: FiberRootRef = { current: null };
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      fiberRootRef.current = fiberRoot;
    },
  });
  render(<Example />);
  const currentFiberRoot = fiberRootRef.current;
  if (!currentFiberRoot) throw new Error("React DOM did not commit a root");
  expect(_fiberRoots.has(currentFiberRoot)).toBe(true);
});

it("removes unmounted fiber roots from _fiberRoots", () => {
  const fiberRootRef: FiberRootRef = { current: null };
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      fiberRootRef.current = fiberRoot;
    },
  });
  const rendered = render(<Example />);
  const currentFiberRoot = fiberRootRef.current;
  if (!currentFiberRoot) throw new Error("React DOM did not commit a root");
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
  const fiberRootRef: FiberRootRef = { current: null };
  const onPostCommitFiberRoot = vi.fn((_rendererID: number, fiberRoot: FiberRoot) => {
    fiberRootRef.current = fiberRoot;
  });
  instrument({ onPostCommitFiberRoot });
  expect(onPostCommitFiberRoot).not.toHaveBeenCalled();
  render(<ExampleWithEffect />);
  expect(onPostCommitFiberRoot).toHaveBeenCalled();
  const currentFiberRoot = fiberRootRef.current;
  if (!currentFiberRoot) throw new Error("React DOM did not commit a root");
  expect(currentFiberRoot.current.child?.type).toBe(ExampleWithEffect);
});

it("onScheduleFiberRoot is called", () => {
  const onScheduleFiberRoot = vi.fn();
  const unsubscribe = instrument({ onScheduleFiberRoot });
  render(<Example />);
  expect(onScheduleFiberRoot).toHaveBeenCalled();
  unsubscribe();
});

it("the unsubscribe is usable with `using`", () => {
  const onCommitFiberRoot = vi.fn();
  {
    using _unsubscribe = instrument({ onCommitFiberRoot });
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
  const committedRootRef: FiberRootRef = { current: null };
  const unsubscribeCapture = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRootRef.current = root;
    },
  });
  render(<Example />);
  unsubscribeCapture();
  const committedRoot = committedRootRef.current;
  if (!committedRoot) throw new Error("React DOM did not commit a root");
  const rdtHook = getRDTHook();
  const rendererId = rdtHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const previousOnCommitFiberRoot = rdtHook.onCommitFiberRoot;
  const laterListener = vi.fn();
  const devToolsError = new Error("DevTools failure");
  rdtHook.onCommitFiberRoot = () => {
    throw devToolsError;
  };
  const unsubscribe = instrument({ onCommitFiberRoot: laterListener });

  try {
    expect(() => rdtHook.onCommitFiberRoot(rendererId, committedRoot, undefined, false)).toThrow(
      devToolsError,
    );
    expect(laterListener).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    rdtHook.onCommitFiberRoot = previousOnCommitFiberRoot;
  }
});

it("propagates instrumentation callback failures and stops dispatch", () => {
  const committedRootRef: FiberRootRef = { current: null };
  const unsubscribeCapture = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRootRef.current = root;
    },
  });
  render(<Example />);
  unsubscribeCapture();
  const committedRoot = committedRootRef.current;
  if (!committedRoot) throw new Error("React DOM did not commit a root");
  const rdtHook = getRDTHook();
  const rendererId = rdtHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const laterListener = vi.fn();
  const instrumentationError = new Error("instrumentation failure");
  const unsubscribeThrowingListener = instrument({
    name: "throwing-instrumentation",
    onCommitFiberRoot: () => {
      throw instrumentationError;
    },
  });
  const unsubscribeLaterListener = instrument({ onCommitFiberRoot: laterListener });

  try {
    expect(() => rdtHook.onCommitFiberRoot(rendererId, committedRoot, undefined, false)).toThrow(
      instrumentationError,
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

it("preserves the DevTools hook receiver for existing callbacks", () => {
  const fiberRootRef: FiberRootRef = { current: null };
  const unsubscribeCapture = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      fiberRootRef.current = root;
    },
  });
  render(<Example />);
  unsubscribeCapture();
  const fiberRoot = fiberRootRef.current;
  if (!fiberRoot) throw new Error("React DOM did not commit a root");

  const rdtHook = getRDTHook();
  const rendererId = rdtHook.renderers.keys().next().value;
  if (rendererId === undefined) throw new Error("React DOM did not inject its renderer");
  const callbackReceivers: ReactDevToolsGlobalHook[] = [];
  const existingCallbacks = {
    onCommitFiberRoot(this: ReactDevToolsGlobalHook) {
      callbackReceivers.push(this);
    },
    onCommitFiberUnmount(this: ReactDevToolsGlobalHook) {
      callbackReceivers.push(this);
    },
    onPostCommitFiberRoot(this: ReactDevToolsGlobalHook) {
      callbackReceivers.push(this);
    },
    onScheduleFiberRoot(this: ReactDevToolsGlobalHook) {
      callbackReceivers.push(this);
    },
  };
  rdtHook.onCommitFiberRoot = existingCallbacks.onCommitFiberRoot;
  rdtHook.onCommitFiberUnmount = existingCallbacks.onCommitFiberUnmount;
  rdtHook.onPostCommitFiberRoot = existingCallbacks.onPostCommitFiberRoot;
  rdtHook.onScheduleFiberRoot = existingCallbacks.onScheduleFiberRoot;

  const unsubscribe = instrument({});
  rdtHook.onCommitFiberRoot(rendererId, fiberRoot, undefined, false);
  rdtHook.onCommitFiberUnmount(rendererId, fiberRoot.current);
  rdtHook.onPostCommitFiberRoot(rendererId, fiberRoot);
  rdtHook.onScheduleFiberRoot?.(rendererId, fiberRoot, null);
  unsubscribe();

  expect(callbackReceivers).toEqual([rdtHook, rdtHook, rdtHook, rdtHook]);
});
