import type { Fiber, FiberRoot } from "../../../bippy/src/react-internals/index.js";

export interface FiberRootRegistry {
  addContainer: (container: object) => void;
  addRoot: (root: FiberRoot) => void;
  clear: () => void;
  listRoots: () => FiberRoot[];
}

interface FiberDescription {
  alternateOfExpected: boolean;
  isCurrent: boolean;
  isWorkInProgress: boolean;
  pendingProps: unknown;
  type: string;
}

export interface FiberPredicate {
  (fiber: Fiber): boolean;
}

export interface FiberOracleMismatch {
  actual: FiberDescription | "undefined" | "not-a-fiber";
  devToolsAgrees: boolean | null;
  expected: FiberDescription;
}

interface DevToolsRendererInternals {
  getCurrentFiber?: () => Fiber | null;
}

interface DevToolsHookWithRenderers {
  renderers?: Map<number, DevToolsRendererInternals>;
}

interface LegacyRootContainer {
  _internalRoot: FiberRoot;
}

const isFiberRootLike = (value: unknown): value is FiberRoot =>
  typeof value === "object" && value !== null && "current" in value;

const isFiberShaped = (value: unknown): value is Fiber =>
  typeof value === "object" && value !== null && "tag" in value && "return" in value;

const getFiberRootFromContainer = (container: object): FiberRoot | undefined => {
  const legacyRootContainer: LegacyRootContainer | undefined = Reflect.get(
    container,
    "_reactRootContainer",
  );
  if (legacyRootContainer && isFiberRootLike(legacyRootContainer._internalRoot)) {
    return legacyRootContainer._internalRoot;
  }
  for (const key of Object.keys(container)) {
    if (!key.startsWith("__reactContainer$")) continue;
    const hostRootFiber: Fiber | undefined = Reflect.get(container, key);
    if (hostRootFiber && isFiberRootLike(hostRootFiber.stateNode)) return hostRootFiber.stateNode;
  }
  return undefined;
};

// Legacy roots only exist once `ReactDOM.render` is already rendering, so containers are
// registered up front and resolved to roots lazily.
export const createFiberRootRegistry = (): FiberRootRegistry => {
  const containers = new Set<object>();
  const roots = new Set<FiberRoot>();
  return {
    addContainer: (container) => containers.add(container),
    addRoot: (root) => roots.add(root),
    clear: () => {
      containers.clear();
      roots.clear();
    },
    listRoots: () => {
      const resolvedRoots = new Set(roots);
      for (const container of containers) {
        const root = getFiberRootFromContainer(container);
        if (root) resolvedRoots.add(root);
      }
      return [...resolvedRoots];
    },
  };
};

const collectFibers = (fiber: Fiber | null, predicate: (fiber: Fiber) => boolean): Fiber[] => {
  const matches: Fiber[] = [];
  const visit = (candidate: Fiber | null): void => {
    for (let current = candidate; current; current = current.sibling) {
      if (predicate(current)) matches.push(current);
      visit(current.child);
    }
  };
  visit(fiber);
  return matches;
};

const isReachableFrom = (hostRoot: Fiber | null, fiber: Fiber): boolean => {
  for (let current: Fiber | null = fiber; current; current = current.return) {
    if (current === hostRoot) return true;
  }
  return false;
};

// React passes `workInProgress.pendingProps` verbatim to function components, so the props
// object identity pins the exact fiber object that is rendering without relying on bind.
export const matchByProps =
  (component: unknown, props: object): FiberPredicate =>
  (fiber) =>
    fiber.type === component && fiber.pendingProps === props;

// A `useRef` object lives in `hook.memoizedState`, so only fibers of the component that
// created it carry that hook; the work-in-progress walk then pins the rendering object.
export const matchByHookState =
  (hookState: unknown): FiberPredicate =>
  (fiber) => {
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      if (hook.memoizedState === hookState) return true;
    }
    return false;
  };

const getExpectedWorkInProgressFiber = (
  registry: FiberRootRegistry,
  predicate: FiberPredicate,
): Fiber => {
  const matches: Fiber[] = [];
  for (const root of registry.listRoots()) {
    const workInProgressHostRoot = root.current.alternate;
    if (!workInProgressHostRoot) continue;
    matches.push(
      ...collectFibers(
        workInProgressHostRoot,
        (fiber) => predicate(fiber) && isReachableFrom(workInProgressHostRoot, fiber),
      ),
    );
  }
  if (matches.length !== 1) {
    throw new Error(`oracle expected exactly one work-in-progress fiber, found ${matches.length}`);
  }
  return matches[0];
};

export const getCommittedFiber = (
  registry: FiberRootRegistry,
  component: unknown,
  props: object,
): Fiber | undefined => {
  const matches: Fiber[] = [];
  for (const root of registry.listRoots()) {
    matches.push(
      ...collectFibers(
        root.current,
        (fiber) => fiber.type === component && fiber.memoizedProps === props,
      ),
    );
  }
  if (matches.length > 1) {
    throw new Error(`oracle expected at most one committed fiber, found ${matches.length}`);
  }
  return matches[0];
};

export const getDevToolsCurrentFiber = (): Fiber | null => {
  const hook: DevToolsHookWithRenderers | undefined = Reflect.get(
    globalThis,
    "__REACT_DEVTOOLS_GLOBAL_HOOK__",
  );
  if (!hook?.renderers) return null;
  for (const renderer of hook.renderers.values()) {
    const currentFiber = renderer.getCurrentFiber?.();
    if (currentFiber) return currentFiber;
  }
  return null;
};

const getTypeName = (fiber: Fiber): string => {
  const type: unknown = fiber.type;
  if (typeof type === "function") return type.name || "anonymous";
  if (typeof type === "string") return type;
  return String(fiber.tag);
};

const describeFiber = (
  registry: FiberRootRegistry,
  fiber: Fiber,
  expected: Fiber,
): FiberDescription => {
  let isCurrent = false;
  let isWorkInProgress = false;
  for (const root of registry.listRoots()) {
    if (isReachableFrom(root.current, fiber)) isCurrent = true;
    if (root.current.alternate && isReachableFrom(root.current.alternate, fiber)) {
      isWorkInProgress = true;
    }
  }
  return {
    alternateOfExpected: fiber === expected.alternate,
    isCurrent,
    isWorkInProgress,
    pendingProps: fiber.pendingProps,
    type: getTypeName(fiber),
  };
};

export const checkCallingFiber = (
  registry: FiberRootRegistry,
  predicate: FiberPredicate,
  actual: unknown,
  isDevelopment: boolean,
): FiberOracleMismatch | null => {
  const expected = getExpectedWorkInProgressFiber(registry, predicate);
  const devToolsFiber = isDevelopment ? getDevToolsCurrentFiber() : null;
  const devToolsAgrees = devToolsFiber ? devToolsFiber === expected : null;
  if (actual === expected && devToolsAgrees !== false) return null;
  return {
    actual:
      actual === undefined
        ? "undefined"
        : isFiberShaped(actual)
          ? describeFiber(registry, actual, expected)
          : "not-a-fiber",
    devToolsAgrees,
    expected: describeFiber(registry, expected, expected),
  };
};
