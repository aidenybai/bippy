import { getReactWorkTagsForFiber, type Fiber } from "bippy";
import type { TreeNode } from "../diagram/tree-model";
import type { DataflowEdge } from "../diagram/dataflow-model";
import type { FiberTreeNode } from "./inspection-protocol";

export interface FiberDataflow {
  details: TreeNode[];
  edges: DataflowEdge[];
  truncated: boolean;
}

interface FlowScope {
  parent?: FlowScope;
  context?: unknown;
  providerId?: string;
  providerPortId?: string;
  references: Map<object, string>;
}

const getProperty = (value: unknown, name: string): unknown => {
  if ((typeof value !== "object" || value === null) && typeof value !== "function")
    return undefined;
  try {
    return Object.getOwnPropertyDescriptor(value, name)?.value;
  } catch {
    return undefined;
  }
};
const getIsReference = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
const getReferenceSource = (scope: FlowScope | undefined, value: object): string | undefined => {
  for (let current = scope; current; current = current.parent) {
    const source = current.references.get(value);
    if (source) return source;
  }
  return undefined;
};
const getContextProvider = (scope: FlowScope | undefined, context: unknown) => {
  for (let current = scope; current; current = current.parent) {
    if (current.providerId && current.context === context) return current;
  }
  return undefined;
};
const getPropertyNames = (value: unknown) => {
  if (!getIsReference(value)) return [];
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
};

export const getFiberDataflow = (
  nodes: readonly FiberTreeNode[],
  fibers: ReadonlyMap<string, Fiber>,
  limit = 10000,
): FiberDataflow => {
  const details: TreeNode[] = [];
  const edges: DataflowEdge[] = [];
  const scopes = new Map<string, FlowScope>();
  let truncated = false;
  const addDetail = (
    node: FiberTreeNode,
    suffix: string,
    label: string,
    kind: TreeNode["kind"],
    isCallable = false,
  ) => {
    if (details.length >= limit) {
      truncated = true;
      return undefined;
    }
    const id = `${node.id}:${suffix}`;
    details.push({
      id,
      componentId: node.id,
      parentId: node.id,
      ownerId: node.id,
      label,
      kind,
      ...(isCallable ? { isCallable: true } : {}),
    });
    return id;
  };
  const addEdge = (from: string, to: string, kind: DataflowEdge["kind"], label: string) => {
    edges.push({ id: `flow-${edges.length}`, from, to, kind, label });
  };
  for (const node of nodes) {
    const fiber = fibers.get(node.id);
    if (!fiber) continue;
    if (details.length >= limit) {
      truncated = true;
      break;
    }
    const scope: FlowScope = {
      parent: node.parentId ? scopes.get(node.parentId) : undefined,
      references: new Map(),
    };
    scopes.set(node.id, scope);
    if (node.kind === "provider") {
      scope.context = getProperty(fiber.type, "_context") ?? fiber.type;
      scope.providerId = node.id;
    }
    const propertyNames = getPropertyNames(fiber.memoizedProps).filter(
      (name) => name !== "children" && name.length <= 128,
    );
    if (propertyNames.length > 48) truncated = true;
    for (const name of propertyNames.slice(0, 48)) {
      const value = getProperty(fiber.memoizedProps, name);
      if (
        !getIsReference(value) &&
        !node.componentType &&
        !(node.kind === "provider" && name === "value")
      )
        continue;
      const source = getIsReference(value) ? getReferenceSource(scope.parent, value) : undefined;
      const id = addDetail(
        node,
        `prop:${name}`,
        `props.${name}`,
        "value",
        typeof value === "function",
      );
      if (!id) break;
      if (node.kind === "provider" && name === "value") scope.providerPortId = id;
      if (source)
        addEdge(
          source,
          id,
          "data",
          typeof value === "function" ? "same function" : "same reference",
        );
      if (getIsReference(value)) scope.references.set(value, id);
    }
    const dependencies = new Set<unknown>();
    const contexts = new Set<unknown>();
    let dependency: unknown = getProperty(fiber.dependencies, "firstContext");
    while (getIsReference(dependency) && !dependencies.has(dependency) && dependencies.size < 64) {
      dependencies.add(dependency);
      const context = getProperty(dependency, "context");
      if (contexts.has(context)) {
        dependency = getProperty(dependency, "next");
        continue;
      }
      contexts.add(context);
      const provider = getContextProvider(scope.parent, context);
      const providerId = provider?.providerId;
      const id = addDetail(node, `context:${dependencies.size}`, "context", "value");
      if (id) {
        if (providerId) {
          addEdge(provider?.providerPortId ?? providerId, id, "context", "context read");
          node.contextProviderIds = [...new Set([...(node.contextProviderIds ?? []), providerId])];
        }
        const value = getProperty(dependency, "memoizedValue");
        if (getIsReference(value)) scope.references.set(value, id);
      }
      dependency = getProperty(dependency, "next");
    }
    if (dependency) truncated = true;
    const tags = getReactWorkTagsForFiber(fiber);
    if (![tags.FunctionComponent, tags.ForwardRef, tags.SimpleMemoComponent].includes(fiber.tag))
      continue;
    const hooks = new Set<unknown>();
    let hook: unknown = fiber.memoizedState;
    while (getIsReference(hook) && !hooks.has(hook) && hooks.size < 64) {
      hooks.add(hook);
      const queue = getProperty(hook, "queue");
      const dispatch = getProperty(queue, "dispatch");
      const reducer = getProperty(queue, "lastRenderedReducer");
      const getSnapshot = getProperty(queue, "getSnapshot");
      if (typeof dispatch === "function" && typeof reducer === "function") {
        const stateId = addDetail(node, `state:${hooks.size}`, "state / reducer", "hook");
        const dispatchId = addDetail(node, `dispatch:${hooks.size}`, "dispatch", "callback", true);
        if (stateId && dispatchId) {
          addEdge(dispatchId, stateId, "update", "dispatch target");
          scope.references.set(dispatch, dispatchId);
          const value = getProperty(hook, "memoizedState");
          if (getIsReference(value)) scope.references.set(value, stateId);
        }
      } else if (typeof getSnapshot === "function" && getPropertyNames(queue).includes("value")) {
        const snapshotId = addDetail(
          node,
          `snapshot:${hooks.size}`,
          "useSyncExternalStore",
          "hook",
        );
        const readerId = addDetail(node, `reader:${hooks.size}`, "getSnapshot", "store", true);
        if (snapshotId && readerId) {
          addEdge(readerId, snapshotId, "data", "snapshot read");
          scope.references.set(getSnapshot, readerId);
          const effect = getProperty(getProperty(hook, "next"), "memoizedState");
          const dependencies = getProperty(effect, "deps");
          if (
            Array.isArray(dependencies) &&
            dependencies.length === 1 &&
            typeof dependencies[0] === "function"
          ) {
            const subscribeId = addDetail(
              node,
              `subscribe:${hooks.size}`,
              "subscribe",
              "store",
              true,
            );
            if (subscribeId) {
              addEdge(snapshotId, subscribeId, "subscription", "subscription");
              scope.references.set(dependencies[0], subscribeId);
            }
          }
          const value = getProperty(hook, "memoizedState");
          if (getIsReference(value)) scope.references.set(value, snapshotId);
        }
      }
      hook = getProperty(hook, "next");
    }
    if (hook) truncated = true;
  }
  return { details, edges, truncated };
};
