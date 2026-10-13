import { getLatestFiber, getReactWorkTagsForFiber } from "bippy";
import type { Fiber, ReactDebugInfo, ReactIOInfo } from "bippy";

export interface SuspenseRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface FiberSuspender {
  asyncInfo: ReactDebugInfo;
  fiber: Fiber;
  ioInfo: ReactIOInfo;
}

export interface FiberSuspenseInfo {
  environments: string[];
  isSuspended: boolean;
  range: [number, number] | null;
  rects: SuspenseRect[];
  suspendedBy: FiberSuspender[];
  unknownSuspenders: boolean;
}

const FALLBACK_THROTTLE_MS = 300;
const suspenseRects = new WeakMap<Fiber, SuspenseRect[]>();

const getProperty = (value: unknown, property: PropertyKey): unknown =>
  (typeof value === "object" || typeof value === "function") && value !== null
    ? Reflect.get(value, property)
    : undefined;

const getDebugInfo = (value: unknown): ReactDebugInfo[] => {
  const debugInfo = getProperty(value, "_debugInfo");
  return Array.isArray(debugInfo) ? debugInfo : [];
};

const isIOInfo = (value: unknown): value is ReactIOInfo =>
  typeof value === "object" &&
  value !== null &&
  typeof getProperty(value, "name") === "string" &&
  typeof getProperty(value, "start") === "number" &&
  typeof getProperty(value, "end") === "number";

const getAsyncDebugInfo = (entry: ReactDebugInfo): ReactIOInfo | null =>
  isIOInfo(entry.awaited) ? entry.awaited : null;

const getFiberAsyncInfo = (fiber: Fiber): ReactDebugInfo[] => {
  const debugEntries = [...(fiber._debugInfo ?? []), ...getDebugInfo(fiber.elementType)];
  const thenableState = fiber.dependencies?._debugThenableState;
  const thenables = Array.isArray(thenableState)
    ? thenableState
    : getProperty(thenableState, "thenables");
  if (Array.isArray(thenables)) {
    for (const thenable of thenables) debugEntries.push(...getDebugInfo(thenable));
  }
  return debugEntries;
};

const collectSuspenders = (boundary: Fiber): FiberSuspender[] => {
  const workTags = getReactWorkTagsForFiber(boundary);
  const foundIO = new Set<ReactIOInfo>();
  const suspenders: FiberSuspender[] = [];

  const visitFiber = (fiber: Fiber, isBoundary: boolean): void => {
    if (!isBoundary && fiber.tag === workTags.SuspenseComponent) return;
    for (const asyncInfo of getFiberAsyncInfo(fiber)) {
      const ioInfo = getAsyncDebugInfo(asyncInfo);
      if (!ioInfo || foundIO.has(ioInfo)) continue;
      foundIO.add(ioInfo);
      suspenders.push({ asyncInfo, fiber, ioInfo });
    }
    let child = fiber.child;
    while (child) {
      visitFiber(child, false);
      child = child.sibling;
    }
  };

  for (const asyncInfo of getFiberAsyncInfo(boundary)) {
    const ioInfo = getAsyncDebugInfo(asyncInfo);
    if (!ioInfo || foundIO.has(ioInfo)) continue;
    foundIO.add(ioInfo);
    suspenders.push({ asyncInfo, fiber: boundary, ioInfo });
  }

  const boundaryChild = boundary.child;
  let primaryChild =
    boundaryChild?.tag === workTags.OffscreenComponent ? boundaryChild.child : boundaryChild;
  while (primaryChild) {
    visitFiber(primaryChild, false);
    primaryChild = primaryChild.sibling;
  }
  return suspenders;
};

const getRect = (rect: unknown): SuspenseRect | null => {
  const x = getProperty(rect, "x");
  const y = getProperty(rect, "y");
  const width = getProperty(rect, "width");
  const height = getProperty(rect, "height");
  return typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
    ? { height, width, x, y }
    : null;
};

const getSuspendedByRange = (
  boundary: Fiber,
  suspendedBy: FiberSuspender[],
): [number, number] | null => {
  let minimumStart = Infinity;
  let maximumEnd = -Infinity;
  for (const { ioInfo } of suspendedBy) {
    minimumStart = Math.min(minimumStart, ioInfo.start);
    maximumEnd = Math.max(maximumEnd, ioInfo.end);
  }

  const workTags = getReactWorkTagsForFiber(boundary);
  let parentBoundary = boundary.return;
  while (parentBoundary && parentBoundary.tag !== workTags.SuspenseComponent) {
    parentBoundary = parentBoundary.return;
  }
  if (parentBoundary) {
    let parentMaximumEnd = -Infinity;
    for (const { ioInfo } of collectSuspenders(parentBoundary)) {
      parentMaximumEnd = Math.max(parentMaximumEnd, ioInfo.end);
    }
    const throttleTime = parentMaximumEnd + FALLBACK_THROTTLE_MS;
    maximumEnd = Math.max(maximumEnd, throttleTime);
    let startTime = maximumEnd - FALLBACK_THROTTLE_MS;
    if (parentMaximumEnd > startTime) startTime = parentMaximumEnd;
    if (startTime < minimumStart) minimumStart = startTime;
  }

  return minimumStart < Infinity && maximumEnd > -Infinity ? [minimumStart, maximumEnd] : null;
};

const getFiberRects = (fiber: Fiber): SuspenseRect[] => {
  const rects: SuspenseRect[] = [];
  const workTags = getReactWorkTagsForFiber(fiber);

  const visitFiber = (candidateFiber: Fiber): void => {
    if (candidateFiber.tag === workTags.HostComponent) {
      const getClientRects = getProperty(candidateFiber.stateNode, "getClientRects");
      if (typeof getClientRects === "function") {
        const clientRects = Reflect.apply(getClientRects, candidateFiber.stateNode, []);
        if (
          typeof clientRects === "object" &&
          clientRects !== null &&
          Symbol.iterator in clientRects
        ) {
          for (const clientRect of clientRects) {
            const rect = getRect(clientRect);
            if (rect) rects.push(rect);
          }
        }
      }
      return;
    }
    if (candidateFiber.tag === workTags.HostText) {
      const textNode = candidateFiber.stateNode;
      const ownerDocument = getProperty(textNode, "ownerDocument");
      const createRange = getProperty(ownerDocument, "createRange");
      if (typeof createRange === "function") {
        const range = Reflect.apply(createRange, ownerDocument, []);
        range.selectNodeContents(textNode);
        for (const clientRect of range.getClientRects()) {
          const rect = getRect(clientRect);
          if (rect) rects.push(rect);
        }
      }
      return;
    }
    let child = candidateFiber.child;
    while (child) {
      visitFiber(child);
      child = child.sibling;
    }
  };

  const fiberChild = fiber.child;
  let primaryChild =
    fiberChild?.tag === workTags.OffscreenComponent ? fiberChild.child : fiberChild;
  while (primaryChild) {
    visitFiber(primaryChild);
    primaryChild = primaryChild.sibling;
  }
  return rects;
};

export const getFiberSuspenseInfo = (fiber: Fiber): FiberSuspenseInfo | null => {
  const latestFiber = getLatestFiber(fiber);
  const workTags = getReactWorkTagsForFiber(latestFiber);
  if (latestFiber.tag !== workTags.SuspenseComponent) return null;
  const suspendedBy = collectSuspenders(latestFiber);
  const environments = Array.from(
    new Set(
      suspendedBy
        .map(({ ioInfo }) => ioInfo.env)
        .filter((environment): environment is string => Boolean(environment)),
    ),
  );
  const retryCache = latestFiber.stateNode;
  const measuredRects = getFiberRects(latestFiber);
  if (measuredRects.length > 0) {
    suspenseRects.set(latestFiber, measuredRects);
    if (latestFiber.alternate) suspenseRects.set(latestFiber.alternate, measuredRects);
  }
  return {
    environments,
    isSuspended: latestFiber.memoizedState !== null,
    range: getSuspendedByRange(latestFiber, suspendedBy),
    rects: measuredRects.length > 0 ? measuredRects : (suspenseRects.get(latestFiber) ?? []),
    suspendedBy,
    unknownSuspenders:
      suspendedBy.length === 0 &&
      (typeof retryCache === "object" || typeof retryCache === "function") &&
      retryCache !== null,
  };
};
