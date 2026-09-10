import { expect, it, vi } from "vite-plus/test";
import {
  _fiberRoots,
  getFiberById,
  getFiberId,
  getRDTHook,
  instrument,
  type FiberRoot,
  type ReactDevToolsTarget,
} from "../../../bippy/src/index.js";
import { onRDTHookReplace } from "../../../bippy/src/rdt-hook.js";
import { createFiber } from "../fiber-fixture.js";

it.each([false, true])(
  "isolates all event callbacks when error reporting throws: %s",
  (doesReportingThrow) => {
    const target: ReactDevToolsTarget = {};
    const hook = getRDTHook(undefined, target);
    const listenerError = new Error("listener failure");
    const fail = vi.fn(() => {
      throw listenerError;
    });
    using reportError = vi.spyOn(console, "error").mockImplementation(() => {
      if (doesReportingThrow) throw new Error("reporting failure");
    });
    hook.onCommitFiberRoot = fail;
    hook.onCommitFiberUnmount = fail;
    hook.onPostCommitFiberRoot = fail;
    hook.onScheduleFiberRoot = fail;
    using _unsubscribeFailure = instrument({
      target,
      onCommitFiberRoot: fail,
      onCommitFiberUnmount: fail,
      onPostCommitFiberRoot: fail,
      onScheduleFiberRoot: fail,
    });
    const laterListener = vi.fn();
    using _unsubscribeLater = instrument({
      target,
      onCommitFiberRoot: laterListener,
      onCommitFiberUnmount: laterListener,
      onPostCommitFiberRoot: laterListener,
      onScheduleFiberRoot: laterListener,
    });
    const root: FiberRoot = {
      current: createFiber({ memoizedState: { element: {}, memoizedState: null, next: null } }),
    };
    const child = createFiber({ return: root.current });
    const fiberId = getFiberId(child);
    hook.onScheduleFiberRoot?.(1, root, "children");
    hook.onCommitFiberRoot(1, root, undefined, true);
    expect(_fiberRoots.has(root)).toBe(true);
    hook.onPostCommitFiberRoot(1, root);
    hook.onCommitFiberUnmount(1, child);
    expect(getFiberById(fiberId)).toBeNull();
    root.current.memoizedState = { element: null, memoizedState: null, next: null };
    hook.onCommitFiberRoot(1, root, undefined, false);
    expect(_fiberRoots.has(root)).toBe(false);
    expect(laterListener.mock.calls).toEqual([
      [1, root, "children"],
      [1, root, undefined, true],
      [1, root],
      [1, child],
      [1, root, undefined, false],
    ]);
    expect(fail).toHaveBeenCalledTimes(10);
    expect(reportError).toHaveBeenCalledTimes(10);
    expect(reportError).toHaveBeenCalledWith(
      "Bippy instrumentation encountered an error:",
      listenerError,
    );
  },
);

it("still registers commit handlers when immediate activation throws", () => {
  const target: ReactDevToolsTarget = {};
  const hook = getRDTHook(undefined, target);
  hook.inject({ version: "19.2.4", rendererPackageName: "test", bundleType: 1 });
  using _reportError = vi.spyOn(console, "error").mockImplementation(() => {});
  const onCommitFiberRoot = vi.fn();
  using _unsubscribe = instrument({
    target,
    onActive: () => {
      throw new Error("active failure");
    },
    onCommitFiberRoot,
  });
  const root: FiberRoot = {
    current: createFiber({ memoizedState: { element: null, memoizedState: null, next: null } }),
  };
  hook.onCommitFiberRoot(1, root, undefined);
  expect(onCommitFiberRoot).toHaveBeenCalledOnce();
});

it("continues hook replacement notifications after a listener throws", () => {
  const target: ReactDevToolsTarget = {};
  const hook = getRDTHook(undefined, target);
  const laterListener = vi.fn();
  using _reportError = vi.spyOn(console, "error").mockImplementation(() => {});
  using _unsubscribeFailure = onRDTHookReplace(() => {
    throw new Error("replacement failure");
  });
  using _unsubscribeLater = onRDTHookReplace(laterListener);
  const replacement = { ...hook };
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacement;
  expect(laterListener).toHaveBeenCalledWith(replacement, target);
});
