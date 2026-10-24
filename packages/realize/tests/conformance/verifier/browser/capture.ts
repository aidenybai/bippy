import { getDisplayName, getReactWorkTagsForFiber, isCompositeFiber, isHostFiber } from "bippy";
import type { Fiber } from "bippy";
import type { MountFailure } from "../reasons";
import { isPlainRecord } from "../snapshot";
import { STAND_IN } from "../stubs/stand-in";
import { TRUNCATED_VALUE } from "../types";
import type { Capture, Shape } from "../types";
import { getRecordedError, getRenderError } from "./errors";
import {
  MAX_CAPTURED_FIBERS,
  findMountedFiber,
  getChildren,
  getQueuedHooks,
  hasTooManyFibers,
} from "./fibers";
import { takeMutations } from "./mutations";
import { takeHandlerHits, takeProbeHits } from "./probes";

const ANONYMOUS_NAME = "Anonymous";
const MAX_PLAIN_DEPTH = 4;
const MAX_PLAIN_NODES = 2000;

let firstCommitShapes: Shape[] | null = null;

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

export const recordFirstCommitShapes = (fiber: Fiber): void => {
  if (firstCommitShapes === null && !hasTooManyFibers(fiber))
    firstCommitShapes = getChildren(fiber).flatMap(toShapes);
};

export const getFirstCommitShapes = (): Shape[] | null => firstCommitShapes;

export const resetFirstCommitShapes = (): void => {
  firstCommitShapes = null;
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

export const createEmptyCapture = (
  error: string,
  errorDepth: number | null = null,
  failure: MountFailure | null = null,
): Capture => ({
  shapes: [],
  hookStates: [],
  probes: takeProbeHits(),
  handlerHits: takeHandlerHits(),
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error,
  errorDepth,
  failure,
});

export const captureMountedComponent = (): Capture => {
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
  const renderError = getRenderError();
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    hookStates: getQueuedHooks(fiber).map((hook) => toPlainData(hook.memoizedState)),
    probes: takeProbeHits(),
    handlerHits: takeHandlerHits(),
    ...takeMutations(fiber),
    firstCommitShapes: null,
    error: renderError?.message ?? null,
    errorDepth: renderError?.depth ?? null,
    failure: null,
  };
};
