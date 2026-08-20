import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { traverseFiber } from "bippy";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { getFiberDisplayName, getFiberTypeName } from "../src/fiber-metadata.js";
import { createRendererActions } from "../src/renderer-actions.js";
import type { Fiber, FiberRoot, ReactDevToolsTarget, ReactRenderer } from "bippy";
import type { Facade } from "../src/types.js";

interface EditableState {
  value: string;
}

interface RendererHandlers {
  error?: (fiber: Fiber) => boolean | null;
  suspense?: (fiber: Fiber) => boolean;
}

let facade: Facade;
let root: FiberRoot;
let renderer: ReactRenderer;
let functionFiber: Fiber;
let classFiber: Fiber;
let hostFiber: Fiber;

const getFiberByName = (name: string): Fiber => {
  const fiber = traverseFiber(root.current, (candidateFiber) =>
    getFiberDisplayName(candidateFiber) === name ? true : undefined,
  );
  if (!fiber) throw new Error(`Missing ${name}`);
  return fiber;
};

beforeEach(() => {
  facade = installFacade();
  class Editable extends React.Component<object, EditableState> {
    state: EditableState = { value: "before" };

    render() {
      return <div>{this.state.value}</div>;
    }
  }
  const FunctionComponent = () => <span>function</span>;
  render(
    <>
      <Editable />
      <FunctionComponent />
    </>,
  );
  const entry = facade.fiberRoots.entries().next().value;
  if (!entry) throw new Error("Missing renderer root");
  const currentRoot = entry[1].values().next().value;
  const currentRenderer = facade.rendererInternals.get(entry[0]);
  if (!currentRoot || !currentRenderer) throw new Error("Missing renderer state");
  root = currentRoot;
  renderer = currentRenderer;
  classFiber = getFiberByName("Editable");
  functionFiber = getFiberByName("FunctionComponent");
  const currentHostFiber = traverseFiber(root.current, (fiber) =>
    getFiberTypeName(fiber) === "host" ? true : undefined,
  );
  if (!currentHostFiber) throw new Error("Missing host Fiber");
  hostFiber = currentHostFiber;
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream renderer action behavior", () => {
  it("tracks and cleans forced error and Suspense handlers", () => {
    const target: ReactDevToolsTarget = {};
    const handlers: RendererHandlers = {};
    const scheduleRetry = vi.fn();
    const scheduleUpdate = vi.fn();
    const actionRenderer: ReactRenderer = {
      ...renderer,
      scheduleRetry,
      scheduleUpdate,
      setErrorHandler: (handler) => {
        handlers.error = handler;
      },
      setSuspenseHandler: (handler) => {
        handlers.suspense = handler;
      },
    };
    const localFacade = installFacade(target);
    const localHook = localFacade.hook;
    const rendererId = localHook.inject(actionRenderer);
    const actions = createRendererActions({
      getRenderer: () => actionRenderer,
      getRendererById: () => actionRenderer,
      target,
    });

    expect(actions.setFiberError(functionFiber, true)).toBe(true);
    expect(handlers.error?.(functionFiber)).toBe(true);
    expect(scheduleUpdate).toHaveBeenCalledWith(functionFiber);
    localHook.onCommitFiberRoot(rendererId, root, undefined, false);
    expect(handlers.error?.(functionFiber)).toBeNull();

    expect(actions.setFiberSuspense(functionFiber, true)).toBe(true);
    expect(handlers.suspense?.(functionFiber)).toBe(true);
    expect(actions.setFiberSuspense(functionFiber, false)).toBe(true);
    expect(scheduleRetry).toHaveBeenCalledWith(functionFiber);
    expect(actions.setFiberSuspense(functionFiber, true)).toBe(true);
    localHook.onCommitFiberUnmount(rendererId, functionFiber);
    expect(handlers.suspense?.(functionFiber)).toBe(false);

    actions.setFiberError(functionFiber, true);
    actions.setFiberSuspense(functionFiber, true);
    actions.dispose();
    expect(handlers.error?.(functionFiber)).toBeNull();
    expect(handlers.suspense?.(functionFiber)).toBe(false);
    localFacade.dispose();
  });

  it("returns false when renderer capabilities are unavailable", () => {
    const unsupportedRenderer: ReactRenderer = { ...renderer };
    for (const method of [
      "overrideHookState",
      "overrideHookStateDeletePath",
      "overrideHookStateRenamePath",
      "overrideProps",
      "overridePropsDeletePath",
      "overridePropsRenamePath",
      "setErrorHandler",
      "setSuspenseHandler",
    ]) {
      Reflect.set(unsupportedRenderer, method, undefined);
    }
    const actions = createRendererActions({
      getRenderer: () => unsupportedRenderer,
      getRendererById: () => unsupportedRenderer,
      target: {},
    });

    expect(actions.setFiberError(functionFiber, true)).toBe(false);
    expect(actions.setFiberSuspense(functionFiber, true)).toBe(false);
    expect(actions.overrideFiberProps(functionFiber, [], null)).toBe(false);
    expect(actions.deleteFiberProps(functionFiber, [])).toBe(false);
    expect(actions.renameFiberProps(functionFiber, ["before"], ["after"])).toBe(false);
    expect(actions.overrideFiberHookState(functionFiber, 0, [], null)).toBe(false);
    expect(actions.deleteFiberHookState(functionFiber, 0, [])).toBe(false);
    expect(actions.renameFiberHookState(functionFiber, 0, [], [])).toBe(false);
    expect(actions.overrideFiberState(functionFiber, [], null)).toBe(false);
    expect(actions.overrideFiberContext(functionFiber, [], null)).toBe(false);
    actions.dispose();
  });

  it("updates both class Fiber alternates for prop edits", () => {
    const actions = createRendererActions({
      getRenderer: () => renderer,
      getRendererById: () => renderer,
      target: {},
    });
    const instance = {
      forceUpdate: vi.fn(),
      props: { nested: { old: true, remove: true } },
    };
    const alternateFiber: Fiber = {
      ...classFiber,
      alternate: null,
      stateNode: instance,
    };
    const currentFiber: Fiber = {
      ...classFiber,
      alternate: alternateFiber,
      stateNode: instance,
    };
    Reflect.set(alternateFiber, "alternate", currentFiber);

    expect(actions.overrideFiberProps(currentFiber, ["nested", "old"], false)).toBe(true);
    expect(currentFiber.pendingProps).toEqual({ nested: { old: false, remove: true } });
    expect(alternateFiber.pendingProps).toBe(currentFiber.pendingProps);
    expect(actions.deleteFiberProps(currentFiber, ["nested", "remove"])).toBe(true);
    expect(alternateFiber.pendingProps).toBe(currentFiber.pendingProps);
    expect(actions.renameFiberProps(currentFiber, ["nested", "old"], ["nested", "next"])).toBe(
      true,
    );
    expect(alternateFiber.pendingProps).toBe(currentFiber.pendingProps);
    actions.dispose();
  });

  it("handles class fallbacks, invalid context paths, and resource host instances", () => {
    const actions = createRendererActions({
      getRenderer: () => renderer,
      getRendererById: () => renderer,
      target: {},
    });
    const instance = {
      context: { array: [1, 2], nested: { value: true } },
      props: null,
      state: { value: "before" },
      updater: {},
    };
    const fallbackClassFiber: Fiber = {
      ...classFiber,
      alternate: null,
      stateNode: instance,
    };

    expect(actions.overrideFiberProps(fallbackClassFiber, [], null)).toBe(false);
    expect(actions.overrideFiberState(fallbackClassFiber, ["value"], "after")).toBe(false);
    expect(actions.overrideFiberContext(fallbackClassFiber, ["missing", "value"], true)).toBe(
      false,
    );
    expect(actions.deleteFiberContext(fallbackClassFiber, ["array", 0])).toBe(false);
    expect(actions.renameFiberContext(fallbackClassFiber, ["missing"], ["after"])).toBe(false);

    const resourceInstance = { resource: true };
    const resourceFiber: Fiber = {
      ...hostFiber,
      alternate: null,
      child: null,
      memoizedState: null,
      sibling: null,
      stateNode: null,
    };
    Reflect.set(resourceFiber, "memoizedState", { instance: resourceInstance });
    expect(actions.getHostInstances(resourceFiber)).toEqual([resourceInstance]);
    actions.dispose();
  });
});
