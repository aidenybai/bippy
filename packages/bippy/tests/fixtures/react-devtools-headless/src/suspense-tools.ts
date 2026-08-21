import type { Fiber, FiberRoot, ReactIOInfo } from "bippy";
import { getFiberChildren } from "./fiber-traversal.js";
import { getFiberDisplayName, getFiberTypeName } from "./fiber-metadata.js";
import { getFiberSuspenseInfo } from "./fiber-suspense.js";
import type { FiberSuspenseInfo } from "./fiber-suspense.js";
import type {
  ActionResult,
  SuspenseDetails,
  SuspenseTimelineStep,
  SuspenseTools,
  SuspenseTreeNode,
  ToolError,
} from "./types.js";
import { normalizeValue } from "./value-serialization.js";

interface SuspenseCollection {
  ancestorIO: Set<ReactIOInfo>;
  effectiveEndTime: number;
  index: number;
}

const getResolvedThenableValue = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  const status = Reflect.get(value, "status");
  if (status === "fulfilled") return Reflect.get(value, "value");
  if (status === "rejected") return Reflect.get(value, "reason");
  return undefined;
};

const getSuspenseInfoDetails = (
  suspense: FiberSuspenseInfo,
  getUid: (fiber: Fiber) => string,
): SuspenseDetails => ({
  environments: suspense.environments,
  isSuspended: suspense.isSuspended,
  range: suspense.range,
  rects: suspense.rects,
  suspendedBy: suspense.suspendedBy.map(({ fiber: sourceFiber, ioInfo }) => ({
    byteSize: ioInfo.byteSize ?? null,
    description: normalizeValue(getResolvedThenableValue(ioInfo.value)),
    end: ioInfo.end,
    environment: ioInfo.env ?? null,
    name: ioInfo.name,
    sourceUid: getUid(sourceFiber),
    start: ioInfo.start,
  })),
  unknownSuspenders: suspense.unknownSuspenders,
});

export const getSuspenseDetails = (
  fiber: Fiber,
  getUid: (fiber: Fiber) => string,
): SuspenseDetails | null => {
  const suspense = getFiberSuspenseInfo(fiber);
  return suspense ? getSuspenseInfoDetails(suspense, getUid) : null;
};

const collectSuspenseTree = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  getUid: (fiber: Fiber) => string,
): { nodes: SuspenseTreeNode[]; timeline: SuspenseTimelineStep[] } => {
  const nodes: SuspenseTreeNode[] = [];
  const timeline: SuspenseTimelineStep[] = [];

  const visitFiber = (fiber: Fiber, parentCollection: SuspenseCollection | null): void => {
    let nextParentCollection = parentCollection;
    if (getFiberTypeName(fiber) === "suspense") {
      const suspenseInfo = getFiberSuspenseInfo(fiber);
      if (suspenseInfo) {
        const details = getSuspenseInfoDetails(suspenseInfo, getUid);
        const uid = getUid(fiber);
        const ioInfo = new Set(suspenseInfo.suspendedBy.map((suspender) => suspender.ioInfo));
        const hasUniqueSuspenders =
          suspenseInfo.unknownSuspenders ||
          Array.from(ioInfo).some((suspenderIO) => !parentCollection?.ancestorIO.has(suspenderIO));
        const parentUid =
          parentCollection === null ? null : (nodes[parentCollection.index]?.uid ?? null);
        const explicitName =
          typeof fiber.memoizedProps === "object" && fiber.memoizedProps !== null
            ? Reflect.get(fiber.memoizedProps, "name")
            : null;
        const node: SuspenseTreeNode = {
          children: [],
          details,
          hasUniqueSuspenders,
          name:
            typeof explicitName === "string" && explicitName
              ? explicitName
              : (getFiberDisplayName(fiber) ?? "Suspense"),
          parentUid,
          uid,
        };
        const nodeIndex = nodes.push(node) - 1;
        if (parentCollection) nodes[parentCollection.index]?.children.push(uid);
        const ownEndTime = suspenseInfo.suspendedBy.reduce(
          (maximumEndTime, { ioInfo }) =>
            Math.max(maximumEndTime, ioInfo.end + (ioInfo.env ? 1_000_000 : 0)),
          0,
        );
        const effectiveEndTime = Math.max(parentCollection?.effectiveEndTime ?? 0, ownEndTime);
        const ancestorIO = new Set(parentCollection?.ancestorIO ?? []);
        for (const suspenderIO of ioInfo) ancestorIO.add(suspenderIO);
        nextParentCollection = { ancestorIO, effectiveEndTime, index: nodeIndex };
        if (hasUniqueSuspenders) {
          timeline.push({
            endTime: effectiveEndTime,
            environment: details.environments.at(-1) ?? null,
            uid,
          });
        }
      }
    }

    for (const child of getFiberChildren(fiber)) {
      visitFiber(child, nextParentCollection);
    }
  };

  for (const roots of fiberRoots.values()) {
    for (const root of roots) visitFiber(root.current, null);
  }
  timeline.sort((leftStep, rightStep) => leftStep.endTime - rightStep.endTime);
  return { nodes, timeline };
};

export const createSuspenseTools = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  getFiberByUid: (uid: string) => Fiber | null,
  getUid: (fiber: Fiber) => string,
  setFiberSuspense: (fiber: Fiber, shouldSuspend: boolean) => boolean,
): SuspenseTools => {
  const forcedUids = new Set<string>();

  const getSuspenseTree = (): SuspenseTreeNode[] => collectSuspenseTree(fiberRoots, getUid).nodes;

  const getSuspenseTimeline = (): SuspenseTimelineStep[] =>
    collectSuspenseTree(fiberRoots, getUid).timeline;

  const setSuspenseMilestone = (suspendedUids: string[]): ActionResult | ToolError => {
    const nextUids = new Set(suspendedUids);
    const fibers = new Map<string, Fiber>();
    for (const uid of nextUids) {
      const fiber = getFiberByUid(uid);
      if (!fiber || getFiberTypeName(fiber) !== "suspense") {
        return { error: `Suspense boundary not found: "${uid}"` };
      }
      fibers.set(uid, fiber);
    }
    for (const uid of forcedUids) {
      if (nextUids.has(uid)) continue;
      const fiber = getFiberByUid(uid);
      if (fiber) fibers.set(uid, fiber);
      else forcedUids.delete(uid);
    }
    for (const [uid, fiber] of fibers) {
      const shouldSuspend = nextUids.has(uid);
      if (forcedUids.has(uid) === shouldSuspend) continue;
      if (!setFiberSuspense(fiber, shouldSuspend)) {
        return { error: "Renderer does not support Suspense overrides" };
      }
      if (shouldSuspend) forcedUids.add(uid);
      else forcedUids.delete(uid);
    }
    return { success: true };
  };

  return { getSuspenseTimeline, getSuspenseTree, setSuspenseMilestone };
};
