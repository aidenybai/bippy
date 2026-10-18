import { getDisplayName, getFiberId, getReactWorkTagsForFiber, isFiber, type Fiber } from "bippy";
import type { FiberTreeNode } from "./inspection-protocol";
import { maxCapturedFibers } from "./inspection-protocol";
import { getFiberDataflow } from "./fiber-dataflow";

export type { FiberTreeNode } from "./inspection-protocol";

interface FiberVisit {
  fiber: Fiber;
  parentId?: string;
}

const getHasMethod = (value: unknown, name: string) => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  try {
    return typeof Reflect.get(value, name) === "function";
  } catch {
    return false;
  }
};

const getKnownName = (value: unknown) => {
  try {
    return getDisplayName(value);
  } catch {
    return null;
  }
};

const getFiberLabel = (fiber: Fiber) => {
  const tags = getReactWorkTagsForFiber(fiber);
  if (fiber.tag === tags.HostRoot) return "Root";
  if (fiber.tag === tags.HostText) return "#text";
  if (fiber.tag === tags.ContextProvider || fiber.tag === tags.ContextConsumer) {
    let context: unknown = fiber.type;
    if (typeof context === "object" && context !== null && "_context" in context)
      context = context._context;
    return `${getKnownName(context) ?? "Context"}.${fiber.tag === tags.ContextProvider ? "Provider" : "Consumer"}`;
  }
  return (
    getKnownName(fiber.elementType) ??
    getKnownName(fiber.type) ??
    Object.entries(tags)
      .find(([, tag]) => tag === fiber.tag)?.[0]
      .replace(/Component$/, "") ??
    `Fiber ${fiber.tag}`
  );
};

const getFiberTraits = (fiber: Fiber): Pick<FiberTreeNode, "kind" | "componentType"> => {
  const tags = getReactWorkTagsForFiber(fiber);
  if (fiber.tag === tags.ClassComponent)
    return {
      kind:
        getHasMethod(fiber.type, "getDerivedStateFromError") ||
        getHasMethod(fiber.stateNode, "componentDidCatch")
          ? "boundary"
          : "component",
      componentType: "class",
    };
  if (fiber.tag === tags.MemoComponent || fiber.tag === tags.SimpleMemoComponent)
    return { kind: "component", componentType: "memo" };
  if (fiber.tag === tags.ForwardRef) return { kind: "component", componentType: "forward-ref" };
  if (fiber.tag === tags.FunctionComponent) return { kind: "component", componentType: "function" };
  if (
    [tags.HostComponent, tags.HostText, tags.HostHoistable, tags.HostSingleton].includes(fiber.tag)
  )
    return { kind: "host" };
  if (fiber.tag === tags.ContextProvider) return { kind: "provider" };
  if (fiber.tag === tags.SuspenseComponent) return { kind: "suspense" };
  if (fiber.tag === tags.HostPortal) return { kind: "portal" };
  return { kind: "special" };
};

export const getFiberSnapshot = (root: Fiber, limit = maxCapturedFibers) => {
  const nodes: FiberTreeNode[] = [];
  const stack: FiberVisit[] = [{ fiber: root }];
  const visited = new Set<Fiber>();
  const fibers = new Map<string, Fiber>();
  while (stack.length > 0 && nodes.length < limit) {
    const visit = stack.pop();
    if (!visit || visited.has(visit.fiber)) continue;
    const { fiber, parentId } = visit;
    visited.add(fiber);
    const id = `fiber-${getFiberId(fiber)}`;
    fibers.set(id, fiber);
    const ownerId = isFiber(fiber._debugOwner)
      ? `fiber-${getFiberId(fiber._debugOwner)}`
      : undefined;
    nodes.push({
      id,
      parentId,
      ownerId,
      tag: fiber.tag,
      label: getFiberLabel(fiber).slice(0, 256),
      ...getFiberTraits(fiber),
    });
    if (parentId !== undefined && fiber.sibling) stack.push({ fiber: fiber.sibling, parentId });
    if (fiber.child) stack.push({ fiber: fiber.child, parentId: id });
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.ownerId && (!nodeIds.has(node.ownerId) || node.ownerId === node.id))
      delete node.ownerId;
  }
  const flow = getFiberDataflow(nodes, fibers, Math.min(20000, Math.max(0, limit - nodes.length)));
  return {
    nodes,
    details: flow.details,
    edges: flow.edges,
    truncated: stack.length > 0 || flow.truncated,
  };
};
