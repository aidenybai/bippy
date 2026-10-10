import { getDisplayName, instrument, isCompositeFiber, isHostFiber } from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { Component, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Sample } from "../../src/core/inference/types.js";
import type { Action, Capture, MountRequest, ProbeHit, Shape } from "./types.js";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: string | null;
}

interface MountedAction extends Action {
  element: HTMLElement;
  value: string;
}

const HOST_TEXT_TAG = 6;
const ANONYMOUS_NAME = "Anonymous";
const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
const SETTLE_MS = 40;
const MAX_PLAIN_DEPTH = 4;
const INPUT_TAGS = new Set(["input", "textarea", "select"]);
const CHANGE_VALUES = ["text", ""];

let probeHits: ProbeHit[] = [];
let latestRoot: FiberRoot | null = null;
let mountedType: unknown = null;
let mountedRoot: Root | null = null;
let renderError: string | null = null;
let mountedActions = new Map<string, MountedAction>();

globalThis.__bippyProbe = (id, mode, value) => {
  probeHits.push({
    id,
    outcome: mode === "nullish" ? value !== null && value !== undefined : Boolean(value),
  });
  return value;
};

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    latestRoot = root;
  },
});

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError = (error: unknown): BoundaryState => ({
    error: error instanceof Error ? error.message : String(error),
  });

  componentDidCatch = (error: unknown): void => {
    renderError = error instanceof Error ? error.message : String(error);
  };

  render = (): ReactNode => (this.state.error ? null : this.props.children);
}

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
  if (value === undefined) return null;
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
  if (fiber.tag === HOST_TEXT_TAG) return [{ kind: "text", text: String(fiber.memoizedProps) }];
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

const readHookStates = (fiber: Fiber): unknown[] => {
  const values: unknown[] = [];
  for (
    let hook = fiber.memoizedState;
    hook && typeof hook === "object" && "next" in hook;
    hook = hook.next
  ) {
    if (hook.queue) values.push(toPlain(hook.memoizedState));
  }
  return values;
};

const takeProbeHits = (): ProbeHit[] => {
  const hits = probeHits;
  probeHits = [];
  return hits;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const capture = (): Capture => {
  const fiber = findMountedFiber();
  if (!fiber)
    return {
      shapes: [],
      hookStates: [],
      probes: takeProbeHits(),
      error: renderError ?? "component did not render",
    };
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    hookStates: readHookStates(fiber),
    probes: takeProbeHits(),
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
      if (typeof props.onClick === "function") candidates.push({ kind: "click", value: "" });
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
  mountedActions = new Map(actions.map((action) => [action.key, action]));
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
  const moduleExports: Record<string, unknown> = await import(/* @vite-ignore */ request.moduleUrl);
  mountedType = moduleExports[request.exportName];
  if (!mountedType)
    return {
      shapes: [],
      hookStates: [],
      probes: [],
      error: `export ${request.exportName} not found`,
    };
  const props = Object.fromEntries(
    Object.entries(request.props).map(([name, sample]) => [name, hydrate(sample)]),
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
  return capture();
};

const perform = async (key: string): Promise<Capture> => {
  const action = mountedActions.get(key);
  if (!action) return { ...capture(), error: `action ${key} not found` };
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
