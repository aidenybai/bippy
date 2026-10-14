import "./stubs/node-globals";
import {
  didFiberRender,
  getDisplayName,
  getRDTHook,
  getReactWorkTagsForFiber,
  instrument,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
} from "bippy";
import type { Fiber, FiberRoot, MemoizedState } from "bippy";
import { Component, cloneElement, createElement, isValidElement } from "react";
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Sample } from "../../../src/core/types";
import { getErrorMessage } from "./reasons";
import type { MountFailure } from "./reasons";
import { forEachPlainObject, isPlainData, isPlainRecord, snapshotValue } from "./snapshot";
import { STAND_IN } from "./stubs/stand-in";
import { isLibraryHookDispatch, isWrittenByLibrary, watchHookCallers } from "./write-origins";
import {
  MAX_ACTION_LABEL_LENGTH,
  PROVIDERS_PATH,
  SETUP_PATH,
  TRUNCATED_VALUE,
  WRAPPER_PATH,
  getPropOwner,
  getStateOwner,
} from "./types";
import type {
  Action,
  ActionTarget,
  Capture,
  MountRequest,
  MutationHit,
  ProbeHit,
  Shape,
  Wrapper,
} from "./types";

interface BoundaryProps {
  children: ReactNode;
}

interface ProvidersProps {
  children?: ReactNode;
  isRouterless: boolean;
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

interface ChildrenProps {
  children?: ReactNode;
}

interface FunctionComponent {
  (props: Record<string, unknown>): unknown;
}

interface ServerRender {
  output: unknown;
}

interface ProvidersModule {
  default: ComponentType<ProvidersProps>;
}

interface SetupModule {
  scenarios?: Record<string, (...scenarioArguments: unknown[]) => unknown>;
}

interface MountedComponent {
  props: Record<string, unknown>;
  wrappers: Array<LoadedWrapper | null>;
  Providers: ComponentType<ProvidersProps>;
}

const ANONYMOUS_NAME = "Anonymous";
const OPEN_PARENT_PROPS = { open: true, defaultOpen: true, type: "single", collapsible: true };
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
let pendingRequests = 0;
const depthMarkers = new Map<number, ComponentType<ChildrenProps>>();
const propOwners = new WeakMap<object, string>();
const writeCounts = new WeakMap<object, number>();
const writeTrackers = new WeakMap<object, object>();
const trackedTargets = new WeakMap<object, object>();

const recordWrite = (target: object): void => {
  writeCounts.set(target, (writeCounts.get(target) ?? 0) + 1);
  const owner = propOwners.get(target);
  if (owner && !isWrittenByLibrary()) propWrites.add(owner);
};

const isRefObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(value).length === 1 &&
  Object.hasOwn(value, "current");

const isMutatingMethod = (target: object, key: string | symbol): boolean =>
  typeof key === "string" &&
  (target instanceof Date ? key.startsWith("set") : MUTATING_COLLECTION_METHODS.has(key));

const isFreezing = (
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor,
): boolean => {
  const current = Reflect.getOwnPropertyDescriptor(target, key);
  return (
    current !== undefined &&
    descriptor.get === undefined &&
    descriptor.set === undefined &&
    (!("value" in descriptor) || Object.is(descriptor.value, current.value))
  );
};

const getTrackedMember = (
  target: object,
  key: string | symbol,
  receiver: unknown,
  isDeep: boolean,
): unknown => {
  const member: unknown = Reflect.get(target, key);
  if (target instanceof Map || target instanceof Set || target instanceof Date) {
    if (typeof member !== "function" || key === "constructor") return member;
    return (...callArguments: unknown[]) => {
      if (isMutatingMethod(target, key)) recordWrite(target);
      return Reflect.apply(member, target, callArguments);
    };
  }
  if (
    Array.isArray(target) &&
    typeof member === "function" &&
    typeof key === "string" &&
    MUTATING_ARRAY_METHODS.has(key)
  ) {
    return (...callArguments: unknown[]) => {
      recordWrite(target);
      return Reflect.apply(member, receiver, callArguments);
    };
  }
  return isDeep && isPlainData(member) && !isRefObject(member) && !Object.isFrozen(target)
    ? trackWrites(member, true)
    : member;
};

const trackWrites = (target: object, isDeep: boolean): object => {
  const existing = writeTrackers.get(target);
  if (existing) return existing;
  const tracker = new Proxy(target, {
    get: (innerTarget, key, receiver) => getTrackedMember(innerTarget, key, receiver, isDeep),
    set: (innerTarget, key, value) => {
      recordWrite(innerTarget);
      return Reflect.set(innerTarget, key, value);
    },
    deleteProperty: (innerTarget, key) => {
      recordWrite(innerTarget);
      return Reflect.deleteProperty(innerTarget, key);
    },
    defineProperty: (innerTarget, key, descriptor) => {
      if (!isFreezing(innerTarget, key, descriptor)) recordWrite(innerTarget);
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
    isTrueSide: mode === "nullish" ? value !== null && value !== undefined : Boolean(value),
  });
  return value;
};

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    latestRoot = root;
    const fiber = findMountedFiber();
    if (fiber && fiber !== lastCommittedFiber && didFiberRender(fiber)) renderCount++;
    lastCommittedFiber = fiber;
    if (fiber && firstCommitShapes === null && !hasTooManyFibers(fiber))
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
  if (!isPlainData(value) || isRefObject(value)) return value;
  forEachPlainObject(value, (object) => propOwners.set(object, getPropOwner(name)));
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
    case "Date":
      return new Date(sample.value);
    case "Set":
      return new Set(sample.items.map(hydrate));
    case "Map":
      return new Map(sample.entries.map(([key, value]) => [hydrate(key), hydrate(value)]));
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

const toPlainData = (value: unknown): unknown => {
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
    if (current === STAND_IN) return TRUNCATED_VALUE;
    if (typeof current === "function") return "[function]";
    if (depth >= MAX_PLAIN_DEPTH || typeof current !== "object") return "[value]";
    if (current instanceof Node) return "[node]";
    if (!isPlainRecord(current)) return TRUNCATED_VALUE;
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

const findMountedFiber = (): Fiber | null => {
  let fiber = traverseFiber(
    latestRoot?.current ?? null,
    (candidate) => candidate.elementType === mountedType || candidate.type === mountedType,
  );
  while (fiber?.child && fiber.child.elementType === Reflect.get(Object(fiber.type), "type"))
    fiber = fiber.child;
  return fiber;
};

const hasTooManyFibers = (fiber: Fiber): boolean => {
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

const getQueuedHooks = (fiber: Fiber): MemoizedState[] => {
  const hooks: MemoizedState[] = [];
  for (
    let hook = fiber.memoizedState;
    hook && typeof hook === "object" && "next" in hook;
    hook = hook.next
  ) {
    if (hook.queue) hooks.push(hook);
  }
  return hooks;
};

const getQueuedHookStates = (fiber: Fiber): unknown[] =>
  getQueuedHooks(fiber).map((hook) => hook.memoizedState);

const isLibraryHook = (hook: MemoizedState): boolean =>
  typeof hook.queue === "object" &&
  hook.queue !== null &&
  isLibraryHookDispatch(Reflect.get(hook.queue, "dispatch"));

const getStateOwners = (states: unknown[]): Map<object, string> => {
  const owners = new Map<object, string>();
  states.forEach((state, hookIndex) =>
    forEachPlainObject(state, (object) => {
      if (!owners.has(object)) owners.set(object, getStateOwner(hookIndex));
    }),
  );
  return owners;
};

const trackStates = (fiber: Fiber): Map<object, string> => {
  const hooks = getQueuedHooks(fiber);
  hooks.forEach((hook, hookIndex) => {
    const state = hook.memoizedState;
    if (!isPlainData(state) || isLibraryHook(hook)) return;
    if (trackedStates.some((tracked) => tracked.target === state)) return;
    trackedStates.push({
      owner: getStateOwner(hookIndex),
      target: state,
      snapshot: snapshotValue(state),
    });
  });
  const currentOwners = getStateOwners(hooks.map((hook) => hook.memoizedState));
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

const getPlainHookStates = (fiber: Fiber): unknown[] =>
  getQueuedHookStates(fiber).map((state) => toPlainData(state));

const takeProbeHits = (): ProbeHit[] => {
  const hits = probeHits;
  probeHits = [];
  return hits;
};

const trackRequest = <Result>(request: Promise<Result>): Promise<Result> => {
  pendingRequests++;
  return request.finally(() => pendingRequests--);
};
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
XMLHttpRequest.prototype.send = function send(...sendArguments) {
  pendingRequests++;
  this.addEventListener("loadend", () => pendingRequests--, { once: true });
  originalSend.apply(this, sendArguments);
};

const waitForSettleInterval = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const recordError = (error: unknown, errorInfo?: ErrorInfo): RecordedError => {
  const componentStack = errorInfo?.componentStack;
  return {
    message: getErrorMessage(error),
    depth: componentStack ? Number(DEPTH_MARKER_PATTERN.exec(componentStack)?.[1] ?? 0) : null,
  };
};

const recordCaughtError = (error: unknown, errorInfo?: ErrorInfo): void => {
  caughtError ??= recordError(error, errorInfo);
};

window.addEventListener("error", (event) => recordCaughtError(event.error));

const settle = async (): Promise<void> => {
  const deadline = performance.now() + MAX_SETTLE_MS;
  do await waitForSettleInterval();
  while (
    (pendingRequests > 0 ||
      (mountedType !== null && !findMountedFiber() && !renderError && !caughtError)) &&
    performance.now() < deadline
  );
};

const getRecordedError = (): RecordedError | null => renderError ?? caughtError;

const createEmptyCapture = (
  error: string,
  errorDepth: number | null = null,
  failure: MountFailure | null = null,
): Capture => ({
  shapes: [],
  hookStates: [],
  probes: takeProbeHits(),
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error,
  errorDepth,
  failure,
});

const captureMountedComponent = (): Capture => {
  const fiber = findMountedFiber();
  if (!fiber) {
    const error = getRecordedError();
    return error
      ? createEmptyCapture(error.message, error.depth)
      : createEmptyCapture("component did not render", null, "did-not-render");
  }
  if (hasTooManyFibers(fiber))
    return createEmptyCapture(
      `component rendered more than ${MAX_CAPTURED_FIBERS} fibers`,
      null,
      "too-large",
    );
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    hookStates: getPlainHookStates(fiber),
    probes: takeProbeHits(),
    ...takeMutations(fiber),
    firstCommitShapes: null,
    error: renderError?.message ?? null,
    errorDepth: renderError?.depth ?? null,
    failure: null,
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
    .slice(0, MAX_ACTION_LABEL_LENGTH);

const isMountedType = (type: unknown): boolean =>
  type !== null &&
  (type === mountedType ||
    type === Reflect.get(Object(mountedType), "type") ||
    type === Reflect.get(Object(mountedType), "render"));

const isRenderedByChild = (fiber: Fiber): boolean => {
  const owner: unknown = Reflect.get(fiber, "_debugOwner");
  const ownerType: unknown = owner && typeof owner === "object" ? Reflect.get(owner, "type") : null;
  return ownerType !== null && ownerType !== undefined && !isMountedType(ownerType);
};

interface ActionCandidate extends Pick<MountedAction, "kind" | "value"> {}

const getActionCandidates = (props: Record<string, unknown>, tag: string): ActionCandidate[] => {
  const candidates: ActionCandidate[] = [];
  if (typeof props.onClick === "function" && props.disabled !== true)
    candidates.push({ kind: "click", value: "" });
  const isEditable =
    INPUT_TAGS.has(tag) &&
    props.type !== "file" &&
    (typeof props.onChange === "function" || typeof props.onInput === "function");
  if (isEditable) for (const value of CHANGE_VALUES) candidates.push({ kind: "change", value });
  return candidates;
};

const getActionBaseKey = (candidate: ActionCandidate, tag: string, label: string): string => {
  const valueSuffix = candidate.kind === "change" ? `=${candidate.value}` : "";
  return `${candidate.kind}:${tag}:${label}${valueSuffix}`;
};

const collectActions = (): MountedAction[] => {
  const mountedFiber = findMountedFiber();
  const actions: MountedAction[] = [];
  const countsByBaseKey = new Map<string, number>();
  const visit = (fiber: Fiber, clickAncestors: ActionTarget[]): void => {
    let childClickAncestors = clickAncestors;
    if (isHostFiber(fiber) && fiber.stateNode instanceof HTMLElement) {
      const props: Record<string, unknown> = fiber.memoizedProps ?? {};
      const tag = String(fiber.type);
      const label = getLabel(fiber.stateNode);
      for (const candidate of getActionCandidates(props, tag)) {
        const baseKey = getActionBaseKey(candidate, tag, label);
        const duplicateCount = countsByBaseKey.get(baseKey) ?? 0;
        countsByBaseKey.set(baseKey, duplicateCount + 1);
        actions.push({
          ...candidate,
          key: duplicateCount === 0 ? baseKey : `${baseKey}#${duplicateCount}`,
          tag,
          label,
          isInChild: isRenderedByChild(fiber),
          clickAncestors,
          element: fiber.stateNode,
        });
      }
      if (typeof props.onClick === "function")
        childClickAncestors = [...clickAncestors, { tag, label }];
    }
    for (const child of getChildren(fiber)) visit(child, childClickAncestors);
  };
  if (mountedFiber) for (const child of getChildren(mountedFiber)) visit(child, []);
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

const getComponentType = (value: unknown): unknown => {
  if (!isComponentType(value)) return Reflect.get(Object(value), "Root");
  const provider = Reflect.get(Object(value), "Provider");
  return "Consumer" in Object(value) && isComponentType(provider) ? provider : value;
};

const findPartName = (exportNames: string[], exportName: string): string | undefined =>
  exportNames
    .filter((name) => exportName.endsWith(name))
    .sort((left, right) => right.length - left.length)[0] ??
  exportNames
    .filter((name) => name.endsWith(exportName))
    .sort((left, right) => left.length - right.length)[0];

const loadWrapper = async ({ candidate }: Wrapper): Promise<LoadedWrapper | null> => {
  const isPackage = candidate.kind === "package";
  const query = new URLSearchParams(
    isPackage
      ? { specifier: candidate.specifier, importer: candidate.importer }
      : { specifier: candidate.file, importer: candidate.file },
  );
  const imported: Record<string, unknown> | null = await import(
    /* @vite-ignore */ `${WRAPPER_PATH}?${query}`
  ).catch(() => null);
  if (!imported) return null;
  const moduleExports: Record<string, unknown> =
    isPackage && candidate.namespace ? Object(imported[candidate.namespace]) : imported;
  const exportNames = Object.keys(moduleExports).filter((name) => /^[A-Z]/.test(name));
  const partName = isPackage ? findPartName(exportNames, candidate.exportName) : undefined;
  const value =
    moduleExports[candidate.exportName] ??
    (partName ? moduleExports[partName] : undefined) ??
    (isPackage ? moduleExports.Root : undefined);
  const componentType = getComponentType(value);
  if (!isComponentType(componentType)) return null;
  return {
    type: componentType,
    props: Object.fromEntries(
      Object.entries(candidate.props).map(([name, sample]) => [name, hydrate(sample)]),
    ),
  };
};

const isAsyncFunction = (
  value: unknown,
): value is (props: Record<string, unknown>) => Promise<unknown> =>
  typeof value === "function" && value.constructor.name === "AsyncFunction";

const NESTED_ROUTER_PATTERN = /cannot render a <Router> inside another <Router>/;

const ASYNC_CLIENT_COMPONENT_PATTERN =
  /async\/await is not yet supported in Client Components|is an async Client Component/;

const isFunctionComponent = (value: unknown): value is FunctionComponent =>
  typeof value === "function" && !Reflect.get(Object(value.prototype), "isReactComponent");

const createResolvedComponent = (type: unknown, output: unknown): (() => ReactNode) => {
  const resolved = (): ReactNode => output as ReactNode;
  Object.defineProperty(resolved, "name", { value: Reflect.get(Object(type), "name") });
  const displayName: unknown = Reflect.get(Object(type), "displayName");
  if (displayName) Object.assign(resolved, { displayName });
  return resolved;
};

const callServerComponent = async (
  type: FunctionComponent,
  props: Record<string, unknown>,
): Promise<ServerRender | null> => {
  try {
    return { output: await type(props) };
  } catch {
    return null;
  }
};

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

const getDepthMarker = (depth: number): ComponentType<ChildrenProps> => {
  const cached = depthMarkers.get(depth);
  if (cached) return cached;
  const marker = ({ children }: ChildrenProps): ReactNode => children;
  Object.defineProperty(marker, "name", { value: `${DEPTH_MARKER_PREFIX}${depth}` });
  depthMarkers.set(depth, marker);
  return marker;
};

const resetRenderState = (): void => {
  renderError = null;
  caughtError = null;
  lastCommittedFiber = null;
  firstCommitShapes = null;
};

const resetMountState = (): void => {
  resetRenderState();
  probeHits = [];
  pendingMutationHits = [];
  trackedStates = [];
  stateOwners = new WeakMap();
  propWrites = new Set();
};

const runScenario = async (scenario: NonNullable<MountRequest["scenario"]>): Promise<boolean> => {
  const setupModule: SetupModule = await import(/* @vite-ignore */ SETUP_PATH);
  const runner = setupModule.scenarios?.[scenario.name];
  if (!runner) return false;
  await runner(...scenario.args);
  return true;
};

const importComponentModule = async (
  componentModule: MountRequest["module"],
): Promise<Record<string, unknown>> => {
  for (const url of componentModule.importerUrls)
    await import(/* @vite-ignore */ new URL(url, location.origin).href).catch(() => undefined);
  return import(/* @vite-ignore */ new URL(componentModule.url, location.origin).href);
};

const createMountElement = (type: unknown, mounted: MountedComponent): ReactElement => {
  let element = createElement(type as Parameters<typeof createElement>[0], mounted.props);
  for (let depth = mounted.wrappers.length; depth > 0; depth--) {
    const wrapper = mounted.wrappers[depth - 1];
    if (wrapper)
      element = createElement(
        wrapper.type as ComponentType<Record<string, unknown>>,
        { ...wrapper.props, ...OPEN_PARENT_PROPS },
        createElement(getDepthMarker(depth), null, element),
      );
  }
  return element;
};

const renderMounted = async (
  type: unknown,
  mounted: MountedComponent,
  isRouterless = false,
): Promise<void> => {
  mountedRoot?.unmount();
  resetRenderState();
  mountedType = type;
  watchHookCallers(
    [...getRDTHook().renderers.values()].flatMap((renderer) => renderer.currentDispatcherRef ?? []),
  );
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  mountedRoot = createRoot(container, { onCaughtError: recordCaughtError });
  const element = createMountElement(type, mounted);
  mountedRoot.render(
    createElement(Boundary, null, createElement(mounted.Providers, { isRouterless }, element)),
  );
  await settle();
};

const renderClientComponent = async (
  componentType: unknown,
  mounted: MountedComponent,
): Promise<void> => {
  await renderMounted(componentType, mounted);
  const error = getRecordedError();
  const isAsyncClientComponent =
    error !== null &&
    ASYNC_CLIENT_COMPONENT_PATTERN.test(error.message) &&
    isFunctionComponent(componentType);
  const serverRendered = isAsyncClientComponent
    ? await callServerComponent(componentType, mounted.props)
    : null;
  if (serverRendered) {
    const output = await resolveServerTree(serverRendered.output, true);
    await renderMounted(() => output, mounted);
  }
  if (error && NESTED_ROUTER_PATTERN.test(error.message))
    await renderMounted(componentType, mounted, true);
};

const mount = async (request: MountRequest): Promise<Capture> => {
  mountedRoot?.unmount();
  mountedType = null;
  await settle();
  resetMountState();
  const providersModule: ProvidersModule = await import(/* @vite-ignore */ PROVIDERS_PATH);
  if (request.scenario && !(await runScenario(request.scenario)))
    return createEmptyCapture(`setup has no scenario ${request.scenario.name}`);
  const moduleExports = await importComponentModule(request.module);
  const componentType = moduleExports[request.exportName];
  if (!componentType) return createEmptyCapture(`export ${request.exportName} not found`);
  const mounted: MountedComponent = {
    props: Object.fromEntries(
      Object.entries(request.props).map(([name, sample]) => [name, hydrateProp(name, sample)]),
    ),
    wrappers: await Promise.all(request.wrappers.map(loadWrapper)),
    Providers: providersModule.default,
  };
  try {
    if (isAsyncFunction(componentType)) {
      const output = await resolveServerTree(await componentType(mounted.props));
      await renderMounted(() => output, mounted);
    } else {
      await renderClientComponent(componentType, mounted);
    }
  } catch (error) {
    return createEmptyCapture(recordError(error).message);
  }
  return { ...captureMountedComponent(), firstCommitShapes };
};

const performAction = async (key: string): Promise<Capture | null> => {
  const action = collectActions().find((candidate) => candidate.key === key);
  if (!action) return null;
  if (action.kind === "click") action.element.click();
  else setInputValue(action.element, action.value);
  await settle();
  return captureMountedComponent();
};

const preventNavigation = (event: Event): void => {
  const target = event.target;
  if (event.type === "submit" || (target instanceof Element && target.closest("a[href]")))
    event.preventDefault();
};

document.addEventListener("click", preventNavigation, true);
document.addEventListener("submit", preventNavigation, true);
navigation.addEventListener("navigate", (event) => {
  if (event.cancelable && !event.hashChange) event.preventDefault();
});
history.back = () => {};
history.go = () => {};

window.__verify = {
  mount,
  actions: () => collectActions().map(({ element: _element, value: _value, ...action }) => action),
  perform: performAction,
  observe: async () => {
    await settle();
    return captureMountedComponent();
  },
  canLoad: async (wrapper) => (await loadWrapper(wrapper)) !== null,
};
