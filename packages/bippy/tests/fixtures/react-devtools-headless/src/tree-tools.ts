import { getFiber, getFiberById, getFiberId, getLatestFiber, traverseFiber } from "bippy";
import type { Fiber, FiberRoot, ReactDevToolsTarget } from "bippy";
import {
  getFallbackParentStack,
  getRawSource,
  getFiberHooks,
  getRawOwnerStack,
} from "bippy/source";
import type {
  ComponentBranchEntry,
  ComponentSource,
  FindComponentsResult,
  NodeInfo,
  OwnersStack,
  ToolError,
  TreeNode,
  TreeTools,
} from "./types.js";
import { getFiberDisplayName, getFiberTypeName } from "./fiber-metadata.js";
import { getFiberAncestors, getFiberChildren, getFiberOwners } from "./fiber-traversal.js";
import { getSuspenseDetails } from "./suspense-tools.js";
import {
  normalizeHooks,
  normalizeProps,
  normalizeValue,
  safeReadProperty,
} from "./value-serialization.js";

interface FiberLookupResult {
  error: string | null;
  fiber: Fiber | null;
}

interface FiberMatch {
  fiber: Fiber;
}

const getUid = (fiber: Fiber): string => `r${getFiberId(fiber)}`;

const getTreeNode = (
  fiber: Fiber,
  firstChild: Fiber | null,
  nextSibling: Fiber | null,
): TreeNode => ({
  firstChild: firstChild ? getUid(firstChild) : null,
  key: fiber.key === null || fiber.key === undefined ? null : String(fiber.key),
  name: getFiberDisplayName(fiber) ?? "Unknown",
  nextSibling: nextSibling ? getUid(nextSibling) : null,
  type: getFiberTypeName(fiber),
  uid: getUid(fiber),
});

const collectNodes = (
  fiber: Fiber,
  maxDepth: number,
  currentDepth: number,
  nodes: TreeNode[],
  nextSibling: Fiber | null = null,
): void => {
  const children = currentDepth < maxDepth ? getFiberChildren(fiber) : [];
  nodes.push(getTreeNode(fiber, children[0] ?? null, nextSibling));
  for (let childIndex = 0; childIndex < children.length; childIndex++) {
    collectNodes(
      children[childIndex],
      maxDepth,
      currentDepth + 1,
      nodes,
      children[childIndex + 1] ?? null,
    );
  }
};

const findByUid = (fiber: Fiber, targetUid: string): Fiber | null =>
  traverseFiber(fiber, (candidateFiber) => getUid(candidateFiber) === targetUid);

const findFiberByUid = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  uid: string,
): FiberLookupResult => {
  const fiberId = /^r(\d+)$/.exec(uid)?.[1];
  const knownFiber = fiberId === undefined ? null : getFiberById(Number(fiberId));
  if (knownFiber) {
    const mountedFiber = isFiberMountedInRoots(fiberRoots, knownFiber);
    if (mountedFiber) return { error: null, fiber: mountedFiber };
  }
  for (const roots of fiberRoots.values()) {
    for (const root of roots) {
      const fiber = findByUid(root.current, uid);
      if (fiber) return { error: null, fiber };
    }
  }
  return { error: `Component not found: "${uid}"`, fiber: null };
};

const isFiberMountedInRoots = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  targetFiber: Fiber,
): Fiber | null => {
  for (const roots of fiberRoots.values()) {
    for (const root of roots) {
      const fiber = traverseFiber(
        root.current,
        (candidateFiber) =>
          candidateFiber === targetFiber || candidateFiber === targetFiber.alternate,
      );
      if (fiber) return fiber;
    }
  }
  return null;
};

const buildNodeInfo = (fiber: Fiber, includeHooks = false): NodeInfo | ToolError => {
  const info: NodeInfo = {
    name: getFiberDisplayName(fiber) ?? "Unknown",
    type: getFiberTypeName(fiber),
    uid: getUid(fiber),
  };
  if (fiber.key !== null && fiber.key !== undefined) info.key = String(fiber.key);
  const props = normalizeProps(fiber.memoizedProps);
  if (props) info.props = props;
  if (
    getFiberTypeName(fiber) === "class" &&
    typeof fiber.stateNode === "object" &&
    fiber.stateNode !== null
  ) {
    const state = safeReadProperty(fiber.stateNode, "state");
    const context = safeReadProperty(fiber.stateNode, "context");
    if (state !== undefined) info.state = normalizeValue(state);
    if (context !== undefined) info.context = normalizeValue(context);
  }
  const suspense = getSuspenseDetails(fiber, getUid);
  if (suspense) info.suspense = suspense;

  if (includeHooks) {
    const typeName = getFiberTypeName(fiber);
    if (typeName === "function" || typeName === "forwardRef" || typeName === "memo") {
      try {
        const inspectedHooks = getFiberHooks(fiber);
        const componentHook = inspectedHooks.length === 1 ? inspectedHooks[0] : null;
        const hooks =
          componentHook?.id === null && componentHook.name === getFiberDisplayName(fiber)
            ? componentHook.subHooks
            : inspectedHooks;
        info.hooks = normalizeHooks(hooks);
      } catch (error) {
        const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
        return { error: new Error("Failed to inspect hooks.", { cause }) };
      }
    }
  }

  return info;
};

const collectMatches = (fiber: Fiber, query: string, matches: FiberMatch[]): void => {
  const displayName = getFiberDisplayName(fiber);
  if (displayName?.toLowerCase().includes(query)) matches.push({ fiber });
  for (const child of getFiberChildren(fiber)) collectMatches(child, query, matches);
};

export const createTreeTools = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  target: ReactDevToolsTarget = globalThis,
): TreeTools => {
  const getComponentTree = (depth = 20, rootUid?: string): TreeNode[] | ToolError => {
    const maxDepth = Math.max(0, depth);
    if (rootUid) {
      const result = findFiberByUid(fiberRoots, rootUid);
      if (!result.fiber) return { error: result.error ?? `Component not found: "${rootUid}"` };
      const nodes: TreeNode[] = [];
      collectNodes(result.fiber, maxDepth, 0, nodes);
      return nodes;
    }

    const nodes: TreeNode[] = [];
    for (const roots of fiberRoots.values()) {
      for (const root of roots) collectNodes(root.current, maxDepth, 0, nodes);
    }
    return nodes.length > 0 ? nodes : { error: "No mounted React roots found" };
  };

  const getComponentByUid = (uid: string, includeHooks = false): NodeInfo | ToolError => {
    const result = findFiberByUid(fiberRoots, uid);
    return result.fiber
      ? buildNodeInfo(result.fiber, includeHooks)
      : { error: result.error ?? `Component not found: "${uid}"` };
  };

  const getComponentByHostInstance = (hostInstance: unknown): NodeInfo | ToolError => {
    if (hostInstance === null || hostInstance === undefined) {
      return { error: "Host instance is required" };
    }
    if (fiberRoots.size === 0) return { error: "No mounted React roots found" };
    const targetFiber = getFiber(hostInstance, target);
    if (!targetFiber) return { error: "Host instance is not managed by React" };
    const mountedFiber = isFiberMountedInRoots(fiberRoots, getLatestFiber(targetFiber));
    return mountedFiber
      ? buildNodeInfo(mountedFiber)
      : { error: "Host instance is not managed by React" };
  };

  const findComponents = (
    name: string,
    rootUid?: string,
    page = 1,
    pageSize = 10,
  ): FindComponentsResult | ToolError => {
    const query = name.toLowerCase();
    const matches: FiberMatch[] = [];

    if (rootUid) {
      const result = findFiberByUid(fiberRoots, rootUid);
      if (!result.fiber) return { error: result.error ?? `Component not found: "${rootUid}"` };
      collectMatches(result.fiber, query, matches);
    } else {
      for (const roots of fiberRoots.values()) {
        for (const root of roots) collectMatches(root.current, query, matches);
      }
    }

    const resolvedPageSize = Math.max(1, pageSize);
    const totalCount = matches.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / resolvedPageSize));
    const resolvedPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (resolvedPage - 1) * resolvedPageSize;
    const results = matches
      .slice(startIndex, startIndex + resolvedPageSize)
      .map(({ fiber }) => getTreeNode(fiber, getFiberChildren(fiber)[0] ?? null, null));

    return {
      page: resolvedPage,
      pageSize: resolvedPageSize,
      results,
      totalCount,
      totalPages,
    };
  };

  const getComponentSource = (uid: string): ComponentSource | ToolError => {
    const result = findFiberByUid(fiberRoots, uid);
    if (!result.fiber) return { error: result.error ?? `Component not found: "${uid}"` };
    const fiber = result.fiber;
    const typeName = getFiberTypeName(fiber);
    if (typeName === "host") return { source: null };
    const props = normalizeProps(fiber.memoizedProps);
    if ((!props || Object.keys(props).length === 0) && fiber.memoizedState === null) {
      return { source: null };
    }
    const source = getRawSource(fiber);
    if (!source?.lineNumber || !source.columnNumber) return { source: null };
    return {
      source: {
        column: source.columnNumber,
        fileName: source.fileName,
        line: source.lineNumber,
        name: source.functionName ?? getFiberDisplayName(fiber) ?? "Unknown",
      },
    };
  };

  const getOwnerStackTrace = (uid: string): OwnersStack | ToolError => {
    const result = findFiberByUid(fiberRoots, uid);
    if (!result.fiber) return { error: result.error ?? `Component not found: "${uid}"` };
    const ownerStack = getRawOwnerStack(result.fiber)
      .map(
        (frame) =>
          frame.source ??
          `    at ${frame.functionName ?? "unknown"} (${frame.fileName ?? "unknown"}:${frame.lineNumber ?? 0}:${frame.columnNumber ?? 0})`,
      )
      .join("\n");
    return { stack: ownerStack || getFallbackParentStack(result.fiber) };
  };

  const getParentStack = (uid: string): ComponentBranchEntry[] | ToolError => {
    const result = findFiberByUid(fiberRoots, uid);
    if (!result.fiber) return { error: result.error ?? `Component not found: "${uid}"` };
    const parents: ComponentBranchEntry[] = [];
    for (const parent of getFiberAncestors(result.fiber)) {
      parents.push({
        name: getFiberDisplayName(parent) ?? "Unknown",
        type: getFiberTypeName(parent),
        uid: getUid(parent),
      });
    }
    return parents;
  };

  const getOwnerStack = (uid: string): ComponentBranchEntry[] | ToolError => {
    const result = findFiberByUid(fiberRoots, uid);
    if (!result.fiber) return { error: result.error ?? `Component not found: "${uid}"` };
    const owners: ComponentBranchEntry[] = [];
    for (const owner of getFiberOwners(result.fiber)) {
      owners.push({
        name: getFiberDisplayName(owner) ?? "Unknown",
        type: getFiberTypeName(owner),
        uid: getUid(owner),
      });
    }
    return owners;
  };

  return {
    findComponents,
    getFiberByUid: (uid) => findFiberByUid(fiberRoots, uid).fiber,
    getComponentByHostInstance,
    getComponentByUid,
    getComponentSource,
    getComponentTree,
    getOwnerStack,
    getOwnerStackTrace,
    getParentStack,
    getUid,
  };
};
