import {
  getLatestFiber,
  getReactWorkTagsForFiber,
  instrument,
  isHostFiber,
  traverseFiber,
} from "bippy";
import type { Fiber, Props, ReactDevToolsTarget, ReactRenderer, Unsubscribe } from "bippy";
import { createUnsubscribe } from "./create-unsubscribe.js";
import { copyWithDelete, copyWithRename, copyWithSet } from "./object-path.js";

export interface RendererActionsOptions {
  getRenderer: (fiber: Fiber) => ReactRenderer | null;
  getRendererById: (rendererId: number) => ReactRenderer | null;
  target: ReactDevToolsTarget;
}

export interface RendererActions {
  deleteFiberContext: (fiber: Fiber, path: Array<number | string>) => boolean;
  deleteFiberHookState: (fiber: Fiber, hookId: number, path: Array<number | string>) => boolean;
  deleteFiberProps: (fiber: Fiber, path: Array<number | string>) => boolean;
  deleteFiberState: (fiber: Fiber, path: Array<number | string>) => boolean;
  dispose: Unsubscribe;
  getHostInstances: (fiber: Fiber) => unknown[];
  overrideFiberContext: (fiber: Fiber, path: Array<number | string>, value: unknown) => boolean;
  overrideFiberHookState: (
    fiber: Fiber,
    hookId: number,
    path: Array<number | string>,
    value: unknown,
  ) => boolean;
  overrideFiberProps: (fiber: Fiber, path: Array<number | string>, value: unknown) => boolean;
  overrideFiberState: (fiber: Fiber, path: Array<number | string>, value: unknown) => boolean;
  renameFiberContext: (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => boolean;
  renameFiberHookState: (
    fiber: Fiber,
    hookId: number,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => boolean;
  renameFiberProps: (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => boolean;
  renameFiberState: (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => boolean;
  setFiberError: (fiber: Fiber, shouldError: boolean) => boolean;
  setFiberSuspense: (fiber: Fiber, shouldSuspend: boolean) => boolean;
}

const hasFiber = (fibers: Set<Fiber>, fiber: Fiber): boolean =>
  fibers.has(fiber) || (fiber.alternate !== null && fibers.has(fiber.alternate));

const getTrackedFiber = (fibers: Map<Fiber, boolean>, fiber: Fiber): Fiber =>
  fibers.has(fiber) || fiber.alternate === null ? fiber : fiber.alternate;

const removeFiber = (fibers: Map<Fiber, boolean> | Set<Fiber>, fiber: Fiber): void => {
  fibers.delete(fiber);
  if (fiber.alternate) fibers.delete(fiber.alternate);
};

const getProps = (value: unknown): Props => {
  const props: Props = {};
  if (typeof value !== "object" || value === null) return props;
  for (const key of Object.keys(value)) props[key] = Reflect.get(value, key);
  return props;
};

const getClassInstance = (fiber: Fiber): object | null => {
  const workTags = getReactWorkTagsForFiber(fiber);
  if (fiber.tag !== workTags.ClassComponent && fiber.tag !== workTags.IncompleteClassComponent) {
    return null;
  }
  return typeof fiber.stateNode === "object" && fiber.stateNode !== null ? fiber.stateNode : null;
};

const forceClassUpdate = (instance: object): boolean => {
  const forceUpdate = Reflect.get(instance, "forceUpdate");
  if (typeof forceUpdate !== "function") return false;
  Reflect.apply(forceUpdate, instance, []);
  return true;
};

const scheduleFiber = (renderer: ReactRenderer, fiber: Fiber, isRetry: boolean): void => {
  if (isRetry && renderer.scheduleRetry) renderer.scheduleRetry(fiber);
  else renderer.scheduleUpdate?.(fiber);
};

interface MutableContainer {
  container: object;
  property: number | string;
}

const getMutableContainer = (
  source: unknown,
  path: Array<number | string>,
): MutableContainer | null => {
  if (path.length === 0) return null;
  let container = source;
  for (const property of path.slice(0, -1)) {
    if (typeof container !== "object" || container === null) return null;
    container = Reflect.get(container, property);
  }
  if (typeof container !== "object" || container === null) return null;
  return { container, property: path.at(-1) ?? "" };
};

const setInObject = (source: unknown, path: Array<number | string>, value: unknown): boolean => {
  const target = getMutableContainer(source, path);
  return target ? Reflect.set(target.container, target.property, value) : false;
};

const deletePathInObject = (source: unknown, path: Array<number | string>): boolean => {
  const target = getMutableContainer(source, path);
  if (!target) return false;
  if (Array.isArray(target.container) && typeof target.property === "number") {
    target.container.splice(target.property, 1);
    return true;
  }
  return Reflect.deleteProperty(target.container, target.property);
};

const renamePathInObject = (
  source: unknown,
  oldPath: Array<number | string>,
  newPath: Array<number | string>,
): boolean => {
  const sourceTarget = getMutableContainer(source, oldPath);
  if (!sourceTarget) return false;
  const value = Reflect.get(sourceTarget.container, sourceTarget.property);
  if (!deletePathInObject(source, oldPath)) return false;
  return setInObject(source, newPath, value);
};

export const createRendererActions = ({
  getRenderer,
  getRendererById,
  target,
}: RendererActionsOptions): RendererActions => {
  const forcedErrorFibersByRenderer = new Map<ReactRenderer, Map<Fiber, boolean>>();
  const forcedSuspenseFibersByRenderer = new Map<ReactRenderer, Set<Fiber>>();

  const resetErrorHandler = (renderer: ReactRenderer): void => {
    forcedErrorFibersByRenderer.delete(renderer);
    renderer.setErrorHandler?.(() => null);
  };

  const resetSuspenseHandler = (renderer: ReactRenderer): void => {
    forcedSuspenseFibersByRenderer.delete(renderer);
    renderer.setSuspenseHandler?.(() => false);
  };

  const instrumentationDispose = instrument({
    name: "react-devtools-headless-actions",
    onCommitFiberUnmount: (rendererId, fiber) => {
      const renderer = getRendererById(rendererId);
      if (!renderer) return;
      const forcedErrorFibers = forcedErrorFibersByRenderer.get(renderer);
      if (forcedErrorFibers) {
        removeFiber(forcedErrorFibers, fiber);
        if (forcedErrorFibers.size === 0) resetErrorHandler(renderer);
      }
      const forcedSuspenseFibers = forcedSuspenseFibersByRenderer.get(renderer);
      if (forcedSuspenseFibers) {
        removeFiber(forcedSuspenseFibers, fiber);
        if (forcedSuspenseFibers.size === 0) resetSuspenseHandler(renderer);
      }
    },
    target,
  });

  const readErrorStatus = (
    renderer: ReactRenderer,
    forcedFibers: Map<Fiber, boolean>,
    fiber: Fiber,
  ): boolean | null => {
    const trackedFiber = getTrackedFiber(forcedFibers, fiber);
    const status = forcedFibers.get(trackedFiber);
    if (status === undefined) return null;
    if (!status) {
      forcedFibers.delete(trackedFiber);
      if (forcedFibers.size === 0) resetErrorHandler(renderer);
    }
    return status;
  };

  const setFiberError = (fiber: Fiber, shouldError: boolean): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const renderer = getRenderer(latestFiber);
    if (!renderer?.setErrorHandler) return false;
    const forcedFibers = forcedErrorFibersByRenderer.get(renderer) ?? new Map<Fiber, boolean>();
    forcedFibers.set(latestFiber, shouldError);
    if (latestFiber.alternate) forcedFibers.delete(latestFiber.alternate);
    forcedErrorFibersByRenderer.set(renderer, forcedFibers);
    renderer.setErrorHandler((candidateFiber) =>
      readErrorStatus(renderer, forcedFibers, candidateFiber),
    );
    scheduleFiber(renderer, latestFiber, false);
    return true;
  };

  const setFiberSuspense = (fiber: Fiber, shouldSuspend: boolean): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const renderer = getRenderer(latestFiber);
    if (!renderer?.setSuspenseHandler) return false;
    const forcedFibers = forcedSuspenseFibersByRenderer.get(renderer) ?? new Set<Fiber>();
    if (shouldSuspend) forcedFibers.add(latestFiber);
    else removeFiber(forcedFibers, latestFiber);
    if (forcedFibers.size === 0) forcedSuspenseFibersByRenderer.delete(renderer);
    else forcedSuspenseFibersByRenderer.set(renderer, forcedFibers);
    renderer.setSuspenseHandler((candidateFiber) => hasFiber(forcedFibers, candidateFiber));
    scheduleFiber(renderer, latestFiber, !shouldSuspend);
    return true;
  };

  const overrideFiberProps = (
    fiber: Fiber,
    path: Array<number | string>,
    value: unknown,
  ): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const instance = getClassInstance(latestFiber);
    if (instance) {
      latestFiber.pendingProps = getProps(copyWithSet(Reflect.get(instance, "props"), path, value));
      if (latestFiber.alternate) latestFiber.alternate.pendingProps = latestFiber.pendingProps;
      return forceClassUpdate(instance);
    }
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overrideProps) return false;
    renderer.overrideProps(latestFiber, path, value);
    return true;
  };

  const deleteFiberProps = (fiber: Fiber, path: Array<number | string>): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const instance = getClassInstance(latestFiber);
    if (instance) {
      latestFiber.pendingProps = getProps(copyWithDelete(Reflect.get(instance, "props"), path));
      if (latestFiber.alternate) latestFiber.alternate.pendingProps = latestFiber.pendingProps;
      return forceClassUpdate(instance);
    }
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overridePropsDeletePath) return false;
    renderer.overridePropsDeletePath(latestFiber, path);
    return true;
  };

  const renameFiberProps = (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const instance = getClassInstance(latestFiber);
    if (instance) {
      latestFiber.pendingProps = getProps(
        copyWithRename(Reflect.get(instance, "props"), oldPath, newPath),
      );
      if (latestFiber.alternate) latestFiber.alternate.pendingProps = latestFiber.pendingProps;
      return forceClassUpdate(instance);
    }
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overridePropsRenamePath) return false;
    renderer.overridePropsRenamePath(latestFiber, oldPath, newPath);
    return true;
  };

  const overrideFiberHookState = (
    fiber: Fiber,
    hookId: number,
    path: Array<number | string>,
    value: unknown,
  ): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overrideHookState) return false;
    renderer.overrideHookState(latestFiber, hookId, path, value);
    return true;
  };

  const deleteFiberHookState = (
    fiber: Fiber,
    hookId: number,
    path: Array<number | string>,
  ): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overrideHookStateDeletePath) return false;
    renderer.overrideHookStateDeletePath(latestFiber, hookId, path);
    return true;
  };

  const renameFiberHookState = (
    fiber: Fiber,
    hookId: number,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const renderer = getRenderer(latestFiber);
    if (!renderer?.overrideHookStateRenamePath) return false;
    renderer.overrideHookStateRenamePath(latestFiber, hookId, oldPath, newPath);
    return true;
  };

  const updateClassState = (fiber: Fiber, updateValue: (value: unknown) => unknown): boolean => {
    const latestFiber = getLatestFiber(fiber);
    const instance = getClassInstance(latestFiber);
    if (!instance) return false;
    const nextValue = updateValue(Reflect.get(instance, "state"));
    const updater = Reflect.get(instance, "updater");
    const enqueueReplaceState = Reflect.get(updater, "enqueueReplaceState");
    if (typeof enqueueReplaceState === "function") {
      Reflect.apply(enqueueReplaceState, updater, [instance, nextValue, null]);
      return true;
    }
    Reflect.set(instance, "state", nextValue);
    return forceClassUpdate(instance);
  };

  const updateClassContext = (
    fiber: Fiber,
    updateValue: (instance: object, context: unknown) => boolean,
  ): boolean => {
    const instance = getClassInstance(getLatestFiber(fiber));
    if (!instance || !updateValue(instance, Reflect.get(instance, "context"))) return false;
    return forceClassUpdate(instance);
  };

  const overrideFiberState = (
    fiber: Fiber,
    path: Array<number | string>,
    value: unknown,
  ): boolean => updateClassState(fiber, (state) => copyWithSet(state, path, value));

  const deleteFiberState = (fiber: Fiber, path: Array<number | string>): boolean =>
    updateClassState(fiber, (state) => copyWithDelete(state, path));

  const renameFiberState = (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ): boolean => updateClassState(fiber, (state) => copyWithRename(state, oldPath, newPath));

  const overrideFiberContext = (
    fiber: Fiber,
    path: Array<number | string>,
    value: unknown,
  ): boolean =>
    updateClassContext(fiber, (instance, context) =>
      path.length === 0
        ? Reflect.set(instance, "context", value)
        : setInObject(context, path, value),
    );

  const deleteFiberContext = (fiber: Fiber, path: Array<number | string>): boolean =>
    updateClassContext(fiber, (_instance, context) =>
      path.length === 0 ? true : deletePathInObject(context, path),
    );

  const renameFiberContext = (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ): boolean =>
    updateClassContext(fiber, (_instance, context) =>
      oldPath.length === 0 || newPath.length === 0
        ? true
        : renamePathInObject(context, oldPath, newPath),
    );

  const getHostInstances = (fiber: Fiber): unknown[] => {
    const hostInstances: unknown[] = [];
    traverseFiber(getLatestFiber(fiber), (candidateFiber) => {
      if (!isHostFiber(candidateFiber)) return;
      const resourceState = candidateFiber.memoizedState;
      const resourceInstance =
        typeof resourceState === "object" && resourceState !== null
          ? Reflect.get(resourceState, "instance")
          : null;
      const hostInstance = candidateFiber.stateNode ?? resourceInstance;
      if (hostInstance !== null && hostInstance !== undefined) hostInstances.push(hostInstance);
    });
    return hostInstances;
  };

  const dispose = createUnsubscribe(() => {
    instrumentationDispose();
    for (const renderer of forcedErrorFibersByRenderer.keys()) resetErrorHandler(renderer);
    for (const renderer of forcedSuspenseFibersByRenderer.keys()) resetSuspenseHandler(renderer);
  });

  return {
    deleteFiberContext,
    deleteFiberHookState,
    deleteFiberProps,
    deleteFiberState,
    dispose,
    getHostInstances,
    overrideFiberContext,
    overrideFiberHookState,
    overrideFiberProps,
    overrideFiberState,
    renameFiberContext,
    renameFiberHookState,
    renameFiberProps,
    renameFiberState,
    setFiberError,
    setFiberSuspense,
  };
};
