import "./stubs/node-globals.js";
import {
  didFiberRender,
  getDisplayName,
  getReactWorkTagsForFiber,
  instrument,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { Component, cloneElement, createElement, isValidElement } from "react";
import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Sample } from "../../src/core/types.js";
import { forEachPlainObject, isPlainData, snapshotValue } from "./snapshot.js";
import { STAND_IN } from "./stubs/stand-in.js";
import { PROVIDERS_PATH, SETUP_PATH, TRUNCATED_VALUE, WRAPPER_PATH } from "./types.js";
import type {
  Action,
  ActionTarget,
  Capture,
  MountRequest,
  MutationHit,
  ProbeHit,
  Shape,
  Wrapper,
} from "./types.js";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
}

interface MountedAction extends Action {
  element: HTMLElement;
  value: string;
}

interface PendingMutationHit {
  id: string;
  target: object;
  writeCount: number;
  snapshot: string;
  renderCount: number;
}

interface LoadedWrapper {
  type: unknown;
  props: Record<string, unknown>;
}

interface RecordedError {
  message: string;
  depth: number | null;
}

interface TrackedState {
  owner: string;
  target: object;
  snapshot: string;
}

const ANONYMOUS_NAME = "Anonymous";
const WRAPPER_PROPS = { open: true, defaultOpen: true, type: "single", collapsible: true };
const SETTLE_MS = 40;
const MAX_CAPTURED_FIBERS = 10_000;
const MAX_SETTLE_MS = 3000;
const MAX_PLAIN_DEPTH = 4;
const MAX_PLAIN_NODES = 2000;
const DEPTH_MARKER_PREFIX = "BippyVerifyDepth";
const DEPTH_MARKER_PATTERN = new RegExp(`\\bat ${DEPTH_MARKER_PREFIX}(\\d+)\\b`);
const INPUT_TAGS = new Set(["input", "textarea", "select"]);
const CHANGE_VALUES = ["text", ""];
const MUTATING_COLLECTION_METHODS = new Set(["set", "add", "delete", "clear"]);
const MUTATING_ARRAY_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

let probeHits: ProbeHit[] = [];
let latestRoot: FiberRoot | null = null;
let mountedType: unknown = null;
let mountedRoot: Root | null = null;
let renderError: RecordedError | null = null;
let caughtError: RecordedError | null = null;
let renderCount = 0;
let lastCommittedFiber: Fiber | null = null;
let firstCommitShapes: Shape[] | null = null;
let pendingMutationHits: PendingMutationHit[] = [];
let trackedStates: TrackedState[] = [];
let stateOwners = new WeakMap<object, string>();
let propWrites = new Set<string>();
const depthMarkers = new Map<number, ComponentType<{ children?: ReactNode }>>();
const propOwners = new WeakMap<object, string>();
const writeCounts = new WeakMap<object, number>();
const writeTrackers = new WeakMap<object, object>();
const trackedTargets = new WeakMap<object, object>();

const recordWrite = (target: object): void => {
  writeCounts.set(target, (writeCounts.get(target) ?? 0) + 1);
  const owner = propOwners.get(target);
  if (owner) propWrites.add(owner);
};

const isMutatingMethod = (target: object, key: string | symbol): boolean =>
  typeof key === "string" &&
  (target instanceof Date ? key.startsWith("set") : MUTATING_COLLECTION_METHODS.has(key));

const trackWrites = (target: object, isDeep: boolean): object => {
  const existing = writeTrackers.get(target);
  if (existing) return existing;
  const tracker = new Proxy(target, {
    get: (innerTarget, key, receiver) => {
      const member: unknown = Reflect.get(innerTarget, key);
      if (innerTarget instanceof Map || innerTarget instanceof Set || innerTarget instanceof Date) {
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          if (isMutatingMethod(innerTarget, key)) recordWrite(innerTarget);
          return Reflect.apply(member, innerTarget, args);
        };
      }
      if (
        Array.isArray(innerTarget) &&
        typeof member === "function" &&
        typeof key === "string" &&
        MUTATING_ARRAY_METHODS.has(key)
      ) {
        return (...args: unknown[]) => {
          recordWrite(innerTarget);
          return Reflect.apply(member, receiver, args);
        };
      }
      return isDeep && isPlainData(member) && !Object.isFrozen(innerTarget)
        ? trackWrites(member, true)
        : member;
    },
    set: (innerTarget, key, value) => {
      recordWrite(innerTarget);
      return Reflect.set(innerTarget, key, value);
    },
    deleteProperty: (innerTarget, key) => {
      recordWrite(innerTarget);
      return Reflect.deleteProperty(innerTarget, key);
    },
    defineProperty: (innerTarget, key, descriptor) => {
      recordWrite(innerTarget);
      return Reflect.defineProperty(innerTarget, key, descriptor);
    },
  });
  writeTrackers.set(target, tracker);
  trackedTargets.set(tracker, target);
  return tracker;
};

const recordMutationProbe = (id: string, value: unknown): unknown => {
  if (!isPlainData(value)) return value;
  const target = trackedTargets.get(value) ?? value;
  pendingMutationHits.push({
    id,
    target,
    writeCount: writeCounts.get(target) ?? 0,
    snapshot: snapshotValue(target),
    renderCount,
  });
  return trackedTargets.has(value) ? value : trackWrites(target, false);
};

globalThis.__bippyProbe = (id, mode, value) => {
  if (mode === "mutation") return recordMutationProbe(id, value);
  probeHits.push({
    id,
    outcome: mode === "nullish" ? value !== null && value !== undefined : Boolean(value),
  });
  return value;
};

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    latestRoot = root;
    const fiber = findMountedFiber();
    if (fiber && fiber !== lastCommittedFiber && didFiberRender(fiber)) renderCount++;
    lastCommittedFiber = fiber;
    if (fiber && firstCommitShapes === null && !isTooLarge(fiber))
      firstCommitShapes = getChildren(fiber).flatMap(toShapes);
    if (fiber) trackStates(fiber);
  },
});

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError = (): BoundaryState => ({ hasError: true });

  componentDidCatch = (error: unknown, errorInfo: ErrorInfo): void => {
    renderError = recordError(error, errorInfo);
  };

  render = (): ReactNode => (this.state.hasError ? null : this.props.children);
}

const hydrateProp = (name: string, sample: Sample): unknown => {
  const value = hydrate(sample);
  if (!isPlainData(value)) return value;
  forEachPlainObject(value, (object) => propOwners.set(object, `prop:${name}`));
  return trackWrites(value, true);
};

const createOpenObject = (fields: Record<string, unknown>): Record<string, unknown> =>
  new Proxy(fields, {
    get: (target, key) =>
      Reflect.has(target, key) || typeof key === "symbol" || key === "then" || key === "toJSON"
        ? Reflect.get(target, key)
        : STAND_IN,
  });

const hydrate = (sample: Sample): unknown => {
  switch (sample.kind) {
    case "Value":
      return sample.value;
    case "Undefined":
      return undefined;
    case "Function": {
      const { returns } = sample;
      return () => (returns ? hydrate(returns) : undefined);
    }
    case "Element":
      return createElement("span", null, "text");
    case "Promise":
      return Promise.resolve(hydrate(sample.value));
    case "Array":
      return sample.items.map(hydrate);
    case "Object": {
      const fields = Object.fromEntries(
        Object.entries(sample.fields).map(([name, field]) => [name, hydrate(field)]),
      );
      return sample.isOpen ? createOpenObject(fields) : fields;
    }
  }
};

/**
 * A hook's state as plain data to send to the verifier, cut off past a depth and a number of
 * objects, since a component's state can hold a whole table of rows.
 */
const toPlain = (value: unknown): unknown => {
  let nodeCount = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    )
      return current;
    if (current === undefined) return undefined;
    if (typeof current === "function") return "[function]";
    if (depth >= MAX_PLAIN_DEPTH || typeof current !== "object") return "[value]";
    if (current instanceof Node) return "[node]";
    if (++nodeCount > MAX_PLAIN_NODES) return TRUNCATED_VALUE;
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [key, visit(item, depth + 1)]),
    );
  };
  return visit(value, 0);
};

const getChildren = (fiber: Fiber): Fiber[] => {
  const children: Fiber[] = [];
  for (let child = fiber.child; child; child = child.sibling) children.push(child);
  return children;
};

/**
 * The fiber that renders the mounted component's output. `memo(forwardRef(...))` mounts as
 * a memo fiber around a forward ref fiber, and the inner one holds its hooks and children.
 */
const findMountedFiber = (): Fiber | null => {
  let fiber = traverseFiber(
    latestRoot?.current ?? null,
    (candidate) => candidate.elementType === mountedType || candidate.type === mountedType,
  );
  while (fiber?.child && fiber.child.elementType === Reflect.get(Object(fiber.type), "type"))
    fiber = fiber.child;
  return fiber;
};

/**
 * Whether a render has more fibers than a comparison can handle, like a subtree repeated
 * at every level, which doubles with each.
 */
const isTooLarge = (fiber: Fiber): boolean => {
  let count = 0;
  const pending = [...getChildren(fiber)];
  for (let current = pending.pop(); current; current = pending.pop()) {
    if (++count > MAX_CAPTURED_FIBERS) return true;
    pending.push(...getChildren(current));
  }
  return false;
};

const toShapes = (fiber: Fiber): Shape[] => {
  if (fiber.tag === getReactWorkTagsForFiber(fiber).HostText)
    return [{ kind: "text", text: String(fiber.memoizedProps) }];
  if (isHostFiber(fiber)) {
    const children = getChildren(fiber).flatMap(toShapes);
    const textContent: unknown = fiber.memoizedProps?.children;
    const isTextOnly =
      children.length === 0 && (typeof textContent === "string" || typeof textContent === "number");
    return [
      {
        kind: "element",
        tag: String(fiber.type),
        children: isTextOnly ? [{ kind: "text", text: String(textContent) }] : children,
      },
    ];
  }
  if (isCompositeFiber(fiber))
    return [{ kind: "component", name: getDisplayName(fiber.type) ?? ANONYMOUS_NAME }];
  return getChildren(fiber).flatMap(toShapes);
};

const readRawHookStates = (fiber: Fiber): unknown[] => {
  const values: unknown[] = [];
  for (
    let hook = fiber.memoizedState;
    hook && typeof hook === "object" && "next" in hook;
    hook = hook.next
  ) {
    if (hook.queue) values.push(hook.memoizedState);
  }
  return values;
};

const getStateOwners = (states: unknown[]): Map<object, string> => {
  const owners = new Map<object, string>();
  states.forEach((state, hookIndex) =>
    forEachPlainObject(state, (object) => {
      if (!owners.has(object)) owners.set(object, `state:${hookIndex}`);
    }),
  );
  return owners;
};

const trackStates = (fiber: Fiber): Map<object, string> => {
  const states = readRawHookStates(fiber);
  states.forEach((state, hookIndex) => {
    if (!isPlainData(state) || trackedStates.some((tracked) => tracked.target === state)) return;
    trackedStates.push({
      owner: `state:${hookIndex}`,
      target: state,
      snapshot: snapshotValue(state),
    });
  });
  const currentOwners = getStateOwners(states);
  for (const [object, owner] of currentOwners)
    if (!stateOwners.has(object)) stateOwners.set(object, owner);
  return currentOwners;
};

const takeMutations = (fiber: Fiber): Pick<Capture, "mutationHits" | "mutatedOwners"> => {
  const currentOwners = trackStates(fiber);
  const mutatedOwners = new Set(propWrites);
  for (const tracked of trackedStates)
    if (snapshotValue(tracked.target) !== tracked.snapshot) mutatedOwners.add(tracked.owner);
  const mutationHits = new Map<string, MutationHit>();
  for (const hit of pendingMutationHits) {
    const owner = stateOwners.get(hit.target) ?? propOwners.get(hit.target) ?? null;
    const isWritten =
      (writeCounts.get(hit.target) ?? 0) > hit.writeCount ||
      snapshotValue(hit.target) !== hit.snapshot;
    const isLost = isWritten && currentOwners.has(hit.target) && renderCount === hit.renderCount;
    const key = `${hit.id}:${owner}`;
    const previous = mutationHits.get(key);
    mutationHits.set(key, {
      id: hit.id,
      owner,
      isWritten: isWritten || (previous?.isWritten ?? false),
      isLost: isLost || (previous?.isLost ?? false),
    });
  }
  pendingMutationHits = [];
  propWrites = new Set();
  trackedStates = [];
  trackStates(fiber);
  return { mutationHits: [...mutationHits.values()], mutatedOwners: [...mutatedOwners] };
};

const readHookStates = (fiber: Fiber): unknown[] =>
  readRawHookStates(fiber).map((state) => toPlain(state));

const takeProbeHits = (): ProbeHit[] => {
  const hits = probeHits;
  probeHits = [];
  return hits;
};

let pendingRequests = 0;
const trackRequest = <Result>(request: Promise<Result>): Promise<Result> => {
  pendingRequests++;
  return request.finally(() => pendingRequests--);
};
/**
 * The answer to a request for another origin, which the harness blocks: JSON with any
 * field, so an app that fetches its data from an API renders around it. Its `error` and
 * `errors` are absent, as in a successful response.
 */
const createStandInResponse = (): Response => {
  const response = new Response("{}", { headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "json", {
    value: async () => createOpenObject({ error: undefined, errors: undefined }),
  });
  return response;
};

const originalFetch = window.fetch;
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  return trackRequest(
    url.origin === location.origin || !url.protocol.startsWith("http")
      ? originalFetch(input, init)
      : Promise.resolve(createStandInResponse()),
  );
};
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function send(...args) {
  pendingRequests++;
  this.addEventListener("loadend", () => pendingRequests--, { once: true });
  originalSend.apply(this, args);
};

const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

/**
 * What an error says, including a plain object thrown with a `message`, as a data client
 * might throw for a failed request.
 */
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const message: unknown =
    typeof error === "object" && error ? Reflect.get(error, "message") : null;
  return typeof message === "string" ? message : String(error);
};

/**
 * An error and how many wrappers enclose the component that threw it, read from the depth
 * markers on React's component stack: none when it threw above them all.
 */
const recordError = (error: unknown, errorInfo?: ErrorInfo): RecordedError => {
  const componentStack = errorInfo?.componentStack;
  return {
    message: getErrorMessage(error),
    depth: componentStack ? Number(DEPTH_MARKER_PATTERN.exec(componentStack)?.[1] ?? 0) : null,
  };
};

/**
 * An error boundary of the app's own, like one its setup wraps every component in, catches
 * a render error before the harness's boundary does. React still reports it, through
 * `onCaughtError` from React 19 and as a global error event before, so a component that
 * rendered nothing can say why.
 */
const recordCaughtError = (error: unknown, errorInfo?: ErrorInfo): void => {
  caughtError ??= recordError(error, errorInfo);
};

window.addEventListener("error", (event) => recordCaughtError(event.error));

/**
 * Waits for the page to go quiet: no requests in flight and, once mounting, the component
 * rendered. Data loads through mocked APIs, so a screen right after an action often still
 * shows its loading state.
 */
const settle = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  do await wait();
  while (
    (pendingRequests > 0 ||
      (mountedType !== null && !findMountedFiber() && !renderError && !caughtError)) &&
    performance.now() < deadline
  );
};

const getRecordedError = (): RecordedError | null => renderError ?? caughtError;

const createEmptyCapture = (error: string, errorDepth: number | null = null): Capture => ({
  shapes: [],
  hookStates: [],
  probes: takeProbeHits(),
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error,
  errorDepth,
});

const capture = (): Capture => {
  const fiber = findMountedFiber();
  if (!fiber) {
    const error = getRecordedError();
    return createEmptyCapture(error?.message ?? "component did not render", error?.depth);
  }
  if (isTooLarge(fiber))
    return createEmptyCapture(`component rendered more than ${MAX_CAPTURED_FIBERS} fibers`);
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    hookStates: readHookStates(fiber),
    probes: takeProbeHits(),
    ...takeMutations(fiber),
    firstCommitShapes: null,
    error: renderError?.message ?? null,
    errorDepth: renderError?.depth ?? null,
  };
};

const getLabel = (element: HTMLElement): string =>
  (
    element.getAttribute("aria-label") ??
    element.getAttribute("name") ??
    element.getAttribute("placeholder") ??
    element.textContent ??
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);

const isMountedType = (type: unknown): boolean =>
  type !== null &&
  (type === mountedType ||
    type === Reflect.get(Object(mountedType), "type") ||
    type === Reflect.get(Object(mountedType), "render"));

/**
 * Whether a child component, not the mounted one, created an element: React records the
 * component that rendered each element as its owner in development builds.
 */
const isRenderedByChild = (fiber: Fiber): boolean => {
  const owner: unknown = Reflect.get(fiber, "_debugOwner");
  const ownerType: unknown = owner && typeof owner === "object" ? Reflect.get(owner, "type") : null;
  return ownerType !== null && ownerType !== undefined && !isMountedType(ownerType);
};

const collectActions = (): MountedAction[] => {
  const fiber = findMountedFiber();
  const actions: MountedAction[] = [];
  const keyCounts = new Map<string, number>();
  const visit = (current: Fiber, clickAncestors: ActionTarget[]): void => {
    let childClickAncestors = clickAncestors;
    if (isHostFiber(current) && current.stateNode instanceof HTMLElement) {
      const props: Record<string, unknown> = current.memoizedProps ?? {};
      const tag = String(current.type);
      const label = getLabel(current.stateNode);
      const candidates: Array<Pick<MountedAction, "kind" | "value">> = [];
      if (typeof props.onClick === "function" && props.disabled !== true)
        candidates.push({ kind: "click", value: "" });
      if (
        INPUT_TAGS.has(tag) &&
        props.type !== "file" &&
        (typeof props.onChange === "function" || typeof props.onInput === "function")
      ) {
        for (const value of CHANGE_VALUES) candidates.push({ kind: "change", value });
      }
      for (const candidate of candidates) {
        const baseKey = `${candidate.kind}:${tag}:${label}${candidate.kind === "change" ? `=${candidate.value}` : ""}`;
        const count = keyCounts.get(baseKey) ?? 0;
        keyCounts.set(baseKey, count + 1);
        actions.push({
          ...candidate,
          key: count === 0 ? baseKey : `${baseKey}#${count}`,
          tag,
          label,
          isInChild: isRenderedByChild(current),
          clickAncestors,
          element: current.stateNode,
        });
      }
      if (typeof props.onClick === "function")
        childClickAncestors = [...clickAncestors, { tag, label }];
    }
    for (const child of getChildren(current)) visit(child, childClickAncestors);
  };
  if (fiber) for (const child of getChildren(fiber)) visit(child, []);
  return actions;
};

const setInputValue = (element: HTMLElement, value: string): void => {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const isComponentType = (value: unknown): boolean =>
  typeof value === "function" ||
  (typeof value === "object" && value !== null && "$$typeof" in value);

/**
 * A component, or the `Root` of a namespace of parts, like Base UI's `Menu`.
 */
const getComponentType = (value: unknown): unknown =>
  isComponentType(value) ? value : Reflect.get(Object(value), "Root");

/**
 * Loads the first candidate module, or namespace of parts in it, that exports the wrapper.
 * A package may export it under a shorter name than its errors use, like `Content` for
 * Radix's internal `MenuContent`, a module under a longer one, like `DropdownMenu` for
 * `Menu`, or only as its `Root`.
 */
const loadWrapper = async (wrapper: Wrapper): Promise<LoadedWrapper | null> => {
  for (const candidate of wrapper.candidates) {
    const query = new URLSearchParams({
      specifier: candidate.specifier,
      importer: candidate.importer,
    });
    const imported: Record<string, unknown> = await import(
      /* @vite-ignore */ `${WRAPPER_PATH}?${query}`
    ).catch(() => ({}));
    const moduleExports: Record<string, unknown> = candidate.namespace
      ? Object(imported[candidate.namespace])
      : imported;
    const exportNames = Object.keys(moduleExports).filter((name) => /^[A-Z]/.test(name));
    const shortName = candidate.isRootAllowed
      ? (exportNames
          .filter((name) => candidate.exportName.endsWith(name))
          .sort((left, right) => right.length - left.length)[0] ??
        exportNames
          .filter((name) => name.endsWith(candidate.exportName))
          .sort((left, right) => left.length - right.length)[0])
      : undefined;
    const value =
      moduleExports[candidate.exportName] ??
      (shortName ? moduleExports[shortName] : undefined) ??
      (candidate.isRootAllowed ? moduleExports.Root : undefined);
    const componentType = getComponentType(value);
    if (isComponentType(componentType))
      return {
        type: componentType,
        props: Object.fromEntries(
          Object.entries(candidate.props).map(([name, sample]) => [name, hydrate(sample)]),
        ),
      };
  }
  return null;
};

const isAsyncFunction = (
  value: unknown,
): value is (props: Record<string, unknown>) => Promise<unknown> =>
  typeof value === "function" && value.constructor.name === "AsyncFunction";

const ASYNC_CLIENT_COMPONENT_PATTERN =
  /async\/await is not yet supported in Client Components|is an async Client Component/;

const isFunctionComponent = (
  value: unknown,
): value is (props: Record<string, unknown>) => unknown =>
  typeof value === "function" && !Reflect.get(Object(value.prototype), "isReactComponent");

/**
 * A component of the same name as one a server rendered, which returns what it rendered,
 * so the mounted tree still has a fiber for it.
 */
const createResolvedComponent = (type: unknown, output: unknown): (() => ReactNode) => {
  // HACK: what a server component rendered is whatever React accepts as children.
  const resolved = (): ReactNode => output as ReactNode;
  Object.defineProperty(resolved, "name", { value: Reflect.get(Object(type), "name") });
  const displayName: unknown = Reflect.get(Object(type), "displayName");
  if (displayName) Object.assign(resolved, { displayName });
  return resolved;
};

/**
 * Calls a component as a server would, or returns null for one that only renders on the
 * client, which throws outside React for want of its hooks.
 */
const callServerComponent = async (
  type: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
): Promise<{ output: unknown } | null> => {
  try {
    return { output: await type(props) };
  } catch {
    return null;
  }
};

/**
 * Renders the server components in a tree as a server does before the browser gets it:
 * each async component is awaited, and what it returns, and every element passed as a
 * prop, like a Suspense `fallback`, is resolved in turn. Once a page turns out to render
 * async components under synchronous ones, every component is called this way, except
 * those that need a client.
 */
const resolveServerTree = async (node: unknown, isEveryComponent = false): Promise<unknown> => {
  if (Array.isArray(node))
    return Promise.all(node.map((item) => resolveServerTree(item, isEveryComponent)));
  if (node instanceof Promise) return resolveServerTree(await node, isEveryComponent);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  const rendered =
    isAsyncFunction(node.type) || (isEveryComponent && isFunctionComponent(node.type))
      ? await callServerComponent(node.type, node.props)
      : null;
  if (rendered)
    return createElement(
      createResolvedComponent(
        node.type,
        await resolveServerTree(rendered.output, isEveryComponent),
      ),
      { key: node.key },
    );
  const props = await Promise.all(
    Object.entries(node.props).map(async ([name, value]) => [
      name,
      isValidElement(value) || Array.isArray(value)
        ? await resolveServerTree(value, isEveryComponent)
        : value,
    ]),
  );
  return cloneElement(node, Object.fromEntries(props));
};

/**
 * A component that only renders its children, named for how many wrappers enclose it, so
 * that React's component stack for an error says which wrapper it came from.
 */
const getDepthMarker = (depth: number): ComponentType<{ children?: ReactNode }> => {
  const cached = depthMarkers.get(depth);
  if (cached) return cached;
  const marker = ({ children }: { children?: ReactNode }): ReactNode => children;
  Object.defineProperty(marker, "name", { value: `${DEPTH_MARKER_PREFIX}${depth}` });
  depthMarkers.set(depth, marker);
  return marker;
};

const mount = async (request: MountRequest): Promise<Capture> => {
  mountedRoot?.unmount();
  mountedType = null;
  await settle();
  probeHits = [];
  renderError = null;
  caughtError = null;
  lastCommittedFiber = null;
  firstCommitShapes = null;
  pendingMutationHits = [];
  trackedStates = [];
  stateOwners = new WeakMap();
  propWrites = new Set();
  const { default: Providers }: { default: (props: { children: ReactNode }) => ReactNode } =
    await import(/* @vite-ignore */ PROVIDERS_PATH);
  if (request.scenario) {
    const { scenarios }: { scenarios?: Record<string, (...args: unknown[]) => unknown> } =
      await import(/* @vite-ignore */ SETUP_PATH);
    const scenario = scenarios?.[request.scenario.name];
    if (!scenario) return createEmptyCapture(`setup has no scenario ${request.scenario.name}`);
    await scenario(...request.scenario.args);
  }
  // HACK: Vite adds `?import` to a root-relative URL imported at runtime, which would load
  // the component's file a second time beside its static importers, like a wrapper from
  // the same file, each with its own contexts. A full URL is left alone.
  const moduleExports: Record<string, unknown> = await import(
    /* @vite-ignore */ new URL(request.moduleUrl, location.origin).href
  );
  const componentType = moduleExports[request.exportName];
  if (!componentType) return createEmptyCapture(`export ${request.exportName} not found`);
  const props = Object.fromEntries(
    Object.entries(request.props).map(([name, sample]) => [name, hydrateProp(name, sample)]),
  );
  const loadedWrappers = await Promise.all(request.wrappers.map(loadWrapper));
  const render = async (type: unknown): Promise<void> => {
    mountedRoot?.unmount();
    renderError = null;
    caughtError = null;
    lastCommittedFiber = null;
    firstCommitShapes = null;
    mountedType = type;
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    mountedRoot = createRoot(container, { onCaughtError: recordCaughtError });
    // HACK: the component and wrapper types come from dynamic imports, so React's element
    // typing can't see them.
    let element = createElement(type as Parameters<typeof createElement>[0], props);
    for (let depth = loadedWrappers.length; depth > 0; depth--) {
      const wrapper = loadedWrappers[depth - 1];
      if (wrapper)
        element = createElement(
          wrapper.type as ComponentType<Record<string, unknown>>,
          { ...wrapper.props, ...WRAPPER_PROPS },
          createElement(getDepthMarker(depth), null, element),
        );
    }
    mountedRoot.render(createElement(Boundary, null, createElement(Providers, null, element)));
    await settle();
  };
  try {
    if (isAsyncFunction(componentType)) {
      const output = await resolveServerTree(await componentType(props));
      await render(() => output);
    } else {
      await render(componentType);
      const error = getRecordedError();
      const rendered =
        error &&
        ASYNC_CLIENT_COMPONENT_PATTERN.test(error.message) &&
        isFunctionComponent(componentType)
          ? await callServerComponent(componentType, props)
          : null;
      if (rendered) {
        const output = await resolveServerTree(rendered.output, true);
        await render(() => output);
      }
    }
  } catch (error) {
    return createEmptyCapture(recordError(error).message);
  }
  return { ...capture(), firstCommitShapes };
};

const perform = async (key: string): Promise<Capture | null> => {
  const action = collectActions().find((candidate) => candidate.key === key);
  if (!action) return null;
  if (action.kind === "click") action.element.click();
  else setInputValue(action.element, action.value);
  await settle();
  return capture();
};

const preventNavigation = (event: Event): void => {
  const target = event.target;
  if (event.type === "submit" || (target instanceof Element && target.closest("a[href]")))
    event.preventDefault();
};

document.addEventListener("click", preventNavigation, true);
document.addEventListener("submit", preventNavigation, true);
// Scripts navigate too, like next-auth setting `location.href` when sign-in fails, and
// leaving the page would unload the harness.
navigation.addEventListener("navigate", (event) => {
  if (event.cancelable && !event.hashChange) event.preventDefault();
});

window.__verify = {
  mount,
  actions: () => collectActions().map(({ element: _element, value: _value, ...action }) => action),
  perform,
  observe: async () => {
    await settle();
    return capture();
  },
};
