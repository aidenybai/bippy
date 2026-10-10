import {
  didFiberRender,
  getDisplayName,
  getReactWorkTagsForFiber,
  instrument,
  isCompositeFiber,
  isHostFiber,
} from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { Component, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Sample } from "../../src/core/inference/types.js";
import { forEachPlainObject, isPlainData, snapshotValue } from "./snapshot.js";
import type { Action, Capture, MountRequest, MutationHit, ProbeHit, Shape } from "./types.js";

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

interface TrackedState {
  owner: string;
  target: object;
  snapshot: string;
}

const ANONYMOUS_NAME = "Anonymous";
const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
const SETTLE_MS = 40;
const MAX_PLAIN_DEPTH = 4;
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
let renderError: string | null = null;
let renderCount = 0;
let lastCommittedFiber: Fiber | null = null;
let firstCommitShapes: Shape[] | null = null;
let pendingMutationHits: PendingMutationHit[] = [];
let trackedStates: TrackedState[] = [];
let stateOwners = new WeakMap<object, string>();
let propWrites = new Set<string>();
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
    if (fiber && firstCommitShapes === null)
      firstCommitShapes = getChildren(fiber).flatMap(toShapes);
    if (fiber) trackStates(fiber);
  },
});

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError = (): BoundaryState => ({ hasError: true });

  componentDidCatch = (error: unknown): void => {
    renderError = error instanceof Error ? error.message : String(error);
  };

  render = (): ReactNode => (this.state.hasError ? null : this.props.children);
}

const hydrateProp = (name: string, sample: Sample): unknown => {
  const value = hydrate(sample);
  if (!isPlainData(value)) return value;
  forEachPlainObject(value, (object) => propOwners.set(object, `prop:${name}`));
  return trackWrites(value, true);
};

const hydrate = (sample: Sample): unknown => {
  switch (sample.kind) {
    case "Value":
      return sample.value;
    case "Undefined":
      return undefined;
    case "Function":
      return () => undefined;
    case "Array":
      return sample.items.map(hydrate);
    case "Object":
      return Object.fromEntries(
        Object.entries(sample.fields).map(([name, field]) => [name, hydrate(field)]),
      );
  }
};

const toPlain = (value: unknown, depth = 0): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (value === undefined) return undefined;
  if (typeof value === "function") return "[function]";
  if (depth >= MAX_PLAIN_DEPTH || typeof value !== "object") return "[value]";
  if (value instanceof Node) return "[node]";
  if (Array.isArray(value)) return value.map((item) => toPlain(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toPlain(item, depth + 1)]),
  );
};

const getChildren = (fiber: Fiber): Fiber[] => {
  const children: Fiber[] = [];
  for (let child = fiber.child; child; child = child.sibling) children.push(child);
  return children;
};

const findFiber = (fiber: Fiber | null, predicate: (candidate: Fiber) => boolean): Fiber | null => {
  if (!fiber) return null;
  if (predicate(fiber)) return fiber;
  for (const child of getChildren(fiber)) {
    const found = findFiber(child, predicate);
    if (found) return found;
  }
  return null;
};

const findMountedFiber = (): Fiber | null =>
  findFiber(
    latestRoot?.current ?? null,
    (fiber) => fiber.elementType === mountedType || fiber.type === mountedType,
  );

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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const createEmptyCapture = (error: string): Capture => ({
  shapes: [],
  hookStates: [],
  probes: takeProbeHits(),
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error,
});

const capture = (): Capture => {
  const fiber = findMountedFiber();
  if (!fiber) return createEmptyCapture(renderError ?? "component did not render");
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    hookStates: readHookStates(fiber),
    probes: takeProbeHits(),
    ...takeMutations(fiber),
    firstCommitShapes: null,
    error: renderError,
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

const collectActions = (): MountedAction[] => {
  const fiber = findMountedFiber();
  const actions: MountedAction[] = [];
  const keyCounts = new Map<string, number>();
  const visit = (current: Fiber): void => {
    if (isHostFiber(current) && current.stateNode instanceof HTMLElement) {
      const props: Record<string, unknown> = current.memoizedProps ?? {};
      const tag = String(current.type);
      const label = getLabel(current.stateNode);
      const candidates: Array<Pick<MountedAction, "kind" | "value">> = [];
      if (typeof props.onClick === "function" && props.disabled !== true)
        candidates.push({ kind: "click", value: "" });
      if (
        INPUT_TAGS.has(tag) &&
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
          element: current.stateNode,
        });
      }
    }
    for (const child of getChildren(current)) visit(child);
  };
  if (fiber) for (const child of getChildren(fiber)) visit(child);
  return actions;
};

const setInputValue = (element: HTMLElement, value: string): void => {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const mount = async (request: MountRequest): Promise<Capture> => {
  mountedRoot?.unmount();
  await settle();
  probeHits = [];
  renderError = null;
  lastCommittedFiber = null;
  firstCommitShapes = null;
  pendingMutationHits = [];
  trackedStates = [];
  stateOwners = new WeakMap();
  propWrites = new Set();
  const moduleExports: Record<string, unknown> = await import(/* @vite-ignore */ request.moduleUrl);
  mountedType = moduleExports[request.exportName];
  if (!mountedType) return createEmptyCapture(`export ${request.exportName} not found`);
  const props = Object.fromEntries(
    Object.entries(request.props).map(([name, sample]) => [name, hydrateProp(name, sample)]),
  );
  const { default: Providers }: { default: (props: { children: ReactNode }) => ReactNode } =
    await import(/* @vite-ignore */ PROVIDERS_PATH);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  mountedRoot = createRoot(container);
  // HACK: the component type comes from a dynamic import, so React's element typing can't see it.
  mountedRoot.render(
    createElement(
      Boundary,
      null,
      createElement(
        Providers,
        null,
        createElement(mountedType as Parameters<typeof createElement>[0], props),
      ),
    ),
  );
  await settle();
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

window.__verify = {
  mount,
  actions: () => collectActions().map(({ key, tag, label, kind }) => ({ key, tag, label, kind })),
  perform,
};
