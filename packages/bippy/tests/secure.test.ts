import "../src/index.js"; // KEEP THIS LINE ON TOP

import { afterEach, expect, it, vi } from "vitest";
import { _fiberRoots, getRDTHook, secure } from "../src/index.js";
import type { Fiber, FiberRoot, InstrumentationOptions, ReactRenderer } from "../src/types.js";

afterEach(() => {
  getRDTHook().renderers.clear();
  _fiberRoots.clear();
});

it("should report renderer inspection errors to onError", () => {
  const rdtHook = getRDTHook();
  rdtHook.renderers.set(1, {} as unknown as ReactRenderer);
  const onError = vi.fn();
  const options = secure({ onActive: vi.fn() }, { onError });
  options.onActive?.();
  expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
});

it("should stay active for production builds when dangerouslyRunInProduction is set", () => {
  const rdtHook = getRDTHook();
  rdtHook.renderers.set(1, {
    bundleType: 0,
    version: "19.0.0",
  } as unknown as ReactRenderer);
  const onActive = vi.fn();
  const options = secure({ onActive }, { dangerouslyRunInProduction: true });
  options.onActive?.();
  expect(onActive).toHaveBeenCalled();
});

it("should track fiber roots and catch onCommitFiberRoot errors", () => {
  const commitError = new Error("commit failed");
  const onCommitFiberRoot = vi.fn(() => {
    throw commitError;
  });
  const onError = vi.fn();
  const options = secure({ onCommitFiberRoot }, { onError });
  options.onActive?.();
  const fakeRoot: FiberRoot = { current: null };
  options.onCommitFiberRoot?.(1, fakeRoot, undefined);
  expect(_fiberRoots.has(fakeRoot)).toBe(true);
  expect(onCommitFiberRoot).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(commitError);
  options.onCommitFiberRoot?.(1, fakeRoot, undefined);
  expect(onCommitFiberRoot).toHaveBeenCalledTimes(2);
});

it("should catch onCommitFiberUnmount errors", () => {
  const unmountError = new Error("unmount failed");
  const onCommitFiberUnmount = vi.fn(() => {
    throw unmountError;
  });
  const onError = vi.fn();
  const options = secure({ onCommitFiberUnmount }, { onError });
  options.onActive?.();
  options.onCommitFiberUnmount?.(1, {} as unknown as Fiber);
  expect(onCommitFiberUnmount).toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(unmountError);
});

it("should catch onPostCommitFiberRoot errors", () => {
  const postCommitError = new Error("post commit failed");
  const onPostCommitFiberRoot = vi.fn(() => {
    throw postCommitError;
  });
  const onError = vi.fn();
  const options = secure({ onPostCommitFiberRoot }, { onError });
  options.onActive?.();
  const fakeRoot: FiberRoot = { current: null };
  options.onPostCommitFiberRoot?.(1, fakeRoot);
  expect(onPostCommitFiberRoot).toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(postCommitError);
});

it("should report errors thrown while wrapping handlers", () => {
  const wrapError = new Error("cannot assign");
  const options: InstrumentationOptions = {};
  Object.defineProperty(options, "onCommitFiberRoot", {
    get: () => vi.fn(),
    set: () => {
      throw wrapError;
    },
  });
  const onError = vi.fn();
  const securedOptions = secure(options, { onError });
  securedOptions.onActive?.();
  expect(onError).toHaveBeenCalledWith(wrapError);
});
